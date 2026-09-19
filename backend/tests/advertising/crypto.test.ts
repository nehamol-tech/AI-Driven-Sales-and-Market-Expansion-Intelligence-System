import { describe, it, expect, beforeEach, afterEach } from "vitest";

/**
 * lib/crypto.ts reads env.CREDENTIAL_ENCRYPTION_KEY at call time (via
 * config/env.ts's already-loaded `env` object), so these tests mutate
 * `env.CREDENTIAL_ENCRYPTION_KEY` directly (env.ts freezes nothing) rather
 * than trying to re-import the module with different process.env — mirrors
 * how other tests in this suite that need to flip an env-derived behavior
 * do it (see e.g. ai-provider.factory usage patterns elsewhere).
 */
import { env } from "../../src/config/env.js";
import { encryptSecret, decryptSecret, CredentialEncryptionNotConfiguredError } from "../../src/lib/crypto.js";

describe("lib/crypto.ts", () => {
  const originalKey = env.CREDENTIAL_ENCRYPTION_KEY;

  afterEach(() => {
    env.CREDENTIAL_ENCRYPTION_KEY = originalKey;
  });

  describe("with CREDENTIAL_ENCRYPTION_KEY configured", () => {
    beforeEach(() => {
      env.CREDENTIAL_ENCRYPTION_KEY = "test-encryption-key-do-not-use-in-prod";
    });

    it("round-trips: decryptSecret(encryptSecret(x)) === x", () => {
      const plaintext = "sk-real-looking-oauth-access-token-value-12345";
      const ciphertext = encryptSecret(plaintext);
      expect(decryptSecret(ciphertext)).toBe(plaintext);
    });

    it("round-trips an empty-ish but non-trivial string and unicode content", () => {
      const plaintext = "token-with-unicode-éüñ-chars";
      const ciphertext = encryptSecret(plaintext);
      expect(decryptSecret(ciphertext)).toBe(plaintext);
    });

    it("produces a different ciphertext each time for the same plaintext (random IV)", () => {
      const plaintext = "same-secret-value";
      const a = encryptSecret(plaintext);
      const b = encryptSecret(plaintext);
      expect(a).not.toBe(b);
      // Both still decrypt correctly despite differing.
      expect(decryptSecret(a)).toBe(plaintext);
      expect(decryptSecret(b)).toBe(plaintext);
    });

    it("returns a colon-joined iv:authTag:ciphertext string, each hex-encoded", () => {
      const ciphertext = encryptSecret("hello");
      const parts = ciphertext.split(":");
      expect(parts).toHaveLength(3);
      for (const part of parts) {
        expect(part).toMatch(/^[0-9a-f]+$/);
      }
    });

    it("throws (does not silently return corrupted data) when the ciphertext body is tampered with — GCM auth tag catches it", () => {
      const ciphertext = encryptSecret("a secret token");
      const [iv, authTag, data] = ciphertext.split(":");
      // Flip a hex character in the ciphertext body itself.
      const tamperedChar = data[0] === "0" ? "1" : "0";
      const tamperedData = tamperedChar + data.slice(1);
      const tampered = `${iv}:${authTag}:${tamperedData}`;
      expect(() => decryptSecret(tampered)).toThrow();
    });

    it("throws when the auth tag itself is tampered with", () => {
      const ciphertext = encryptSecret("another secret");
      const [iv, authTag, data] = ciphertext.split(":");
      const tamperedChar = authTag[0] === "0" ? "1" : "0";
      const tamperedTag = tamperedChar + authTag.slice(1);
      const tampered = `${iv}:${tamperedTag}:${data}`;
      expect(() => decryptSecret(tampered)).toThrow();
    });

    it("throws on a malformed ciphertext string (wrong number of parts)", () => {
      expect(() => decryptSecret("not-a-valid-ciphertext")).toThrow();
      expect(() => decryptSecret("only:two")).toThrow();
    });
  });

  describe("without CREDENTIAL_ENCRYPTION_KEY configured", () => {
    beforeEach(() => {
      env.CREDENTIAL_ENCRYPTION_KEY = undefined;
    });

    it("encryptSecret throws CredentialEncryptionNotConfiguredError", () => {
      expect(() => encryptSecret("anything")).toThrow(CredentialEncryptionNotConfiguredError);
    });

    it("decryptSecret throws CredentialEncryptionNotConfiguredError", () => {
      expect(() => decryptSecret("iv:tag:data")).toThrow(CredentialEncryptionNotConfiguredError);
    });
  });
});
