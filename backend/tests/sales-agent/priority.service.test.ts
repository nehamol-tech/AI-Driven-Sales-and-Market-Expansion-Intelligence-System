import { describe, it, expect } from "vitest";
import {
  computeReorderTiming,
  computePriorityScore,
  bucketPriority,
  buildDeterministicReasons,
  buildRuleBasedRecommendedAction,
  findMatchingProductNames,
  pickDeterministicProductSuggestion,
  computeDataConfidence,
  assemblePriorityCandidate,
  rankCandidates,
  PRIORITY_HIGH_THRESHOLD,
  PRIORITY_MEDIUM_THRESHOLD,
} from "../../src/modules/sales-agent/priority.service.js";

/* -------------------------------------------------------------------------
 * computeReorderTiming
 * ---------------------------------------------------------------------- */

describe("computeReorderTiming", () => {
  it("returns null signal when there are fewer than 2 orders", () => {
    expect(computeReorderTiming({ orderDates: [], recencyDays: null })).toEqual({
      averageReorderIntervalDays: null,
      overdueByDays: null,
    });
    expect(computeReorderTiming({ orderDates: [new Date("2026-08-01")], recencyDays: 16 })).toEqual({
      averageReorderIntervalDays: null,
      overdueByDays: null,
    });
  });

  it("computes the mean gap between consecutive orders when there are >=2 real orders", () => {
    // Orders 30 days apart, then 40 days apart -> average gap 35 days.
    const result = computeReorderTiming({
      orderDates: [new Date("2026-06-01"), new Date("2026-07-01"), new Date("2026-08-10")],
      recencyDays: 7,
    });
    expect(result.averageReorderIntervalDays).toBe(35);
    expect(result.overdueByDays).toBe(7 - 35);
  });

  it("computes a positive overdueByDays when recency exceeds the average cycle (overdue)", () => {
    const result = computeReorderTiming({
      orderDates: [new Date("2026-01-01"), new Date("2026-02-01")], // 31-day cycle
      recencyDays: 45,
    });
    expect(result.averageReorderIntervalDays).toBe(31);
    expect(result.overdueByDays).toBe(14);
  });

  it("handles unsorted order dates the same as sorted ones", () => {
    const sorted = computeReorderTiming({
      orderDates: [new Date("2026-01-01"), new Date("2026-02-01"), new Date("2026-03-03")],
      recencyDays: 10,
    });
    const shuffled = computeReorderTiming({
      orderDates: [new Date("2026-03-03"), new Date("2026-01-01"), new Date("2026-02-01")],
      recencyDays: 10,
    });
    expect(shuffled).toEqual(sorted);
  });

  it("returns null overdueByDays when recencyDays is unavailable even with a real cycle", () => {
    const result = computeReorderTiming({
      orderDates: [new Date("2026-01-01"), new Date("2026-02-01")],
      recencyDays: null,
    });
    expect(result.averageReorderIntervalDays).not.toBeNull();
    expect(result.overdueByDays).toBeNull();
  });
});

/* -------------------------------------------------------------------------
 * computePriorityScore / bucketPriority — deterministic, pure ranking math.
 * Test #1 (HOT + overdue -> HIGH), #3 (deterministic/pure).
 * ---------------------------------------------------------------------- */

