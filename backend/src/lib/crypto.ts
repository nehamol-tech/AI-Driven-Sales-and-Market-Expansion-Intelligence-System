import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { env } from "../config/env.js";

/**
 * First secrets-at-rest utility in this codebase (confirmed via full-repo
 * grep before writing this — nothing prior needed to persist a credential).
 * AES-256-GCM via Node's built-in `crypto` module — no new npm dependency.
 * Used exclusively by advertising/ad-connections.service.ts to encrypt OAuth
 * access/refresh tokens before they touch the DB.
 *
 * Pure and I/O-free: no Prisma, no network, fully unit-testable in isolation
 * (see tests/advertising/crypto.test.ts).
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12; // 96-bit IV, the size GCM is designed for
const KEY_LENGTH_BYTES = 32; // AES-256
// Fixed, non-secret salt for scrypt key derivation. It does not need to be
// secret or random — its only job is to let CREDENTIAL_ENCRYPTION_KEY be an
// arbitrary operator-supplied string (not a pre-formatted 32-byte hex key)
// while still deriving a fixed-length key deterministically.
const KDF_SALT = "ai-sales-expansion-engine:credential-encryption:v1";

/**
 * Thrown by both encryptSecret/decryptSecret when CREDENTIAL_ENCRYPTION_KEY
 * is unset. Callers (the OAuth connect/callback routes) must catch this
 * specific error and return an honest "not configured" response rather than
 * a generic 500 — mirrors how ad-connections.service.ts's getAuthorizeUrl
 * treats a missing *_CLIENT_ID as a typed "not configured" outcome, not a
 * crash.
 */
export class CredentialEncryptionNotConfiguredError extends Error {
  constructor() {
    super("CREDENTIAL_ENCRYPTION_KEY is not configured — credential encryption is unavailable");
    this.name = "CredentialEncryptionNotConfiguredError";
    Object.setPrototypeOf(this, CredentialEncryptionNotConfiguredError.prototype);
  }
}

function deriveKey(): Buffer {
  const secret = env.CREDENTIAL_ENCRYPTION_KEY;
  if (!secret) {
    throw new CredentialEncryptionNotConfiguredError();
  }
  return scryptSync(secret, KDF_SALT, KEY_LENGTH_BYTES);
}

/**
 * Encrypts `plaintext` and returns a single self-describing string:
 * `<iv>:<authTag>:<ciphertext>`, each hex-encoded. A fresh random IV is
 * generated per call, so encrypting the same plaintext twice yields two
 * different ciphertexts. `decryptSecret` is a pure inverse given only this
 * one string — no separate IV/tag storage needed by callers.
 */
export function encryptSecret(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Inverse of `encryptSecret`. Throws (rather than returning corrupted data)
 * if the ciphertext is malformed or has been tampered with — GCM's auth tag
 * check fails closed on `decipher.final()`.
 */
export function decryptSecret(ciphertext: string): string {
  const key = deriveKey();
  const parts = ciphertext.split(":");
  if (parts.length !== 3) {
    throw new Error("Malformed ciphertext: expected '<iv>:<authTag>:<ciphertext>' (all hex-encoded)");
  }
  const [ivHex, authTagHex, dataHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const data = Buffer.from(dataHex, "hex");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
}
