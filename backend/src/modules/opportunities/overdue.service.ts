import type { PrismaClient } from "@prisma/client";
import type {
  DailyPriorityLevel,
  FmsRawRow,
  OpportunityType,
  OverdueAccountRowDTO,
  OverdueAccountsResponseDTO,
  OverdueAgeBucket,
  OverdueBillDTO,
  OverdueBillDetailResponseDTO,
  OverdueCustomerBillsResponseDTO,
  OverdueSort,
} from "@ai-sales/shared";
import type { FmsClient } from "../fms/fms.client.js";
import { buildSyncedOrderIndex, resolveSyncedOrder } from "../fms/fms-fulfilment.service.js";

/**
 * Overdue accounts — read-only, from the FMS "Account_Process" sheet.
 *
 * The app holds no payment data of its own; this sheet is the only source,
 * and its own `Final Status` column ("Paid" / "Pending" / "Overdue", computed
 * by the sheet) IS the existing overdue rule. It is used as-is, never
 * re-derived: a bill is overdue exactly when the sheet says "Overdue"
 * (verified live: every such bill has Balance Due > 0 and a past due date).
 *
 * - Overdue amount = Balance Due summed over the account's Overdue bills.
 * - Total outstanding = Balance Due summed over every bill with a balance.
 * - Due date = the "Days O/S" column, which holds the due date despite its
 *   name (it equals Date + Due Days on every row).
 * - Days overdue = calendar days from the due date to today, India time.
 * - Bills are linked to accounts with the same exact Bill No. (+ timestamp
 *   for duplicates) join the Order Fulfilment view uses — never by name.
 * - Customer codes come from "Customer_Database" by exact customer name.
 */

export const OVERDUE_SHEET_NAME = "Account_Process";
export const OVERDUE_FETCH_LIMIT = 10000;
export const CUSTOMER_CODE_SHEET_NAME = "Customer_Database";
export const CUSTOMER_CODE_FETCH_LIMIT = 1000;

const OVERDUE_STATUS = "Overdue";
export const REQUIRED_OVERDUE_HEADERS = ["Date", "Bill No.", "Customer Name", "Bill Amount", "Days O/S", "Balance Due", "Final Status"] as const;
const STANDARD_TIMESTAMP = /^(\d{4}-\d{2}-\d{2}) \d{2}:\d{2}:\d{2}$/;
const IST = "Asia/Kolkata";

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