describe("computePriorityScore / bucketPriority", () => {
  it("gives a HOT lead with a real overdue-reorder signal HIGH priority", () => {
    const priorityScore = computePriorityScore({ classification: "HOT", score: 85, overdueByDays: 10 });
    // base 100 + overdueBonus (10*0.5=5) + scoreBonus (85*0.3=25.5) = 130.5
    expect(priorityScore).toBeCloseTo(130.5, 5);
    expect(bucketPriority(priorityScore)).toBe("HIGH");
  });

  it("is pure and deterministic: identical input always produces identical output", () => {
    const input = { classification: "HOT" as const, score: 77, overdueByDays: 22 };
    const a = computePriorityScore(input);
    const b = computePriorityScore(input);
    const c = computePriorityScore({ ...input });
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(bucketPriority(a)).toBe(bucketPriority(b));
  });

  it("never lets a WARM lead reach HIGH under this formula's ceiling", () => {
    // WARM ceiling: base 50 + max scoreBonus (score just under 70 -> ~20.99) + max overdueBonus (30) ~= 100.99
    const maxWarm = computePriorityScore({ classification: "WARM", score: 69, overdueByDays: 9999 });
    expect(maxWarm).toBeLessThan(PRIORITY_HIGH_THRESHOLD);
    expect(bucketPriority(maxWarm)).not.toBe("HIGH");
  });

  it("treats a null overdue signal as zero bonus, not a penalty or a guess", () => {
    const withOverdue = computePriorityScore({ classification: "HOT", score: 70, overdueByDays: 5 });
    const withoutOverdue = computePriorityScore({ classification: "HOT", score: 70, overdueByDays: null });
    expect(withoutOverdue).toBeLessThan(withOverdue);
    expect(withoutOverdue).toBe(100 + 70 * 0.3);
  });

  it("clamps the overdue bonus at 60 days so an extreme outlier doesn't dominate the score", () => {
    const cappedAt60 = computePriorityScore({ classification: "HOT", score: 50, overdueByDays: 60 });
    const beyond60 = computePriorityScore({ classification: "HOT", score: 50, overdueByDays: 500 });
    expect(beyond60).toBe(cappedAt60);
  });

  it("treats a negative overdueByDays (not yet due) as zero bonus, never a negative bonus", () => {
    const notYetDue = computePriorityScore({ classification: "HOT", score: 50, overdueByDays: -20 });
    const noSignal = computePriorityScore({ classification: "HOT", score: 50, overdueByDays: null });
    expect(notYetDue).toBe(noSignal);
  });

  it("buckets exactly at the documented thresholds", () => {
    expect(bucketPriority(PRIORITY_HIGH_THRESHOLD)).toBe("HIGH");
    expect(bucketPriority(PRIORITY_HIGH_THRESHOLD - 0.01)).not.toBe("HIGH");
    expect(bucketPriority(PRIORITY_MEDIUM_THRESHOLD)).toBe("MEDIUM");
    expect(bucketPriority(PRIORITY_MEDIUM_THRESHOLD - 0.01)).toBe("LOW");
  });
});

/* -------------------------------------------------------------------------
 * buildDeterministicReasons — never fabricates a reorder cadence claim.
 * Test #4.
 * ---------------------------------------------------------------------- */

describe("buildDeterministicReasons", () => {
  it("always includes the classification+score reason", () => {
    const reasons = buildDeterministicReasons({
      classification: "HOT",
      score: 91,
      overdueByDays: null,
      averageReorderIntervalDays: null,
      latestOrderValue: null,
      averageOrderValue: null,
      productFitScore: 0,
      stateAlignment: "unknown",
    });
    expect(reasons).toContain("HOT classification (score 91)");
  });

  it("never invents a reorder-cadence reason when the signal is unavailable (insufficient order history)", () => {
    const reasons = buildDeterministicReasons({
      classification: "WARM",
      score: 55,
      overdueByDays: null,
      averageReorderIntervalDays: null,
      latestOrderValue: null,
      averageOrderValue: null,
      productFitScore: 0,
      stateAlignment: "unknown",
    });
    expect(reasons.some((r) => /overdue/i.test(r) || /cycle/i.test(r))).toBe(false);
  });

  it("includes a real overdue reason with the real cycle length when the signal is available", () => {
    const reasons = buildDeterministicReasons({
      classification: "HOT",
      score: 80,
      overdueByDays: 7,
      averageReorderIntervalDays: 35,
      latestOrderValue: null,
      averageOrderValue: null,
      productFitScore: 0,
      stateAlignment: "unknown",
    });
    expect(reasons).toContain("Overdue for reorder by 7 days (usual cycle ~35 days)");
  });

  it("phrases a non-overdue (negative) signal as not-yet-due rather than a fabricated overdue claim", () => {
    const reasons = buildDeterministicReasons({
      classification: "WARM",
      score: 60,
      overdueByDays: -10,
      averageReorderIntervalDays: 40,
      latestOrderValue: null,
      averageOrderValue: null,
      productFitScore: 0,
      stateAlignment: "unknown",
    });
    expect(reasons).toContain("Not yet due for reorder (usual cycle ~40 days)");
    expect(reasons.some((r) => /^Overdue/.test(r))).toBe(false);
  });

  it("only mentions the recent-order-value signal when it's real and actually above average", () => {
    const above = buildDeterministicReasons({
      classification: "HOT",
      score: 80,
      overdueByDays: null,
      averageReorderIntervalDays: null,
      latestOrderValue: 45000,
      averageOrderValue: 30000,
      productFitScore: 0,
      stateAlignment: "unknown",
    });
    expect(above.some((r) => r.includes("45,000"))).toBe(true);

    const below = buildDeterministicReasons({
      classification: "HOT",
      score: 80,
      overdueByDays: null,
      averageReorderIntervalDays: null,
      latestOrderValue: 10000,
      averageOrderValue: 30000,
      productFitScore: 0,
      stateAlignment: "unknown",
    });
    expect(below.some((r) => /Recent order value/.test(r))).toBe(false);
  });

  it("includes state-alignment reasons only for operating/target, never for none/unknown", () => {
    const operating = buildDeterministicReasons({
      classification: "HOT",
      score: 80,
      overdueByDays: null,
      averageReorderIntervalDays: null,
      latestOrderValue: null,
      averageOrderValue: null,
      productFitScore: 0,
      stateAlignment: "operating",
    });
    expect(operating).toContain("Within an operating state");

    const none = buildDeterministicReasons({
      classification: "HOT",
      score: 80,
      overdueByDays: null,
      averageReorderIntervalDays: null,
      latestOrderValue: null,
      averageOrderValue: null,
      productFitScore: 0,
      stateAlignment: "none",
    });
    expect(none.some((r) => /state/i.test(r))).toBe(false);
  });
});

