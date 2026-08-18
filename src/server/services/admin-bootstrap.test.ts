import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import { bootstrapInitialOwner } from "./admin-bootstrap";

test("owner bootstrap does not overwrite an existing administrator", async () => {
  const email = "bootstrap-existing-ci@example.test";
  await prisma.adminUser.deleteMany({ where: { email } });

  const existing = await prisma.adminUser.create({
    data: {
      email,
      displayName: "Existing Admin",
      passwordHash: "original-password-hash",
      role: "VIEWER",
      isActive: false
    }
  });

  try {
    const result = await bootstrapInitialOwner(prisma, {
      email: email.toUpperCase(),
      password: "replacement-password-123",
      displayName: "Replacement Owner"
    });

    assert.deepEqual(result, { status: "existing", email });

    const after = await prisma.adminUser.findUniqueOrThrow({
      where: { id: existing.id }
    });
    assert.equal(after.displayName, "Existing Admin");
    assert.equal(after.passwordHash, "original-password-hash");
    assert.equal(after.role, "VIEWER");
    assert.equal(after.isActive, false);
  } finally {
    await prisma.adminUser.delete({ where: { id: existing.id } });
  }
});

test("owner bootstrap does not create a new owner after admin initialization", async () => {
  const blockerEmail = "bootstrap-blocker-ci@example.test";
  const newEmail = "bootstrap-new-owner-ci@example.test";
  await prisma.adminUser.deleteMany({
    where: { email: { in: [blockerEmail, newEmail] } }
  });

  const blocker = await prisma.adminUser.create({
    data: {
      email: blockerEmail,
      displayName: "Bootstrap Blocker",
      passwordHash: "bootstrap-blocker-hash",
      role: "ADMIN",
      isActive: true
    }
  });

  try {
    const result = await bootstrapInitialOwner(prisma, {
      email: newEmail,
      password: "new-owner-password-123",
      displayName: "Should Not Exist"
    });

    assert.deepEqual(result, {
      status: "skipped_initialized",
      email: newEmail
    });
    assert.equal(
      await prisma.adminUser.count({ where: { email: newEmail } }),
      0
    );
  } finally {
    await prisma.adminUser.delete({ where: { id: blocker.id } });
  }
});
