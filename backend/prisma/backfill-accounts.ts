import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function normalizeAccountName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * One-off backfill: for each company, groups existing SalesRecord rows by
 * case-insensitive-trimmed customerName (mirroring the matching convention
 * already used for CSV import), creates one Account per distinct name that
 * doesn't already have one, and links SalesRecord.accountId accordingly.
 *
 * Idempotent — safe to re-run. Already-created Accounts (matched by
 * companyId + normalizedName) and already-linked SalesRecord rows are left
 * untouched; only missing Accounts get created and unlinked rows get linked.
 */
async function main(): Promise<void> {
  const companies = await prisma.company.findMany({ select: { id: true, name: true } });

  let totalAccountsCreated = 0;
  let totalRecordsLinked = 0;

  for (const company of companies) {
    const records = await prisma.salesRecord.findMany({
      where: { companyId: company.id },
      select: { id: true, customerName: true, stateId: true, cityId: true, industryId: true, accountId: true },
    });

    if (records.length === 0) {
      continue;
    }

    const existingAccounts = await prisma.account.findMany({ where: { companyId: company.id } });
    const accountByNormalizedName = new Map(existingAccounts.map((a) => [a.normalizedName, a]));

    const groups = new Map<string, typeof records>();
    for (const record of records) {
      const key = normalizeAccountName(record.customerName);
      const group = groups.get(key);
      if (group) {
        group.push(record);
      } else {
        groups.set(key, [record]);
      }
    }

    for (const [normalizedName, groupRecords] of groups) {
      let account = accountByNormalizedName.get(normalizedName);

      if (!account) {
        // Real data only: use the first record's original-cased customer
        // name and any state/city/industry already present on that sale as
        // the initial Account profile — nothing invented.
        const first = groupRecords[0];
        account = await prisma.account.create({
          data: {
            companyId: company.id,
            name: first.customerName.trim(),
            normalizedName,
            stateId: first.stateId ?? null,
            cityId: first.cityId ?? null,
            industryId: first.industryId ?? null,
          },
        });
        accountByNormalizedName.set(normalizedName, account);
        totalAccountsCreated += 1;
        console.log(`Company "${company.name}": created Account "${account.name}" (${account.id})`);
      }

      const accountId = account.id;
      const unlinkedIds = groupRecords.filter((r) => r.accountId !== accountId).map((r) => r.id);
      if (unlinkedIds.length > 0) {
        const result = await prisma.salesRecord.updateMany({
          where: { id: { in: unlinkedIds } },
          data: { accountId },
        });
        totalRecordsLinked += result.count;
      }
    }
  }

  console.log(`Backfill complete: ${totalAccountsCreated} account(s) created, ${totalRecordsLinked} sales record(s) linked.`);
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
