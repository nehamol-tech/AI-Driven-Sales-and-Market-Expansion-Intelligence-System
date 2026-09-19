import type { PrismaClient, User } from "@prisma/client";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import { signSessionToken } from "../../lib/jwt.js";
import { ConflictError, UnauthorizedError } from "../../lib/errors.js";
import type { BootstrapInput, LoginInput } from "./auth.schema.js";

export interface BootstrapResult {
  user: User;
  token: string;
}

/**
 * First-run flow: only succeeds when zero Company rows exist. Creates the
 * Company and the first ADMIN user together in one transaction.
 */
export async function bootstrapCompany(prisma: PrismaClient, input: BootstrapInput): Promise<BootstrapResult> {
  const existingCompanyCount = await prisma.company.count();
  if (existingCompanyCount > 0) {
    throw new ConflictError("A company has already been set up. Bootstrap is only available once.");
  }

  const passwordHash = await hashPassword(input.adminPassword);

  const user = await prisma.$transaction(async (tx) => {
    const company = await tx.company.create({
      data: {
        name: input.companyName,
        industry: input.companyIndustry,
      },
    });

    return tx.user.create({
      data: {
        email: input.adminEmail,
        passwordHash,
        name: input.adminName,
        role: "ADMIN",
        companyId: company.id,
      },
    });
  });

  const token = signSessionToken({ userId: user.id, role: user.role, companyId: user.companyId });
  return { user, token };
}

export interface LoginResult {
  user: User;
  token: string;
}

export async function authenticateUser(prisma: PrismaClient, input: LoginInput): Promise<LoginResult> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  if (!user || !user.isActive) {
    throw new UnauthorizedError("Invalid email or password");
  }

  const passwordMatches = await verifyPassword(input.password, user.passwordHash);
  if (!passwordMatches) {
    throw new UnauthorizedError("Invalid email or password");
  }

  const token = signSessionToken({ userId: user.id, role: user.role, companyId: user.companyId });
  return { user, token };
}

export async function getUserById(prisma: PrismaClient, userId: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { id: userId } });
}

/**
 * Public (unauthenticated) check for whether the first-run bootstrap has
 * already happened. Needed because GET /company requires auth and can't be
 * used to distinguish "not bootstrapped yet" from "just not logged in".
 */
export async function isBootstrapped(prisma: PrismaClient): Promise<boolean> {
  const count = await prisma.company.count();
  return count > 0;
}
