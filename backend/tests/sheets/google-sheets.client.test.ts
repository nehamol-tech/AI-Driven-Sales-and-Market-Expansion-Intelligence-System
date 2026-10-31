import { describe, it, expect, vi } from "vitest";
import { createVerify, generateKeyPairSync } from "node:crypto";
import {
  GoogleSheetsReadOnlyClient,
  GoogleSheetsApiError,
  SHEETS_READONLY_SCOPE,
  loadServiceAccountKey,
  wholeTabRange,
} from "../../src/modules/sheets/google-sheets.client.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const key = { client_email: "reader@project.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function fakeGoogle(sheetsResponses: Record<string, unknown> = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).startsWith("https://oauth2.googleapis.com/token")) return json({ access_token: "tok", expires_in: 3600 });
    const path = new URL(String(url)).pathname;
    return json(sheetsResponses[path] ?? {});
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("GoogleSheetsReadOnlyClient", () => {
  it("asks Google for the read-only scope only, with a correctly signed assertion", async () => {
    const { calls, fetchImpl } = fakeGoogle();
    await new GoogleSheetsReadOnlyClient(key, "sheet123", { fetchImpl }).getSpreadsheet();

    const tokenCall = calls.find((c) => c.url.includes("oauth2.googleapis.com"))!;
    const assertion = new URLSearchParams(String(tokenCall.init?.body)).get("assertion")!;
    const [header, claims, signature] = assertion.split(".");
    const decoded = JSON.parse(Buffer.from(claims, "base64url").toString());
    expect(decoded).toMatchObject({ iss: key.client_email, scope: SHEETS_READONLY_SCOPE, aud: "https://oauth2.googleapis.com/token" });
    expect(decoded.scope).not.toMatch(/\/auth\/spreadsheets(\s|$)|drive/);
    expect(createVerify("RSA-SHA256").update(`${header}.${claims}`).verify(publicKey, Buffer.from(signature, "base64url"))).toBe(true);
  });

  it("makes only GET requests to the Sheets API", async () => {
    const { calls, fetchImpl } = fakeGoogle();
    const client = new GoogleSheetsReadOnlyClient(key, "sheet123", { fetchImpl });
    await client.getSpreadsheet();
    await client.getValues([wholeTabRange("FMS Response")]);

    const sheetsCalls = calls.filter((c) => c.url.startsWith("https://sheets.googleapis.com/"));
    expect(sheetsCalls).toHaveLength(2);
    for (const c of sheetsCalls) {
      expect(c.init?.method).toBe("GET");
      expect(c.init?.body).toBeUndefined();
      expect(c.url).not.toMatch(/:batchUpdate|:append|:clear|values:batchClear/);
    }
    expect(calls.filter((c) => c.url.includes("oauth2"))).toHaveLength(1); // token reused
  });

  it("requests raw values with dates as displayed, and quotes tab names", async () => {
    const { calls, fetchImpl } = fakeGoogle({
      "/v4/spreadsheets/sheet123/values:batchGet": { valueRanges: [{ values: [["Bill No."], [101]] }, {}] },
    });
    const values = await new GoogleSheetsReadOnlyClient(key, "sheet123", { fetchImpl }).getValues(["'FMS Response'", wholeTabRange("Owner's tab")]);

    const url = new URL(calls.find((c) => c.url.includes("batchGet"))!.url);
    expect(url.searchParams.getAll("ranges")).toEqual(["'FMS Response'", "'Owner''s tab'"]);
    expect(url.searchParams.get("valueRenderOption")).toBe("UNFORMATTED_VALUE");
    expect(url.searchParams.get("dateTimeRenderOption")).toBe("FORMATTED_STRING");
    expect(values).toEqual([[["Bill No."], [101]], []]);
  });

  it("reports Google errors clearly (e.g. the sheet not shared with the service account)", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) =>
      String(url).includes("oauth2") ? json({ access_token: "tok" }) : json({ error: { message: "The caller does not have permission" } }, 403),
    ) as unknown as typeof fetch;
    await expect(new GoogleSheetsReadOnlyClient(key, "sheet123", { fetchImpl }).getSpreadsheet()).rejects.toMatchObject({
      name: "GoogleSheetsApiError",
      status: 403,
      message: expect.stringContaining("does not have permission"),
    });
    expect(GoogleSheetsApiError).toBeDefined();
  });

  it("loads a key from JSON text and rejects incomplete keys", () => {
    expect(loadServiceAccountKey(JSON.stringify(key)).client_email).toBe(key.client_email);
    expect(() => loadServiceAccountKey('{"client_email":"x"}')).toThrow(/private_key/);
  });
});
