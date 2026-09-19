import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  AI_PROVIDER: z.enum(["openai", "anthropic", "mock"]).default("mock"),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  LEAD_RESCORE_COOLDOWN_HOURS: z.coerce.number().positive().default(24),
  META_ADS_CLIENT_ID: z.string().optional(),
  META_ADS_CLIENT_SECRET: z.string().optional(),
  GOOGLE_ADS_CLIENT_ID: z.string().optional(),
  GOOGLE_ADS_CLIENT_SECRET: z.string().optional(),
  CREDENTIAL_ENCRYPTION_KEY: z.string().optional(),
  // Read-only Google Apps Script Web App URL that proxies the FMS Google
  // Sheet. Optional — when unset, the /api/fms endpoint reports
  // `configured: false` rather than fabricating data (see fms-client.factory.ts).
  FMS_API_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  // Under vitest we don't want a missing .env to blow up test collection —
  // tests that need real env values set them explicitly.
  const isTest = process.env.NODE_ENV === "test" || process.env.VITEST === "true";

  const parsed = envSchema.safeParse({
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL ?? (isTest ? "postgresql://test:test@localhost:5432/test" : undefined),
    JWT_SECRET: process.env.JWT_SECRET ?? (isTest ? "test-secret-key-not-for-production-use-only" : undefined),
  });

  if (!parsed.success) {
    console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment configuration");
  }

  return parsed.data;
}

export const env = loadEnv();
