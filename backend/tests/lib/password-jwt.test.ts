import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../../src/lib/password.js";
import { signSessionToken, verifySessionToken } from "../../src/lib/jwt.js";

describe("password hashing", () => {
  it("hashes a password to a bcrypt hash distinct from the plaintext", async () => {
    const hash = await hashPassword("SuperSecret123!");
    expect(hash).not.toEqual("SuperSecret123!");
    expect(hash.startsWith("$2")).toBe(true);
  });

  it("verifies a correct password against its hash", async () => {
    const hash = await hashPassword("SuperSecret123!");
    await expect(verifyPassword("SuperSecret123!", hash)).resolves.toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("SuperSecret123!");
    await expect(verifyPassword("WrongPassword", hash)).resolves.toBe(false);
  });
});

describe("session JWT issuance", () => {
  it("signs a token that verifies back to the same payload", () => {
    const payload = { userId: "user_1", role: "ADMIN" as const, companyId: "company_1" };
    const token = signSessionToken(payload);
    expect(typeof token).toBe("string");
    const decoded = verifySessionToken(token);
    expect(decoded).toEqual(payload);
  });

  it("throws when verifying a garbage token", () => {
    expect(() => verifySessionToken("not-a-real-token")).toThrow();
  });
});
