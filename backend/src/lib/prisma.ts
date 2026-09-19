import { PrismaClient } from "@prisma/client";
import { env } from "../config/env.js";

declare global {
  var __prisma__: PrismaClient | undefined;
}

// Reuse a single PrismaClient instance across module reloads (dev) to avoid
// exhausting DB connections, standard Prisma-with-hot-reload pattern.
export const prisma: PrismaClient =
  globalThis.__prisma__ ??
  new PrismaClient({
    log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (env.NODE_ENV !== "production") {
  globalThis.__prisma__ = prisma;
}

export default prisma;
