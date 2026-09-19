import type { PrismaClient, User } from "@prisma/client";
import { ConflictError, NotFoundError } from "../../lib/errors.js";
import { hashPassword } from "../../lib/password.js";
import type { CreateUserInput, UpdateUserInput } from "./users.schema.js";

export async function listUsers(prisma: PrismaClient, companyId: string): Promise<User[]> {
  return prisma.user.findMany({ where: { companyId }, orderBy: { createdAt: "asc" } });
}

export async function createUser(prisma: PrismaClient, companyId: string, input: CreateUserInput): Promise<User> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new ConflictError("A user with this email already exists");
  }

  const passwordHash = await hashPassword(input.password);

  return prisma.user.create({
    data: {
      email: input.email,
      name: input.name,
      role: input.role,
      passwordHash,
      companyId,
    },
  });
}

export async function updateUser(
  prisma: PrismaClient,
  companyId: string,
  userId: string,
  input: UpdateUserInput,
): Promise<User> {
  const existing = await prisma.user.findFirst({ where: { id: userId, companyId } });
  if (!existing) {
    throw new NotFoundError("User not found");
  }

  return prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });
}

/** Soft delete: sets isActive=false. Never hard-deletes, to preserve FK integrity with SalesRecord.salesperson. */
export async function deactivateUser(prisma: PrismaClient, companyId: string, userId: string): Promise<User> {
  const existing = await prisma.user.findFirst({ where: { id: userId, companyId } });
  if (!existing) {
    throw new NotFoundError("User not found");
  }
  return prisma.user.update({ where: { id: userId }, data: { isActive: false } });
}
