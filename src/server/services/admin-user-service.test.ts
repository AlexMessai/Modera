import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import {
  AdminUserError,
  createAdminUser,
  listAdminUsers,
  revokeAdminSessions,
  updateAdminUser
} from "./admin-user-service";

const actorEmail = "admin-settings-owner-ci@example.test";
const targetEmail = "admin-settings-target-ci@example.test";

async function cleanup() {
  const admins = await prisma.adminUser.findMany({
    where: { email: { in: [actorEmail, targetEmail] } },
    select: { id: true }
  });
  const ids = admins.map((admin) => admin.id);
  if (ids.length) {
    await prisma.auditLog.deleteMany({ where: { actingAdminId: { in: ids } } });
    await prisma.adminSession.deleteMany({ where: { adminId: { in: ids } } });
    await prisma.adminUser.deleteMany({ where: { id: { in: ids } } });
  }
}

test("owner can create update and revoke administrator sessions", async () => {
  await cleanup();
  const actor = await prisma.adminUser.create({
    data: {
      email: actorEmail,
      displayName: "Settings Owner",
      passwordHash: "ci-owner-hash",
      role: "OWNER",
      isActive: true
    }
  });

  try {
    const created = await createAdminUser({
      actingAdminId: actor.id,
      email: targetEmail.toUpperCase(),
      displayName: "Settings Moderator",
      role: "MODERATOR",
      password: "moderator-password-123"
    });
    assert.equal(created.email, targetEmail);
    assert.equal(created.role, "MODERATOR");
    assert.equal(created.isActive, true);

    await prisma.adminSession.create({
      data: {
        adminId: created.id,
        tokenHash: `settings-ci-${created.id}`,
        expiresAt: new Date(Date.now() + 60_000)
      }
    });

    const listed = await listAdminUsers();
    const targetBefore = listed.find((user) => user.id === created.id);
    assert.equal(targetBefore?.activeSessionCount, 1);

    const revoked = await revokeAdminSessions({
      actingAdminId: actor.id,
      targetAdminId: created.id
    });
    assert.equal(revoked.revokedSessionCount, 1);

    const updated = await updateAdminUser({
      actingAdminId: actor.id,
      targetAdminId: created.id,
      displayName: "Settings Admin",
      role: "ADMIN"
    });
    assert.equal(updated.displayName, "Settings Admin");
    assert.equal(updated.role, "ADMIN");
    assert.equal(updated.activeSessionCount, 0);

    const actions = await prisma.auditLog.findMany({
      where: { actingAdminId: actor.id },
      select: { action: true }
    });
    assert.deepEqual(
      new Set(actions.map((item) => item.action)),
      new Set([
        "ADMIN_ACCOUNT_CREATED",
        "ADMIN_SESSIONS_REVOKED",
        "ADMIN_ACCOUNT_UPDATED"
      ])
    );
  } finally {
    await cleanup();
  }
});

test("owner cannot disable or change own role", async () => {
  await cleanup();
  const actor = await prisma.adminUser.create({
    data: {
      email: actorEmail,
      displayName: "Self Protected Owner",
      passwordHash: "ci-owner-hash",
      role: "OWNER",
      isActive: true
    }
  });

  try {
    await assert.rejects(
      () => updateAdminUser({
        actingAdminId: actor.id,
        targetAdminId: actor.id,
        isActive: false
      }),
      (error: unknown) =>
        error instanceof AdminUserError &&
        error.code === "SELF_DEACTIVATION_FORBIDDEN"
    );

    await assert.rejects(
      () => updateAdminUser({
        actingAdminId: actor.id,
        targetAdminId: actor.id,
        role: "ADMIN"
      }),
      (error: unknown) =>
        error instanceof AdminUserError &&
        error.code === "SELF_ROLE_CHANGE_FORBIDDEN"
    );

    const unchanged = await prisma.adminUser.findUniqueOrThrow({
      where: { id: actor.id }
    });
    assert.equal(unchanged.role, "OWNER");
    assert.equal(unchanged.isActive, true);
  } finally {
    await cleanup();
  }
});
