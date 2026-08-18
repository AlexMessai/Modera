import bcrypt from "bcryptjs";
import type { PrismaClient } from "@/generated/prisma/client";

export type OwnerBootstrapResult =
  | { status: "created"; email: string }
  | { status: "existing"; email: string }
  | { status: "skipped_initialized"; email: string };

export async function bootstrapInitialOwner(
  prisma: PrismaClient,
  input: {
    email: string;
    password: string;
    displayName: string;
  }
): Promise<OwnerBootstrapResult> {
  const email = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim() || "Владелец";

  if (!email) throw new Error("ADMIN_EMAIL is required");
  if (input.password.length < 12) {
    throw new Error("ADMIN_PASSWORD must contain at least 12 characters");
  }

  const existing = await prisma.adminUser.findUnique({
    where: { email },
    select: { id: true }
  });
  if (existing) {
    return { status: "existing", email };
  }

  const adminCount = await prisma.adminUser.count();
  if (adminCount > 0) {
    return { status: "skipped_initialized", email };
  }

  const passwordHash = await bcrypt.hash(input.password, 12);
  await prisma.adminUser.create({
    data: {
      email,
      displayName,
      passwordHash,
      role: "OWNER",
      isActive: true
    }
  });

  return { status: "created", email };
}
