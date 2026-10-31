import { describe, it, expect, vi, afterEach } from "vitest";
import {
  FmsPagedApiClient,
  formatSheetDate,
  formatSheetDateHeader,
  legacyHeaderKey,
  parsePagedResponse,
  toLegacyRows,
} from "../../src/modules/fms/fms-paged.client.js";
import { env } from "../../src/config/env.js";
import { getFmsClient, isFmsConfigured } from "../../src/modules/fms/fms-client.factory.js";

/* Synthetic values; shapes mirror the live paginated Web App's responses. */

const BASE = "https://paged.example.test/exec";

function page(headers: unknown[], rows: unknown[][], o: { offset?: number; totalRows?: number; hasMore?: boolean; nextOffset?: number | null } = {}) {
  const offset = o.offset ?? 0;
  return {
    success: true,
    spreadsheetName: "Test",
    sheet: "S",
    headers,
    rows,
    returnedRows: rows.length,
    totalRows: o.totalRows ?? rows.length,
    offset,
    limit: rows.length,
    hasMore: o.hasMore ?? false,
    nextOffset: o.nextOffset === undefined ? (o.hasMore ? offset + rows.length : null) : o.nextOffset,
    fetchedAt: "2026-10-28T00:00:00.000Z",
  };
}

/** Serves `allRows` like the real Web App: `limit`/`offset` slicing, blank rows included, 1000-row page cap. */
function serveSheet(headers: unknown[], allRows: unknown[][]) {
  const calls: URL[] = [];
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    expect(init?.method).toBe("GET");
    expect(init?.body).toBeUndefined();
    const url = new URL(String(input));
    calls.push(url);
    const limit = Math.min(Number(url.searchParams.get("limit")), 1000);
    const offset = Number(url.searchParams.get("offset"));
    const rows = allRows.slice(offset, offset + limit);
    const hasMore = offset + rows.length < allRows.length;
    return new Response(JSON.stringify(page(headers, rows, { offset, totalRows: allRows.length, hasMore })), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

afterEach(() => vi.unstubAllGlobals());

describe("legacy formatting", () => {
  it("formats ISO UTC dates as India-local yyyy-MM-dd HH:mm:ss", () => {
    expect(formatSheetDate("2026-04-02T04:30:00.000Z")).toBe("2026-04-02 10:00:00");
    expect(formatSheetDate("2026-03-31T19:00:00.000Z")).toBe("2026-04-01 00:30:00"); // crosses midnight and month
    expect(formatSheetDate("1899-12-30T04:08:50.000Z")).toBe("1899-12-30 09:30:00"); // historical +05:21:10 offset
  });

  it("names headers like the original Web App", () => {
    expect(legacyHeaderKey("Bill No.", 1)).toBe("Bill No.");
    expect(legacyHeaderKey("Customer Name ", 0)).toBe("Customer Name");
    expect(legacyHeaderKey("", 5)).toBe("Column_6");
    expect(legacyHeaderKey(" ", 0)).toBe("Column_1");
    expect(legacyHeaderKey("0000001", 4)).toBe("0000001");
    expect(legacyHeaderKey("1899-12-30T04:08:50.000Z", 1)).toBe("Sat Dec 30 1899 09:30:00 GMT+0521 (India Standard Time)");
    expect(formatSheetDateHeader("1899-12-30T14:08:50.000Z")).toBe("Sat Dec 30 1899 19:30:00 GMT+0521 (India Standard Time)");
  });

  it("builds row objects in column order, keeping values, and skips all-empty rows", () => {
    const rows = toLegacyRows(
      ["टाइमस्टैम्प", "Bill No.", "Customer Name", "Notes", "", "Amount", "Customer Name"],
      [
        ["2026-04-02T04:30:00.000Z", 101, "First", "line 1\nline 2", "", 0, "Second"],
        ["", "", "", "", "", "", ""],
        ["not a date 2026-04-02", 102, "", "", "x", 12.5, ""],
      ],
    );
    expect(rows).toHaveLength(2);
    // duplicate header: first position, last column's value — exactly what the original returned
    expect(Object.keys(rows[0])).toEqual(["टाइमस्टैम्प", "Bill No.", "Customer Name", "Notes", "Column_5", "Amount"]);
    expect(rows[0]).toEqual({ "टाइमस्टैम्प": "2026-04-02 10:00:00", "Bill No.": 101, "Customer Name": "Second", Notes: "line 1\nline 2", Column_5: "", Amount: 0 });
    expect(rows[1]["टाइमस्टैम्प"]).toBe("not a date 2026-04-02"); // only exact ISO timestamps are converted
    expect(rows[1].Amount).toBe(12.5);
  });
});

describe("parsePagedResponse", () => {
  it("maps upstream rejections and malformed bodies", () => {
    expect(parsePagedResponse({ success: false, error: "Sheet is not allowed", allowedSheets: ["FMS"] })).toEqual({
      status: "upstream_rejected",
      error: "Sheet is not allowed",
      allowedSheets: ["FMS"],
    });
    expect(parsePagedResponse([]).status).toBe("malformed_response");
    expect(parsePagedResponse({ ...page(["a"], [["1"]]), rows: [{ a: 1 }] }).status).toBe("malformed_response");
    expect(parsePagedResponse({ ...page(["a"], [["1"]], { hasMore: true }), nextOffset: null }).status).toBe("malformed_response");
    expect(parsePagedResponse(page(["a"], [["1"]])).status).toBe("ok");
  });
});

describe("FmsPagedApiClient.fetchData", () => {
  const headers = ["Bill No.", "Status"];
  const sheet = (n: number) => Array.from({ length: n }, (_, i) => [i + 1, "Done"]);

  it("follows nextOffset until the limit is collected and returns the original response shape", async () => {
    const { calls } = serveSheet(headers, sheet(2500));
    const r = await new FmsPagedApiClient(BASE).fetchData({ sheet: "FMS", limit: 2200 });
    if (r.status !== "ok") throw new Error(r.status);
    expect(r.body).toMatchObject({ success: true, sheet: "S", count: 2200, totalRows: 2500 });
    expect(r.body.data[0]).toEqual({ "Bill No.": 1, Status: "Done" });
    expect(r.body.data[2199]["Bill No."]).toBe(2200);
    expect(calls.map((u) => [u.searchParams.get("sheet"), u.searchParams.get("limit"), u.searchParams.get("offset")])).toEqual([
      ["FMS", "1000", "0"],
      ["FMS", "1000", "1000"],
      ["FMS", "200", "2000"],
    ]);
  });

  it("stops at the end of the sheet, defaults to 1000 rows and caps at 10,000", async () => {
    serveSheet(headers, sheet(30));
    const all = await new FmsPagedApiClient(BASE).fetchData({ sheet: "S", limit: 10000 });
    expect(all.status === "ok" && all.body.count).toBe(30);

    const { calls } = serveSheet(headers, sheet(1500));
    const def = await new FmsPagedApiClient(BASE).fetchData({ sheet: "S" });
    expect(def.status === "ok" && def.body.count).toBe(1000);
    expect(calls).toHaveLength(1);

    serveSheet(headers, sheet(12000));
    const capped = await new FmsPagedApiClient(BASE).fetchData({ sheet: "S", limit: 50000 });
    expect(capped.status === "ok" && capped.body.count).toBe(10000);
  });

  it("counts only non-blank rows toward the limit, like the original Web App", async () => {
    const rows = [[1, "a"], ["", ""], ["", ""], [2, "b"], ["", ""], [3, "c"], [4, "d"]];
    serveSheet(headers, rows);
    const r = await new FmsPagedApiClient(BASE, 2).fetchData({ sheet: "S", limit: 3 });
    if (r.status !== "ok") throw new Error(r.status);
    expect(r.body.data.map((x) => x["Bill No."])).toEqual([1, 2, 3]);
    expect(r.body.totalRows).toBe(7);
  });

  it("reports network, HTTP, JSON and upstream errors without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("socket hang up"); }));
    expect(await new FmsPagedApiClient(BASE).fetchData({ sheet: "S" })).toEqual({ status: "network_error", message: "socket hang up" });

    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status: 500 })));
    expect(await new FmsPagedApiClient(BASE).fetchData({ sheet: "S" })).toEqual({ status: "network_error", message: "FMS API responded with HTTP 500" });

    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 200 })));
    expect((await new FmsPagedApiClient(BASE).fetchData({ sheet: "S" })).status).toBe("malformed_response");

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: false, error: "Sheet is not allowed", allowedSheets: [] }))));
    expect((await new FmsPagedApiClient(BASE).fetchData({ sheet: "X" })).status).toBe("upstream_rejected");
  });

  it("fails rather than mixing rows when headers change between pages or the offset doesn't advance", async () => {
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(n++ === 0 ? page(["A"], [["1"]], { hasMore: true }) : page(["B"], [["2"]], { offset: 1 })))));
    expect(await new FmsPagedApiClient(BASE).fetchData({ sheet: "S", limit: 5 })).toMatchObject({ status: "malformed_response" });

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(page(["A"], [["1"]], { hasMore: true, nextOffset: 0 })))));
    expect(await new FmsPagedApiClient(BASE).fetchData({ sheet: "S", limit: 5 })).toMatchObject({ status: "malformed_response" });
  });
});

