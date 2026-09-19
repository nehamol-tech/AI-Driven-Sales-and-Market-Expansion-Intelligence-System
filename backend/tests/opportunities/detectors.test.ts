import { describe, it, expect } from "vitest";
import type { AccountProfile, CrossSellProductCandidate } from "../../src/modules/opportunities/account-profile.service.js";
import {
  computeTopValueAccounts,
  detectAtRisk,
  detectCrossSell,
  detectGrowingAccount,
  detectHighValue,
  detectReactivation,
  detectReorder,
  CROSS_SELL_MAX_PER_ACCOUNT,
} from "../../src/modules/opportunities/detectors.js";

const NOW = new Date("2026-08-17T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

function makeProfile(overrides: Partial<AccountProfile> = {}): AccountProfile {
  return {
    id: "acc_1",
    name: "Acme Retail",
    industryId: "ind_1",
    industryName: "Retail",
    businessTypeId: null,
    stateId: "state_1",
    orders: [],
    orderCount: 0,
    totalOrderValue: 0,
    firstOrderDate: null,
    lastOrderDate: null,
    recencyDays: null,
    averageReorderIntervalDays: null,
    overdueByDays: null,
    distinctOwnedProductIds: [],
    latestScore: null,
    latestClassification: null,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------
 * REORDER — tests #1, #2
 * ---------------------------------------------------------------------- */

describe("detectReorder", () => {
  it("fires with a real >=2-order cycle and real overdue timing (test #1)", () => {
    const profile = makeProfile({ orderCount: 2, averageReorderIntervalDays: 30, overdueByDays: 10, lastOrderDate: daysAgo(2) });
    const result = detectReorder(profile);
    expect(result).not.toBeNull();
    expect(result?.type).toBe("REORDER");
    expect(result?.priority).toBe("MEDIUM"); // 7 <= 10 < 21
    expect(result?.evidence.some((e) => /overdue/i.test(e.label))).toBe(true);
  });

  it("NEVER fires with fewer than 2 orders, even if overdue/cycle fields are somehow populated — no fabricated cycle (test #2)", () => {
    const profile = makeProfile({ orderCount: 1, averageReorderIntervalDays: 30, overdueByDays: 10 });
    expect(detectReorder(profile)).toBeNull();

    const zeroOrders = makeProfile({ orderCount: 0 });
    expect(detectReorder(zeroOrders)).toBeNull();
  });

  it("does not fire when not yet overdue (overdueByDays <= 0)", () => {
    expect(detectReorder(makeProfile({ orderCount: 2, averageReorderIntervalDays: 30, overdueByDays: 0 }))).toBeNull();
    expect(detectReorder(makeProfile({ orderCount: 2, averageReorderIntervalDays: 30, overdueByDays: -5 }))).toBeNull();
  });

  it("buckets HIGH at >=21 overdue days, LOW below 7", () => {
    expect(detectReorder(makeProfile({ orderCount: 2, averageReorderIntervalDays: 30, overdueByDays: 21 }))?.priority).toBe("HIGH");
    expect(detectReorder(makeProfile({ orderCount: 2, averageReorderIntervalDays: 30, overdueByDays: 3 }))?.priority).toBe("LOW");
  });
});

/* -------------------------------------------------------------------------
 * AT_RISK — test #3
 * ---------------------------------------------------------------------- */

describe("detectAtRisk", () => {
  it("fires on a genuine documented decline between adjacent real windows (test #3a)", () => {
    const profile = makeProfile({
      orderCount: 3,
      firstOrderDate: daysAgo(108),
      lastOrderDate: daysAgo(16),
      orders: [
        { date: daysAgo(108), orderValue: 2000, productId: null },
        { date: daysAgo(77), orderValue: 3000, productId: null }, // prior window (60-120 days ago)
        { date: daysAgo(16), orderValue: 500, productId: null }, // recent window (<=60 days ago)
      ],
    });
    const result = detectAtRisk(profile, NOW);
    expect(result).not.toBeNull();
    expect(result?.type).toBe("AT_RISK");
    // priorValue = 2000+3000 = 5000, recentValue = 500 -> decline = 90% -> HIGH
    expect(result?.priority).toBe("HIGH");
  });

  it("buckets MEDIUM for a decline right at the 40% threshold, not HIGH", () => {
    const profile = makeProfile({
      orderCount: 3,
      firstOrderDate: daysAgo(100),
      lastOrderDate: daysAgo(10),
      orders: [
        { date: daysAgo(100), orderValue: 2500, productId: null },
        { date: daysAgo(70), orderValue: 2500, productId: null }, // prior window total 5000
        { date: daysAgo(10), orderValue: 3000, productId: null }, // recent window: decline = (5000-3000)/5000 = 40%
      ],
    });
    const result = detectAtRisk(profile, NOW);
    expect(result?.priority).toBe("MEDIUM");
  });

  it("does NOT fire on a plain 'hasn't ordered in a while' case with no real prior-period activity to compare against (test #3b — proves it's not a disguised no-order-in-X-days rule)", () => {
    // All 3 orders are older than 120 days -> both recent AND prior windows are empty.
    const profile = makeProfile({
      orderCount: 3,
      firstOrderDate: daysAgo(200),
      lastOrderDate: daysAgo(130),
      orders: [
        { date: daysAgo(200), orderValue: 1000, productId: null },
        { date: daysAgo(160), orderValue: 1000, productId: null },
        { date: daysAgo(130), orderValue: 1000, productId: null },
      ],
    });
    expect(detectAtRisk(profile, NOW)).toBeNull();
  });

  it("does not fire with insufficient order count or span", () => {
    expect(
      detectAtRisk(makeProfile({ orderCount: 2, firstOrderDate: daysAgo(100), lastOrderDate: daysAgo(10) }), NOW),
    ).toBeNull(); // below AT_RISK_MIN_TOTAL_ORDERS
    expect(
      detectAtRisk(
        makeProfile({
          orderCount: 3,
          firstOrderDate: daysAgo(20),
          lastOrderDate: daysAgo(1),
          orders: [
            { date: daysAgo(20), orderValue: 1000, productId: null },
            { date: daysAgo(10), orderValue: 1000, productId: null },
            { date: daysAgo(1), orderValue: 1000, productId: null },
          ],
        }),
        NOW,
      ),
    ).toBeNull(); // span < AT_RISK_MIN_SPAN_DAYS
  });
});

/* -------------------------------------------------------------------------
 * GROWING_ACCOUNT — test #4
 * ---------------------------------------------------------------------- */

describe("detectGrowingAccount", () => {
  it("fires on a genuine documented increase between adjacent real windows (test #4a)", () => {
    const profile = makeProfile({
      orderCount: 4,
      firstOrderDate: daysAgo(110),
      lastOrderDate: daysAgo(10),
      orders: [
        { date: daysAgo(110), orderValue: 1000, productId: null },
        { date: daysAgo(90), orderValue: 1000, productId: null }, // prior window total 2000
        { date: daysAgo(30), orderValue: 3000, productId: null },
        { date: daysAgo(10), orderValue: 3000, productId: null }, // recent window total 6000 -> +200% growth
      ],
    });
    const result = detectGrowingAccount(profile, NOW);
    expect(result).not.toBeNull();
    expect(result?.type).toBe("GROWING_ACCOUNT");
    expect(result?.priority).toBe("HIGH"); // growth >= 100%
  });

  it("does not fire with insufficient order count or span (test #4b)", () => {
    expect(
      detectGrowingAccount(makeProfile({ orderCount: 3, firstOrderDate: daysAgo(100), lastOrderDate: daysAgo(10) }), NOW),
    ).toBeNull(); // below GROWING_MIN_TOTAL_ORDERS
    expect(
      detectGrowingAccount(
        makeProfile({
          orderCount: 4,
          firstOrderDate: daysAgo(20),
          lastOrderDate: daysAgo(1),
          orders: [
            { date: daysAgo(20), orderValue: 500, productId: null },
            { date: daysAgo(15), orderValue: 500, productId: null },
            { date: daysAgo(5), orderValue: 3000, productId: null },
            { date: daysAgo(1), orderValue: 3000, productId: null },
          ],
        }),
        NOW,
      ),
    ).toBeNull(); // span < GROWING_MIN_SPAN_DAYS
  });
});

/* -------------------------------------------------------------------------
 * CROSS_SELL — tests #5, #6
 * ---------------------------------------------------------------------- */

describe("detectCrossSell", () => {
  const products: CrossSellProductCandidate[] = [
    { id: "p_owned", name: "Owned Widget", targetIndustryIds: [], targetBusinessTypeIds: [] },
    { id: "p_match", name: "Matching Widget", targetIndustryIds: ["ind_1"], targetBusinessTypeIds: [] },
    { id: "p_no_match", name: "Unrelated Widget", targetIndustryIds: ["ind_9"], targetBusinessTypeIds: [] },
  ];

  it("suggests only a product with a real target-industry match, never a product the account already owns (test #5)", () => {
    const profile = makeProfile({
      industryId: "ind_1",
      distinctOwnedProductIds: ["p_owned"],
      orders: [
        { date: daysAgo(50), orderValue: 1000, productId: "p_owned" },
        { date: daysAgo(20), orderValue: 1000, productId: "p_owned" },
      ],
    });
    const result = detectCrossSell(profile, products);
    expect(result).toHaveLength(1);
    expect(result[0].productId).toBe("p_match");
    expect(result[0].productName).toBe("Matching Widget");
    expect(result[0].productId).not.toBe("p_owned");
    expect(result[0].evidence.some((e) => e.value.includes("Owned Widget"))).toBe(true);
    expect(result[0].evidence.some((e) => e.value.includes("2 orders"))).toBe(true);
  });

  it("never fires when there is no real matching product (no fabricated relationship) (test #6)", () => {
    const profile = makeProfile({
      industryId: "ind_9999", // matches nothing in `products`
      distinctOwnedProductIds: ["p_owned"],
      orders: [
        { date: daysAgo(50), orderValue: 1000, productId: "p_owned" },
        { date: daysAgo(20), orderValue: 1000, productId: "p_owned" },
      ],
    });
    expect(detectCrossSell(profile, products)).toEqual([]);
  });

  it("never fires when the owned product was bought fewer than the minimum repeat-purchase count", () => {
    const profile = makeProfile({
      industryId: "ind_1",
      distinctOwnedProductIds: ["p_owned"],
      orders: [{ date: daysAgo(20), orderValue: 1000, productId: "p_owned" }], // only 1 order
    });
    expect(detectCrossSell(profile, products)).toEqual([]);
  });

  it("caps candidates per account and never suggests the same product twice", () => {
    const manyProducts: CrossSellProductCandidate[] = [
      { id: "owned_a", name: "Owned A", targetIndustryIds: [], targetBusinessTypeIds: [] },
      { id: "owned_b", name: "Owned B", targetIndustryIds: [], targetBusinessTypeIds: [] },
      { id: "owned_c", name: "Owned C", targetIndustryIds: [], targetBusinessTypeIds: [] },
      { id: "match_1", name: "Match 1", targetIndustryIds: ["ind_1"], targetBusinessTypeIds: [] },
      { id: "match_2", name: "Match 2", targetIndustryIds: ["ind_1"], targetBusinessTypeIds: [] },
      { id: "match_3", name: "Match 3", targetIndustryIds: ["ind_1"], targetBusinessTypeIds: [] },
    ];
    const profile = makeProfile({
      industryId: "ind_1",
      distinctOwnedProductIds: ["owned_a", "owned_b", "owned_c"],
      orders: [
        { date: daysAgo(90), orderValue: 1000, productId: "owned_a" },
        { date: daysAgo(80), orderValue: 1000, productId: "owned_a" },
        { date: daysAgo(70), orderValue: 1000, productId: "owned_a" },
        { date: daysAgo(60), orderValue: 1000, productId: "owned_b" },
        { date: daysAgo(50), orderValue: 1000, productId: "owned_b" },
        { date: daysAgo(40), orderValue: 1000, productId: "owned_c" },
        { date: daysAgo(30), orderValue: 1000, productId: "owned_c" },
      ],
    });
    const result = detectCrossSell(profile, manyProducts);
    expect(result.length).toBeLessThanOrEqual(CROSS_SELL_MAX_PER_ACCOUNT);
    expect(result).toHaveLength(2);
    const suggestedIds = result.map((r) => r.productId);
    expect(new Set(suggestedIds).size).toBe(suggestedIds.length); // no duplicates
  });
});

/* -------------------------------------------------------------------------
 * HIGH_VALUE — test #7
 * ---------------------------------------------------------------------- */

describe("detectHighValue", () => {
  it("NEVER fires on value alone (test #7a)", () => {
    const profiles = [
      makeProfile({ id: "acc_high", orderCount: 5, totalOrderValue: 1_000_000 }),
      makeProfile({ id: "acc_low", orderCount: 1, totalOrderValue: 100 }),
    ];
    const topValueInfo = computeTopValueAccounts(profiles, 25);
    expect(topValueInfo.accountIds.has("acc_high")).toBe(true);

    const result = detectHighValue(profiles[0], topValueInfo, {
      hasReorder: false,
      hasAtRisk: false,
      crossSellCount: 0,
      hasReactivation: false,
      hasGrowing: false,
    });
    expect(result).toBeNull();
  });

  it("fires once a real co-signal is present alongside top-quartile value (test #7b)", () => {
    const profiles = [
      makeProfile({ id: "acc_high", orderCount: 5, totalOrderValue: 1_000_000 }),
      makeProfile({ id: "acc_low", orderCount: 1, totalOrderValue: 100 }),
    ];
    const topValueInfo = computeTopValueAccounts(profiles, 25);

    const result = detectHighValue(profiles[0], topValueInfo, {
      hasReorder: true,
      hasAtRisk: false,
      crossSellCount: 0,
      hasReactivation: false,
      hasGrowing: false,
    });
    expect(result).not.toBeNull();
    expect(result?.priority).toBe("HIGH");
    expect(result?.evidence.some((e) => /overdue/i.test(e.value))).toBe(true);
  });

  it("does not fire for an account outside the top value percentile, even with a co-signal", () => {
    const profiles = [
      makeProfile({ id: "acc_high", orderCount: 5, totalOrderValue: 1_000_000 }),
      makeProfile({ id: "acc_low", orderCount: 1, totalOrderValue: 100 }),
    ];
    const topValueInfo = computeTopValueAccounts(profiles, 25);
    const result = detectHighValue(profiles[1], topValueInfo, {
      hasReorder: true,
      hasAtRisk: false,
      crossSellCount: 0,
      hasReactivation: false,
      hasGrowing: false,
    });
    expect(result).toBeNull();
  });
});

/* -------------------------------------------------------------------------
 * REACTIVATION — test #8
 * ---------------------------------------------------------------------- */

describe("detectReactivation", () => {
  it("fires only with real historical engagement + real dormancy past the threshold (test #8)", () => {
    const profile = makeProfile({ id: "acc_target", orderCount: 3, recencyDays: 95, totalOrderValue: 9000 });
    // A higher-value decoy so `profile` is NOT itself in the top value quartile — isolates the
    // dormancy-day priority rule from the "also top-value" HIGH override tested separately below.
    const decoy = makeProfile({ id: "acc_decoy", orderCount: 3, recencyDays: 10, totalOrderValue: 999_000 });
    const topValueInfo = computeTopValueAccounts([profile, decoy], 25);
    expect(topValueInfo.accountIds.has("acc_target")).toBe(false);

    const result = detectReactivation(profile, topValueInfo);
    expect(result).not.toBeNull();
    expect(result?.type).toBe("REACTIVATION");
    expect(result?.priority).toBe("MEDIUM"); // 95 days: past dormant threshold but not past the HIGH threshold, and not top-value
  });

  it("does not fire below the minimum historical order count", () => {
    const profile = makeProfile({ orderCount: 2, recencyDays: 200 });
    const topValueInfo = computeTopValueAccounts([profile], 25);
    expect(detectReactivation(profile, topValueInfo)).toBeNull();
  });

  it("does not fire when not yet dormant (recencyDays <= 90)", () => {
    const profile = makeProfile({ orderCount: 5, recencyDays: 45 });
    const topValueInfo = computeTopValueAccounts([profile], 25);
    expect(detectReactivation(profile, topValueInfo)).toBeNull();
  });

  it("buckets HIGH once dormancy exceeds 180 days", () => {
    const profile = makeProfile({ orderCount: 3, recencyDays: 200 });
    const topValueInfo = computeTopValueAccounts([profile], 25);
    expect(detectReactivation(profile, topValueInfo)?.priority).toBe("HIGH");
  });
});

/* -------------------------------------------------------------------------
 * Multiple simultaneous opportunity types — test #9
 * ---------------------------------------------------------------------- */

describe("an account can legitimately carry multiple simultaneous opportunity types", () => {
  it("a single account can qualify for both REORDER and REACTIVATION-adjacent signals at once without being deduped (test #9)", () => {
    // REORDER doesn't require dormancy, REACTIVATION requires exactly the opposite framing (>90 days) —
    // to prove genuine co-occurrence we combine REORDER with HIGH_VALUE instead, which is explicitly
    // designed to stack on top of another real signal for the same account.
    const profile = makeProfile({
      id: "acc_multi",
      orderCount: 5,
      totalOrderValue: 500_000,
      averageReorderIntervalDays: 20,
      overdueByDays: 15,
    });
    const reorder = detectReorder(profile);
    expect(reorder).not.toBeNull();

    const topValueInfo = computeTopValueAccounts([profile, makeProfile({ id: "acc_other", orderCount: 1, totalOrderValue: 1 })], 25);
    const highValue = detectHighValue(profile, topValueInfo, {
      hasReorder: true,
      hasAtRisk: false,
      crossSellCount: 0,
      hasReactivation: false,
      hasGrowing: false,
    });
    expect(highValue).not.toBeNull();

    // Both real, both for the same leadId, both legitimately present at once.
    expect(reorder?.leadId).toBe(highValue?.leadId);
    expect(reorder?.type).toBe("REORDER");
    expect(highValue?.type).toBe("HIGH_VALUE");
  });
});