describe("buildRuleBasedRecommendedAction", () => {
  it("maps HIGH -> Contact today", () => {
    expect(buildRuleBasedRecommendedAction("HIGH", "HOT")).toBe("Contact today");
  });
  it("maps MEDIUM+HOT and MEDIUM+WARM to distinct real templates", () => {
    expect(buildRuleBasedRecommendedAction("MEDIUM", "HOT")).toBe("Contact within 2 days");
    expect(buildRuleBasedRecommendedAction("MEDIUM", "WARM")).toBe("Follow up this week");
  });
  it("maps LOW to a monitor template", () => {
    expect(buildRuleBasedRecommendedAction("LOW", "WARM")).toMatch(/Monitor/);
  });
});

/* -------------------------------------------------------------------------
 * Product suggestion — real data only, never invented.
 * ---------------------------------------------------------------------- */

describe("findMatchingProductNames / pickDeterministicProductSuggestion", () => {
  const products = [
    { name: "Widget A", targetIndustryIds: ["ind_1"], targetBusinessTypeIds: [] },
    { name: "Widget B", targetIndustryIds: ["ind_2"], targetBusinessTypeIds: ["bt_1"] },
    { name: "Widget C", targetIndustryIds: [], targetBusinessTypeIds: [] },
  ];

  it("returns matching product names by industry or business type", () => {
    expect(findMatchingProductNames(products, "ind_1", null)).toEqual(["Widget A"]);
    expect(findMatchingProductNames(products, null, "bt_1")).toEqual(["Widget B"]);
  });

  it("returns an empty list (never a guess) when there is no industry/business type to match on", () => {
    expect(findMatchingProductNames(products, null, null)).toEqual([]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(findMatchingProductNames(products, "ind_999", "bt_999")).toEqual([]);
  });

  it("picks the first real match deterministically, or null when there is none", () => {
    expect(pickDeterministicProductSuggestion(["Widget A", "Widget B"])).toBe("Widget A");
    expect(pickDeterministicProductSuggestion([])).toBeNull();
  });
});

/* -------------------------------------------------------------------------
 * Data confidence rule.
 * ---------------------------------------------------------------------- */

describe("computeDataConfidence", () => {
  it("is HIGH for an Account with the reorder-timing signal", () => {
    expect(computeDataConfidence({ leadType: "accounts", hasReorderSignal: true, hasProductSuggestion: false, hasIndustryAndState: false })).toBe(
      "HIGH",
    );
  });
  it("is LOW for an Account without the reorder-timing signal (e.g. 0-1 orders)", () => {
    expect(
      computeDataConfidence({ leadType: "accounts", hasReorderSignal: false, hasProductSuggestion: true, hasIndustryAndState: true }),
    ).toBe("LOW");
  });
  it("is HIGH for a Prospect only when industry+state AND a real product match are both present", () => {
    expect(
      computeDataConfidence({ leadType: "prospects", hasReorderSignal: false, hasProductSuggestion: true, hasIndustryAndState: true }),
    ).toBe("HIGH");
  });
  it("is LOW for a Prospect missing either industry+state or a product match", () => {
    expect(
      computeDataConfidence({ leadType: "prospects", hasReorderSignal: false, hasProductSuggestion: false, hasIndustryAndState: true }),
    ).toBe("LOW");
    expect(
      computeDataConfidence({ leadType: "prospects", hasReorderSignal: false, hasProductSuggestion: true, hasIndustryAndState: false }),
    ).toBe("LOW");
  });
});

/* -------------------------------------------------------------------------
 * assemblePriorityCandidate — end-to-end pure assembly.
 * Test #2 (score/classification byte-identical to input, never altered).
 * ---------------------------------------------------------------------- */

describe("assemblePriorityCandidate", () => {
  const baseInput = {
    leadId: "acc_1",
    leadType: "accounts" as const,
    name: "Acme Retail",
    score: 91,
    classification: "HOT" as const,
    industryId: "ind_1",
    businessTypeId: null,
    stateId: "state_1",
    recencyDays: 7,
    averageOrderValue: 30000,
    productFitScore: 0.8,
    stateAlignment: "operating" as const,
    orderDates: [new Date("2026-06-01"), new Date("2026-07-06"), new Date("2026-08-10")],
    latestOrderValue: 45000,
    candidateProducts: [{ name: "Widget A", targetIndustryIds: ["ind_1"], targetBusinessTypeIds: [] }],
  };

  it("copies score and classification verbatim from the input — never recomputes or alters them", () => {
    const candidate = assemblePriorityCandidate(baseInput);
    expect(candidate.score).toBe(91);
    expect(candidate.classification).toBe("HOT");
  });

  it("computes a real priorityScore/priority and real reasons from the given signals", () => {
    const candidate = assemblePriorityCandidate(baseInput);
    expect(candidate.priority).toBe("HIGH");
    expect(candidate.deterministicReasons.length).toBeGreaterThan(0);
    expect(candidate.dataConfidence).toBe("HIGH"); // >=2 real orders -> reorder signal present
  });

  it("never fabricates a reorder signal or HIGH confidence for a lead with only 1 real order", () => {
    const candidate = assemblePriorityCandidate({ ...baseInput, orderDates: [new Date("2026-08-01")], latestOrderValue: 45000 });
    expect(candidate.deterministicReasons.some((r) => /overdue/i.test(r) || /cycle/i.test(r))).toBe(false);
    expect(candidate.dataConfidence).toBe("LOW");
  });

  it("never fabricates a product suggestion when no active product matches the lead's industry/business type", () => {
    const candidate = assemblePriorityCandidate({ ...baseInput, candidateProducts: [{ name: "Widget Z", targetIndustryIds: ["other"], targetBusinessTypeIds: [] }] });
    expect(candidate.deterministicProductSuggestion).toBeNull();
    expect(candidate.candidateProductNames).toEqual([]);
  });
});

/* -------------------------------------------------------------------------
 * rankCandidates
 * ---------------------------------------------------------------------- */

describe("rankCandidates", () => {
  it("sorts by priorityScore descending without mutating the input array", () => {
    const input = [
      { id: "a", priorityScore: 50 },
      { id: "b", priorityScore: 130 },
      { id: "c", priorityScore: 90 },
    ];
    const ranked = rankCandidates(input);
    expect(ranked.map((c) => c.id)).toEqual(["b", "c", "a"]);
    expect(input.map((c) => c.id)).toEqual(["a", "b", "c"]); // original order untouched
  });
});
