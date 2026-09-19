import { parse } from "csv-parse/sync";

export interface RawCsvRow {
  [column: string]: string | undefined;
}

/**
 * Parses CSV file content into an array of raw row objects keyed by
 * (trimmed, lower-cased) header name. Header matching is case-insensitive so
 * "Date", "date", "DATE" are all treated the same.
 */
export function parseCsvContent(content: string): RawCsvRow[] {
  const records = parse(content, {
    columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
    skip_empty_lines: true,
    trim: true,
    bom: true,
  }) as RawCsvRow[];
  return records;
}

export interface ReferenceLookupEntry {
  id: string;
  name: string;
}

export interface SalesImportLookups {
  /** key: lowercase state name -> state */
  statesByName: Map<string, ReferenceLookupEntry>;
  /** key: `${stateId}|${lowercase city name}` -> city */
  citiesByStateIdAndName: Map<string, ReferenceLookupEntry>;
  /** key: lowercase product name or lowercase sku -> product */
  productsByNameOrSku: Map<string, ReferenceLookupEntry>;
  /** key: lowercase industry name -> industry */
  industriesByName: Map<string, ReferenceLookupEntry>;
  /** key: lowercase email or lowercase name -> user */
  usersByEmailOrName: Map<string, ReferenceLookupEntry>;
}

export interface NormalizedSalesRow {
  date: Date;
  productId: string | null;
  customerName: string;
  stateId: string | null;
  cityId: string | null;
  industryId: string | null;
  quantity: number;
  orderValue: string;
  salespersonId: string | null;
  isNewCustomer: boolean;
}

export type NormalizeRowResult =
  | { success: true; data: NormalizedSalesRow }
  | { success: false; row: number; message: string };

const TRUE_VALUES = new Set(["true", "1", "yes", "y"]);

function readCell(row: RawCsvRow, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value.trim() !== "") {
      return value.trim();
    }
  }
  return undefined;
}

/**
 * Normalizes a single raw CSV row against existing DB reference data.
 * Pure function — no I/O — so it can be unit tested with fake lookup maps.
 * Any state/city/product/industry/salesperson value that is present in the
 * row but not found in `lookups` causes the row to fail with a clear
 * message, rather than being silently dropped or guessed.
 */
export function normalizeSalesCsvRow(row: RawCsvRow, rowNumber: number, lookups: SalesImportLookups): NormalizeRowResult {
  const fail = (message: string): NormalizeRowResult => ({ success: false, row: rowNumber, message });

  const dateRaw = readCell(row, "date");
  if (!dateRaw) {
    return fail("Missing required field: date");
  }
  const date = new Date(dateRaw);
  if (Number.isNaN(date.getTime())) {
    return fail(`Invalid date: "${dateRaw}"`);
  }

  const customerName = readCell(row, "customer", "customername", "customer_name");
  if (!customerName) {
    return fail("Missing required field: customer");
  }

  const quantityRaw = readCell(row, "quantity");
  if (!quantityRaw) {
    return fail("Missing required field: quantity");
  }
  const quantity = Number(quantityRaw);
  if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity <= 0) {
    return fail(`Invalid quantity: "${quantityRaw}" (must be a positive integer)`);
  }

  const orderValueRaw = readCell(row, "ordervalue", "order_value", "value", "amount");
  if (!orderValueRaw) {
    return fail("Missing required field: orderValue");
  }
  const orderValueNum = Number(orderValueRaw);
  if (!Number.isFinite(orderValueNum) || orderValueNum < 0) {
    return fail(`Invalid orderValue: "${orderValueRaw}" (must be a non-negative number)`);
  }
  const orderValue = orderValueNum.toFixed(2);

  let stateId: string | null = null;
  const stateRaw = readCell(row, "state");
  if (stateRaw) {
    const match = lookups.statesByName.get(stateRaw.toLowerCase());
    if (!match) {
      return fail(`State not found: "${stateRaw}"`);
    }
    stateId = match.id;
  }

  let cityId: string | null = null;
  const cityRaw = readCell(row, "city");
  if (cityRaw) {
    if (!stateId) {
      return fail(`City "${cityRaw}" given without a matching state`);
    }
    const match = lookups.citiesByStateIdAndName.get(`${stateId}|${cityRaw.toLowerCase()}`);
    if (!match) {
      return fail(`City not found: "${cityRaw}" in the given state`);
    }
    cityId = match.id;
  }

  let industryId: string | null = null;
  const industryRaw = readCell(row, "industry");
  if (industryRaw) {
    const match = lookups.industriesByName.get(industryRaw.toLowerCase());
    if (!match) {
      return fail(`Industry not found: "${industryRaw}"`);
    }
    industryId = match.id;
  }

  let productId: string | null = null;
  const productRaw = readCell(row, "product", "productname", "product_name", "sku");
  if (productRaw) {
    const match = lookups.productsByNameOrSku.get(productRaw.toLowerCase());
    if (!match) {
      return fail(`Product not found: "${productRaw}"`);
    }
    productId = match.id;
  }

  let salespersonId: string | null = null;
  const salespersonRaw = readCell(row, "salesperson", "salesperson_email", "salesperson_name");
  if (salespersonRaw) {
    const match = lookups.usersByEmailOrName.get(salespersonRaw.toLowerCase());
    if (!match) {
      return fail(`Salesperson not found: "${salespersonRaw}"`);
    }
    salespersonId = match.id;
  }

  const isNewCustomerRaw = readCell(row, "isnewcustomer", "is_new_customer", "newcustomer");
  const isNewCustomer = isNewCustomerRaw ? TRUE_VALUES.has(isNewCustomerRaw.toLowerCase()) : false;

  return {
    success: true,
    data: {
      date,
      productId,
      customerName,
      stateId,
      cityId,
      industryId,
      quantity,
      orderValue,
      salespersonId,
      isNewCustomer,
    },
  };
}
