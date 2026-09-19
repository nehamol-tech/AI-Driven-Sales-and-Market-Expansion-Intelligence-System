/**
 * Every numeric/derived value shown in the product must be tagged with where it
 * came from. This is the core "no fabricated numbers" guardrail for the whole app.
 */
export const DATA_SOURCE_TYPES = [
  "COMPANY_DATA",
  "IMPORTED_DATA",
  "AI_ESTIMATE",
  "EXTERNAL_DATA",
  "USER_ASSUMPTION",
] as const;
export type DataSourceType = (typeof DATA_SOURCE_TYPES)[number];

export const DATA_SOURCE_LABELS: Record<DataSourceType, string> = {
  COMPANY_DATA: "Company data",
  IMPORTED_DATA: "Imported data",
  AI_ESTIMATE: "AI estimate",
  EXTERNAL_DATA: "External data",
  USER_ASSUMPTION: "User assumption",
};
