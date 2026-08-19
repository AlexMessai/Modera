import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import { consumeLinkCode, createLinkCode } from "./admin-link-service";

async function cleanup(emails: string[]) {
  await prisma.adminUser.deleteMany({ where: { email: { in: emails } } });
}

test("createLinkCode/consumeLinkCode links an admin and rejects an invalid or expired code", async () => {
  const email = "telegram-link-ci@example.com";
  await cleanup([email]);

  const admin = await prisma.adminUser.create({
    data: { email, displayName: "CI Link Admin", passwordHash: "not-used-in-test", role: "MODERATOR" }
  });

  try {
    const { code } = await createLinkCode(admin.id);

    const invalid = await consumeLinkCode("000000", { id: 555, username: "ci_link_admin" });
    assert.equal(invalid.outcome, "invalid_code");

    const linked = await consumeLinkCode(code, { id: 555, username: "ci_link_admin" });
    assert.equal(linked.outcome, "linked");
    assert.equal(linked.outcome === "linked" && linked.admin.telegramUserId, 555n);
    assert.equal(linked.outcome === "linked" && linked.admin.telegramUsername, "ci_link_admin");

    const reused = await consumeLinkCode(code, { id: 555 });
    assert.equal(reused.outcome, "invalid_code");
  } finally {
    await cleanup([email]);
  }
});

test("consumeLinkCode rejects linking a Telegram account already linked to another admin", async () => {
  const emailA = "telegram-link-ci-a@example.com";
  const emailB = "telegram-link-ci-b@example.com";
  await cleanup([emailA, emailB]);

  const adminA = await prisma.adminUser.create({
    data: { email: emailA, displayName: "CI Link Admin A", passwordHash: "not-used-in-test", role: "MODERATOR", telegramUserId: 777n }
  });
  const adminB = await prisma.adminUser.create({
    data: { email: emailB, displayName: "CI Link Admin B", passwordHash: "not-used-in-test", role: "MODERATOR" }
  });

  try {
    const { code } = await createLinkCode(adminB.id);
    const result = await consumeLinkCode(code, { id: 777 });
    assert.equal(result.outcome, "already_linked_elsewhere");
  } finally {
    await cleanup([emailA, emailB]);
  }
});