describe("fms-client.factory routing", () => {
  const saved = { legacy: env.FMS_API_URL, paged: env.FMS_PAGED_API_URL };
  afterEach(() => {
    env.FMS_API_URL = saved.legacy;
    env.FMS_PAGED_API_URL = saved.paged;
  });

  function hostsCalled(): string[] {
    const hosts: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      hosts.push(new URL(String(input)).host);
      return new Response(JSON.stringify({ success: false, error: "stop", allowedSheets: [] }));
    }));
    return hosts;
  }

  it("uses the paginated Web App for every sheet, including FMS Response", async () => {
    env.FMS_API_URL = "https://legacy.example.test/exec";
    env.FMS_PAGED_API_URL = BASE;
    const hosts = hostsCalled();
    const client = getFmsClient()!;
    await client.fetchData({ sheet: "FMS", limit: 10 });
    await client.fetchData({ sheet: "Form responses 2", limit: 10000 });
    await client.fetchData({ sheet: "FMS Response", limit: 10000 });
    expect(hosts).toEqual(["paged.example.test", "paged.example.test", "paged.example.test"]);
  });

  it("falls back to the original Web App alone when FMS_PAGED_API_URL is unset", async () => {
    env.FMS_API_URL = "https://legacy.example.test/exec";
    env.FMS_PAGED_API_URL = undefined;
    const hosts = hostsCalled();
    await getFmsClient()!.fetchData({ sheet: "FMS", limit: 10 });
    expect(hosts).toEqual(["legacy.example.test"]);
  });

  it("is configured with either URL, and unconfigured with neither", () => {
    env.FMS_API_URL = undefined;
    env.FMS_PAGED_API_URL = BASE;
    expect(isFmsConfigured()).toBe(true);
    expect(getFmsClient()).not.toBeNull();
    env.FMS_PAGED_API_URL = undefined;
    expect(isFmsConfigured()).toBe(false);
    expect(getFmsClient()).toBeNull();
  });
});
