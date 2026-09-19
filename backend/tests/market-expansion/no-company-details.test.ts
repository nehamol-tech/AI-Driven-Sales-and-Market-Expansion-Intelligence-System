import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { describe, it, expect } from "vitest";

/* -------------------------------------------------------------------------
 * Test #14 — Company details (Company / CompanyOperatingState /
 * CompanyTargetState) must never be read anywhere in this feature. This is
 * an explicit, load-bearing constraint from the spec (mirrors Phase 3C's
 * detectors.ts precedent). Verified here by statically scanning every
 * source file in the market-expansion module, with comments stripped first
 * so the module's own doc-comments explaining the exclusion (which
 * necessarily mention these names in prose) don't produce a false failure.
 * ---------------------------------------------------------------------- */

const moduleDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/modules/market-expansion");

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("market-expansion module never reads Company/CompanyOperatingState/CompanyTargetState (test #14)", () => {
  const files = fs.readdirSync(moduleDir).filter((f) => f.endsWith(".ts"));

  it("found the expected module files to scan", () => {
    expect(files.length).toBeGreaterThanOrEqual(7);
  });

  for (const file of files) {
    it(`${file} contains no Company/CompanyOperatingState/CompanyTargetState reference outside comments`, () => {
      const raw = fs.readFileSync(path.join(moduleDir, file), "utf8");
      const code = stripComments(raw);
      expect(code).not.toMatch(/\bCompanyOperatingState\b/);
      expect(code).not.toMatch(/\bCompanyTargetState\b/);
      expect(code).not.toMatch(/\bCompany\b/);
      expect(code).not.toMatch(/\bcompanyOperatingState\b/);
      expect(code).not.toMatch(/\bcompanyTargetState\b/);
    });
  }
});