/** Money as integer paise, so totals never accumulate float error. Null when the cell isn't a number. */
function toPaise(value: unknown): number | null {
  const text = cellText(value).replace(/,/g, "").trim();
  if (text === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function paiseToDecimal(paise: number): string {
  return (paise / 100).toFixed(2);
}

/** Today's calendar date in India time, as YYYY-MM-DD. */
export function todayInIndia(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Calendar days from a sheet due date ("YYYY-MM-DD HH:MM:SS") to `asOfDate`; null if the due date isn't in that form. */
export function daysOverdue(dueDate: string, asOfDate: string): number | null {
  const match = STANDARD_TIMESTAMP.exec(dueDate.trim());
  if (!match) return null;
  return Math.round((Date.parse(`${asOfDate}T00:00:00Z`) - Date.parse(`${match[1]}T00:00:00Z`)) / 86_400_000);
}

export function ageBucketOf(days: number | null): OverdueAgeBucket | null {
  if (days === null || days < 1) return null;
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

export interface ParsedBill {
  billNo: string;
  billDate: string;
  customerName: string;
  billAmountPaise: number | null;
  balanceDuePaise: number | null;
  dueDate: string;
  isOverdue: boolean;
  /** Display-only columns (never used in any calculation). */
  paymentReceivedPaise: number | null;
  dueDays: string;
  finalStatus: string;
  lastFollowUpDate: string;
  lastFollowUpStage: string;
  followUpMode: string;
  customerCaption: string;
  dateReceived: string;
}

export function parseAccountProcessRows(rows: FmsRawRow[]): { ok: true; bills: ParsedBill[] } | { ok: false; problems: string[] } {
  if (rows.length === 0) return { ok: true, bills: [] };
  const headers = new Set(Object.keys(rows[0]));
  const missing = REQUIRED_OVERDUE_HEADERS.filter((h) => !headers.has(h));
  if (missing.length > 0) return { ok: false, problems: missing.map((h) => `Required column "${h}" not found in the "${OVERDUE_SHEET_NAME}" sheet.`) };

  const bills: ParsedBill[] = [];
  for (const row of rows) {
    const billNo = cellText(row["Bill No."]).trim();
    if (billNo === "") continue;
    bills.push({
      billNo,
      billDate: cellText(row["Date"]),
      customerName: cellText(row["Customer Name"]),
      billAmountPaise: toPaise(row["Bill Amount"]),
      balanceDuePaise: toPaise(row["Balance Due"]),
      dueDate: cellText(row["Days O/S"]),
      isOverdue: cellText(row["Final Status"]).trim() === OVERDUE_STATUS,
      paymentReceivedPaise: toPaise(row["Payment Received"]),
      dueDays: cellText(row["Due Days"]).trim(),
      finalStatus: cellText(row["Final Status"]).trim(),
      lastFollowUpDate: cellText(row["Last Follow-up Date"]).trim(),
      lastFollowUpStage: cellText(row["Last Follow-up Stage"]).trim(),
      followUpMode: cellText(row["Follow-up Mode"]).trim(),
      customerCaption: cellText(row["Customer Caption"]).trim(),
      dateReceived: cellText(row["Date Recd"]).trim(),
    });
  }
  return { ok: true, bills };
}

/** Exact, case-insensitive customer name → code; a name with several different codes maps to none. */
export function buildCustomerCodeIndex(rows: FmsRawRow[]): Map<string, string | null> {
  const index = new Map<string, string | null>();
  for (const row of rows) {
    const name = cellText(row["Customer Name"]).trim().toLowerCase();
    const code = cellText(row["Code number"]).trim();
    if (!name || !code) continue;
    const existing = index.get(name);
    if (existing === undefined) index.set(name, code);
    else if (existing !== code) index.set(name, null);
  }
  return index;
}

interface AccountAccumulator {
  accountId: string;
  sheetCustomerName: string;
  overduePaise: number;
  outstandingPaise: number;
  bills: OverdueBillDTO[];
  orderTakenBy: Set<string>;
}

export interface OverdueAccountsBuild {
  accounts: Omit<OverdueAccountRowDTO, "accountName" | "opportunities">[];
  unlinked: { bills: number; amountPaise: number };
}

/**
 * Groups bills by linked account. Only accounts holding at least one
 * Overdue bill are returned; their outstanding total also counts their
 * Pending bills' balances.
 */
export function buildOverdueAccounts(
  bills: ParsedBill[],
  syncedOrders: Parameters<typeof resolveSyncedOrder>[2],
  customerCodes: Map<string, string | null>,
  asOfDate: string,
): OverdueAccountsBuild {
  const byAccount = new Map<string, AccountAccumulator>();
  const unlinked = { bills: 0, amountPaise: 0 };

  for (const bill of bills) {
    const hasBalance = bill.balanceDuePaise !== null && bill.balanceDuePaise > 0;
    if (!bill.isOverdue && !hasBalance) continue;

    const resolved = resolveSyncedOrder(bill.billNo, bill.billDate, syncedOrders);
    const accountId = resolved.status === "matched" ? resolved.ref.accountId : null;
    if (!accountId || (bill.isOverdue && bill.balanceDuePaise === null)) {
      if (bill.isOverdue) {
        unlinked.bills++;
        unlinked.amountPaise += bill.balanceDuePaise ?? 0;
      }
      continue;
    }

    let acc = byAccount.get(accountId);
    if (!acc) {
      acc = { accountId, sheetCustomerName: bill.customerName, overduePaise: 0, outstandingPaise: 0, bills: [], orderTakenBy: new Set() };
      byAccount.set(accountId, acc);
    }
    if (hasBalance) acc.outstandingPaise += bill.balanceDuePaise!;
    if (!bill.isOverdue) continue;

    acc.overduePaise += bill.balanceDuePaise!;
    acc.bills.push({
      billNo: bill.billNo,
      billDate: bill.billDate,
      dueDate: bill.dueDate,
      daysOverdue: daysOverdue(bill.dueDate, asOfDate),
      billAmount: bill.billAmountPaise === null ? "" : paiseToDecimal(bill.billAmountPaise),
      balanceDue: paiseToDecimal(bill.balanceDuePaise!),
      paidAmount: bill.paymentReceivedPaise === null ? null : paiseToDecimal(bill.paymentReceivedPaise),
      customerName: bill.customerName,
    });
    if (resolved.status === "matched" && resolved.ref.orderTaken.trim()) acc.orderTakenBy.add(resolved.ref.orderTaken.trim());
  }

  const accounts = [...byAccount.values()]
    .filter((a) => a.bills.length > 0)
    .map((a) => {
      const sortedBills = [...a.bills].sort((x, y) => (y.daysOverdue ?? -Infinity) - (x.daysOverdue ?? -Infinity));
      const known = sortedBills.map((b) => b.daysOverdue).filter((d): d is number => d !== null);
      return {
        accountId: a.accountId,
        customerCode: customerCodes.get(a.sheetCustomerName.trim().toLowerCase()) ?? null,
        totalOutstanding: paiseToDecimal(a.outstandingPaise),
        overdueAmount: paiseToDecimal(a.overduePaise),
        daysOverdue: known.length > 0 ? Math.max(...known) : null,
        overdueBills: sortedBills,
        orderTakenBy: [...a.orderTakenBy].sort(),
      };
    });

  return { accounts, unlinked };
}

export interface OverdueListParams {
  page: number;
  pageSize: number;
  search?: string;
  age?: OverdueAgeBucket;
  sort: OverdueSort;
}

/** Search (name/code contains, bill number exact), age filter on the oldest bill, sort, page. */
export function filterSortPage(rows: OverdueAccountRowDTO[], params: OverdueListParams) {
  const needle = params.search?.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    if (params.age && ageBucketOf(r.daysOverdue) !== params.age) return false;
    if (!needle) return true;
    return (
      r.accountName.toLowerCase().includes(needle) ||
      (r.customerCode ?? "").toLowerCase().includes(needle) ||
      r.overdueBills.some((b) => b.billNo.toLowerCase() === needle)
    );
  });

  const byName = (a: OverdueAccountRowDTO, b: OverdueAccountRowDTO) => a.accountName.localeCompare(b.accountName);
  const days = (r: OverdueAccountRowDTO) => r.daysOverdue ?? -Infinity;
  const comparators: Record<OverdueSort, (a: OverdueAccountRowDTO, b: OverdueAccountRowDTO) => number> = {
    amount: (a, b) => Number(b.overdueAmount) - Number(a.overdueAmount) || byName(a, b),
    oldest: (a, b) => days(b) - days(a) || byName(a, b),
    recent: (a, b) => days(a) - days(b) || byName(a, b),
    name: byName,
  };
  const sorted = [...filtered].sort(comparators[params.sort]);
  const start = (params.page - 1) * params.pageSize;
  return { total: sorted.length, page: sorted.slice(start, start + params.pageSize) };
}

type LoadOverdueResult =
  | {
      status: "ok";
      bills: ParsedBill[];
      built: OverdueAccountsBuild;
      names: Map<string, string>;
      syncedOrders: Awaited<ReturnType<typeof buildSyncedOrderIndex>>;
      asOfDate: string;
      fetchedAt: string;
      sheetRowCount: number;
      codesAvailable: boolean;
    }
  | { status: "upstream_error"; message: string }
  | { status: "layout_invalid"; problems: string[] };

/** Reads the payment + customer-code sheets and builds every overdue account — shared by the list, a customer's bills and bill details. */
async function loadOverdue(
  prisma: Pick<PrismaClient, "salesRecord" | "account">,
  client: FmsClient,
  companyId: string,
  now: Date,
): Promise<LoadOverdueResult> {
  const [sheet, codesSheet] = await Promise.all([
    client.fetchData({ sheet: OVERDUE_SHEET_NAME, limit: OVERDUE_FETCH_LIMIT }),
    client.fetchData({ sheet: CUSTOMER_CODE_SHEET_NAME, limit: CUSTOMER_CODE_FETCH_LIMIT }),
  ]);
  if (sheet.status === "network_error" || sheet.status === "malformed_response") return { status: "upstream_error", message: sheet.message };
  if (sheet.status === "upstream_rejected") {
    return { status: "upstream_error", message: `The FMS API rejected the "${OVERDUE_SHEET_NAME}" sheet request: ${sheet.error}` };
  }

  const parsed = parseAccountProcessRows(sheet.body.data);
  if (!parsed.ok) return { status: "layout_invalid", problems: parsed.problems };

  const asOfDate = todayInIndia(now);
  const codes = codesSheet.status === "ok" ? buildCustomerCodeIndex(codesSheet.body.data) : new Map<string, string | null>();
  const syncedOrders = await buildSyncedOrderIndex(prisma, companyId);
  const built = buildOverdueAccounts(parsed.bills, syncedOrders, codes, asOfDate);

  const accountRecords = await prisma.account.findMany({
    where: { companyId, id: { in: built.accounts.map((a) => a.accountId) } },
    select: { id: true, name: true },
  });
  return {
    status: "ok",
    bills: parsed.bills,
    built,
    names: new Map(accountRecords.map((a) => [a.id, a.name])),
    syncedOrders,
    asOfDate,
    fetchedAt: sheet.fetchedAt ?? new Date().toISOString(),
    sheetRowCount: sheet.body.count,
    codesAvailable: codesSheet.status === "ok",
  };
}

export type GetOverdueCustomerBillsResult =
  | { status: "ok"; dto: Extract<OverdueCustomerBillsResponseDTO, { configured: true }> }
  | { status: "not_found" }
  | { status: "upstream_error"; message: string }
  | { status: "layout_invalid"; problems: string[] };

/** One overdue customer's bills, oldest first, paged — the same bills and totals the Overdue list shows for that account. */
export async function getOverdueCustomerBills(
  prisma: Pick<PrismaClient, "salesRecord" | "account">,
  client: FmsClient,
  companyId: string,
  accountId: string,
  params: { page: number; pageSize: number },
  now: Date = new Date(),
): Promise<GetOverdueCustomerBillsResult> {
  const loaded = await loadOverdue(prisma, client, companyId, now);
  if (loaded.status !== "ok") return loaded;
  const account = loaded.built.accounts.find((a) => a.accountId === accountId);
  if (!account) return { status: "not_found" };

  const start = (params.page - 1) * params.pageSize;
  return {
    status: "ok",
    dto: {
      configured: true,
      account: { accountId, accountName: loaded.names.get(accountId) ?? "(unknown account)", customerCode: account.customerCode },
      summary: { overdueBills: account.overdueBills.length, overdueAmount: account.overdueAmount, totalOutstanding: account.totalOutstanding },
      data: account.overdueBills.slice(start, start + params.pageSize),
      pagination: { page: params.page, pageSize: params.pageSize, total: account.overdueBills.length },
      asOfDate: loaded.asOfDate,
      fetchedAt: loaded.fetchedAt,
    },
  };
}

export type GetOverdueBillDetailResult =
  | { status: "ok"; dto: Extract<OverdueBillDetailResponseDTO, { configured: true }> }
  | { status: "not_found" }
  | { status: "upstream_error"; message: string }
  | { status: "layout_invalid"; problems: string[] };

/** Every payment-sheet row with this Bill No., each with its linked account and synced FMS order (when exactly one matches). */
export async function getOverdueBillDetail(
  prisma: Pick<PrismaClient, "salesRecord" | "account">,
  client: FmsClient,
  companyId: string,
  billNo: string,
  now: Date = new Date(),
): Promise<GetOverdueBillDetailResult> {
  const loaded = await loadOverdue(prisma, client, companyId, now);
  if (loaded.status !== "ok") return loaded;
  const wanted = billNo.trim();
  const rows = loaded.bills.filter((b) => b.billNo === wanted);
  if (rows.length === 0) return { status: "not_found" };

  const matches = rows.map((b) => resolveSyncedOrder(b.billNo, b.billDate, loaded.syncedOrders));
  const recordIds = matches.flatMap((m) => (m.status === "matched" ? [m.ref.id] : []));
  const records = await prisma.salesRecord.findMany({
    where: { companyId, id: { in: recordIds } },
    select: { id: true, orderValue: true, cancelledAt: true, metadata: true, account: { select: { id: true, name: true } } },
  });
  const byId = new Map(records.map((r) => [r.id, r]));
  const text = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  const money = (p: number | null) => (p === null ? "" : paiseToDecimal(p));

  return {
    status: "ok",
    dto: {
      configured: true,
      billNo: wanted,
      entries: rows.map((b, i) => {
        const m = matches[i];
        const record = m.status === "matched" ? byId.get(m.ref.id) : undefined;
        const fms = (record?.metadata as { fms?: Record<string, unknown> } | null)?.fms;
        return {
          billNo: b.billNo,
          customerName: b.customerName,
          billDate: b.billDate,
          dueDate: b.dueDate,
          dueDays: b.dueDays,
          daysOverdue: daysOverdue(b.dueDate, loaded.asOfDate),
          billAmount: money(b.billAmountPaise),
          paidAmount: money(b.paymentReceivedPaise),
          balanceDue: money(b.balanceDuePaise),
          finalStatus: b.finalStatus,
          lastFollowUpDate: b.lastFollowUpDate,
          lastFollowUpStage: b.lastFollowUpStage,
          followUpMode: b.followUpMode,
          customerCaption: b.customerCaption,
          dateReceived: b.dateReceived,
          account: record?.account ? { accountId: record.account.id, accountName: record.account.name } : null,
          order: record
            ? {
                timestamp: text(fms?.timestamp),
                productAndQty: text(fms?.productAndQty),
                orderTaken: text(fms?.orderTaken),
                dispatchedBy: text(fms?.dispatchedBy),
                dispatchedDate: text(fms?.dispatchedDate),
                orderValue: Number(record.orderValue).toFixed(2),
                cancelled: record.cancelledAt !== null,
              }
            : null,
        };
      }),
      asOfDate: loaded.asOfDate,
      fetchedAt: loaded.fetchedAt,
    },
  };
}

export type GetOverdueAccountsResult =
  | { status: "ok"; dto: Extract<OverdueAccountsResponseDTO, { configured: true }> }
  | { status: "upstream_error"; message: string }
  | { status: "layout_invalid"; problems: string[] };

export async function getOverdueAccounts(
  prisma: Pick<PrismaClient, "salesRecord" | "account">,
  client: FmsClient,
  companyId: string,
  signals: Map<string, { type: OpportunityType; priority: DailyPriorityLevel }[]>,
  params: OverdueListParams,
  now: Date = new Date(),
): Promise<GetOverdueAccountsResult> {
  const loaded = await loadOverdue(prisma, client, companyId, now);
  if (loaded.status !== "ok") return loaded;
  const { built, names, asOfDate } = loaded;
  const rows: OverdueAccountRowDTO[] = built.accounts.map((a) => ({
    ...a,
    accountName: names.get(a.accountId) ?? "(unknown account)",
    opportunities: signals.get(a.accountId) ?? [],
  }));

  const amounts = rows.map((r) => Math.round(Number(r.overdueAmount) * 100));
  const totalPaise = amounts.reduce((s, n) => s + n, 0);
  const { total, page } = filterSortPage(rows, params);

  const reasons: string[] = [];
  const complete = loaded.sheetRowCount < OVERDUE_FETCH_LIMIT;
  reasons.push(
    complete
      ? "The Apps Script returned fewer rows than the request limit, so no bills were cut off."
      : `The ${OVERDUE_FETCH_LIMIT.toLocaleString("en-US")}-row limit was reached, so later bills may be missing.`,
  );
  if (!loaded.codesAvailable) reasons.push(`Customer codes are unavailable: the "${CUSTOMER_CODE_SHEET_NAME}" sheet could not be read.`);

  return {
    status: "ok",
    dto: {
      configured: true,
      data: page,
      pagination: { page: params.page, pageSize: params.pageSize, total },
      summary: {
        accounts: rows.length,
        totalOverdueAmount: paiseToDecimal(totalPaise),
        averageOverdueAmount: paiseToDecimal(rows.length ? Math.round(totalPaise / rows.length) : 0),
        highestOverdueAmount: paiseToDecimal(amounts.length ? Math.max(...amounts) : 0),
      },
      unlinked: { bills: built.unlinked.bills, amount: paiseToDecimal(built.unlinked.amountPaise) },
      asOfDate,
      fetchedAt: loaded.fetchedAt,
      retrieval: { complete, reason: reasons.join(" ") },
    },
  };
}
