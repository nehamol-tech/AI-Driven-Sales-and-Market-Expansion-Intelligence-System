import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Read-only Google Sheets API v4 client.
 *
 * Read-only is enforced twice:
 * - by Google: the access token is requested with ONLY the
 *   `spreadsheets.readonly` scope, so Google rejects any write even if one
 *   were attempted;
 * - by this code: the only Sheets request it can make is a GET (spreadsheet
 *   metadata, cell values). There is no update/append/clear/batchUpdate path.
 * The one POST is to Google's OAuth token endpoint, to exchange the
 * service-account assertion for that read-only token.
 *
 * Auth is a service account (the spreadsheet is shared with its email as
 * Viewer). No Google client library is needed: the JWT assertion is signed
 * with node:crypto (RS256).
 */

export const SHEETS_READONLY_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";

export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

/** Loads a service-account key from a JSON file path, or from the JSON text itself. */
export function loadServiceAccountKey(pathOrJson: string): ServiceAccountKey {
  const text = pathOrJson.trim().startsWith("{") ? pathOrJson : readFileSync(pathOrJson, "utf8");
  const key = JSON.parse(text) as Partial<ServiceAccountKey>;
  if (!key.client_email || !key.private_key) throw new Error("Service-account key is missing client_email or private_key");
  return { client_email: key.client_email, private_key: key.private_key, token_uri: key.token_uri };
}

export interface SheetTabProperties {
  sheetId: number;
  title: string;
  index: number;
  hidden?: boolean;
  sheetType?: string;
  gridProperties?: { rowCount?: number; columnCount?: number };
}

export interface SpreadsheetMetadata {
  spreadsheetId: string;
  properties: { title: string; timeZone?: string };
  sheets: { properties: SheetTabProperties }[];
}

export type CellValue = string | number | boolean;

/** A1 range for a whole tab: 'Tab name' (single quotes doubled). */
export function wholeTabRange(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

export class GoogleSheetsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GoogleSheetsApiError";
  }
}

export interface GoogleSheetsClientOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export class GoogleSheetsReadOnlyClient {
  private token: { value: string; expiresAtMs: number } | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(
    private readonly key: ServiceAccountKey,
    readonly spreadsheetId: string,
    options: GoogleSheetsClientOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  /** Signed JWT asking for the read-only scope only. */
  private assertion(): string {
    const iat = Math.floor(this.now() / 1000);
    const encode = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
    const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
      iss: this.key.client_email,
      scope: SHEETS_READONLY_SCOPE,
      aud: this.key.token_uri ?? DEFAULT_TOKEN_URI,
      iat,
      exp: iat + 3600,
    })}`;
    const signature = createSign("RSA-SHA256").update(unsigned).sign(this.key.private_key).toString("base64url");
    return `${unsigned}.${signature}`;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.now() < this.token.expiresAtMs - 60_000) return this.token.value;
    const res = await this.fetchImpl(this.key.token_uri ?? DEFAULT_TOKEN_URI, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: this.assertion() }).toString(),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
    if (!res.ok || !body.access_token) {
      throw new GoogleSheetsApiError(`Google sign-in failed: ${body.error_description ?? body.error ?? `HTTP ${res.status}`}`, res.status);
    }
    this.token = { value: body.access_token, expiresAtMs: this.now() + (body.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }

  /** The only Sheets request this client makes: a GET. */
  private async get<T>(path: string, params: URLSearchParams): Promise<T> {
    const url = `${SHEETS_API}/${encodeURIComponent(this.spreadsheetId)}${path}?${params.toString()}`;
    const res = await this.fetchImpl(url, { method: "GET", headers: { Authorization: `Bearer ${await this.accessToken()}` } });
    const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
    if (!res.ok) throw new GoogleSheetsApiError(`Google Sheets API: ${body.error?.message ?? `HTTP ${res.status}`}`, res.status);
    return body;
  }

  /** Spreadsheet title and every tab (name, position, grid size, hidden). */
  getSpreadsheet(): Promise<SpreadsheetMetadata> {
    return this.get<SpreadsheetMetadata>(
      "",
      new URLSearchParams({
        fields: "spreadsheetId,properties(title,timeZone),sheets(properties(sheetId,title,index,hidden,sheetType,gridProperties(rowCount,columnCount)))",
      }),
    );
  }

  /**
   * Cell values for several A1 ranges at once — raw values (numbers stay
   * numbers), dates/times as the sheet displays them. Trailing empty rows and
   * cells are omitted by Google.
   */
  async getValues(ranges: string[]): Promise<CellValue[][][]> {
    const params = new URLSearchParams({ valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "FORMATTED_STRING", majorDimension: "ROWS" });
    for (const range of ranges) params.append("ranges", range);
    const body = await this.get<{ valueRanges?: { values?: CellValue[][] }[] }>("/values:batchGet", params);
    return ranges.map((_, i) => body.valueRanges?.[i]?.values ?? []);
  }
}
