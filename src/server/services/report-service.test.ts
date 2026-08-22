import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import {
  buildReportCallbackData,
  createReport,
  parseReportCallbackData,
  ReportError,
  resolveReport
} from "./report-service";
import { DEFAULT_REPORT_SETTINGS, updateChatReportSettings } from "./report-settings-service";

const CHAT_ID = -1009000015001n;
const REPORTER_ID = 900001501n;
const REPORTED_ID = 900001502n;
const ADMIN_EMAIL = "report-service-ci@example.com";
const MESSAGE_ID = 777001;

async function cleanup() {
  await prisma.chat.deleteMany({ where: { telegramChatId: CHAT_ID } });
  await prisma.telegramUser.deleteMany({ where: { telegramUserId: { in: [REPORTER_ID, REPORTED_ID] } } });
  await prisma.adminUser.deleteMany({ where: { email: ADMIN_EMAIL } });
}

async function setup() {
  const chat = await prisma.chat.create({
    data: { telegramChatId: CHAT_ID, title: "Report CI", type: "supergroup" }
  });
  const reporter = await prisma.telegramUser.create({
    data: { telegramUserId: REPORTER_ID, firstName: "Reporter", displayName: "Reporter User" }
  });
  const reported = await prisma.telegramUser.create({
    data: { telegramUserId: REPORTED_ID, firstName: "Reported", displayName: "Reported User" }
  });
  const admin = await prisma.adminUser.create({
    data: { email: ADMIN_EMAIL, displayName: "CI Moderator", passwordHash: "not-used-in-test", role: "MODERATOR" }
  });
  const reportedMember = await prisma.chatMember.create({
    data: { chatId: chat.id, userId: reported.id, status: "MEMBER" }
  });
  await prisma.chatMember.create({ data: { chatId: chat.id, userId: reporter.id, status: "MEMBER" } });
  // Explicit chat-level row rather than relying on the GLOBAL fallback --
  // report-settings-service.test.ts mutates the shared GlobalReportSettings
  // singleton, and node:test runs different test files concurrently against
  // the same real Postgres, so a test here that implicitly depended on the
  // global default could flake depending on that file's timing.
  await prisma.chatReportSettings.create({
    data: { chatId: chat.id, useGlobalProfile: false, enabled: true, muteDurationMinutes: DEFAULT_REPORT_SETTINGS.muteDurationMinutes }
  });

  return { chat, reporter, reported, admin, reportedMember };
}

test("buildReportCallbackData/parseReportCallbackData round-trip and reject malformed data", () => {
  const data = buildReportCallbackData("11111111-1111-4111-8111-111111111111", "MUTE");
  const parsed = parseReportCallbackData(data);
  assert.deepEqual(parsed, { reportId: "11111111-1111-4111-8111-111111111111", action: "MUTE" });

  assert.equal(parseReportCallbackData("appeal:11111111-1111-4111-8111-111111111111:APPROVE"), null);
  assert.equal(parseReportCallbackData("report:not-a-uuid:MUTE"), null);
  assert.equal(parseReportCallbackData("report:11111111-1111-4111-8111-111111111111:NUKE"), null);
});

test("createReport rejects self-reports and unknown users, otherwise writes a PENDING row + audit log", async () => {
  await cleanup();
  const { chat, reported } = await setup();

  try {
    const selfReport = await createReport({
      chatId: chat.id,
      reporterTelegramUserId: Number(REPORTER_ID),
      reportedTelegramUserId: Number(REPORTER_ID),
      messageTelegramId: MESSAGE_ID,
      reason: null
    });
    assert.equal(selfReport.outcome, "self_report");

    const unknownReporter = await createReport({
      chatId: chat.id,
      reporterTelegramUserId: 999999999,
      reportedTelegramUserId: Number(REPORTED_ID),
      messageTelegramId: MESSAGE_ID,
      reason: null
    });
    assert.equal(unknownReporter.outcome, "reporter_not_found");

    const unknownTarget = await createReport({
      chatId: chat.id,
      reporterTelegramUserId: Number(REPORTER_ID),
      reportedTelegramUserId: 999999998,
      messageTelegramId: MESSAGE_ID,
      reason: null
    });
    assert.equal(unknownTarget.outcome, "reported_user_not_found");

    const submitted = await createReport({
      chatId: chat.id,
      reporterTelegramUserId: Number(REPORTER_ID),
      reportedTelegramUserId: Number(REPORTED_ID),
      messageTelegramId: MESSAGE_ID,
      reason: "  спам  "
    });
    assert.equal(submitted.outcome, "submitted");
    if (submitted.outcome !== "submitted") return;

    const stored = await prisma.report.findUnique({ where: { id: submitted.reportId } });
    assert.equal(stored?.status, "PENDING");
    assert.equal(stored?.reason, "спам");
    assert.equal(stored?.reportedUserId, reported.id);

    const log = await prisma.auditLog.findFirst({ where: { chatId: chat.id, action: "REPORT_SUBMITTED" } });
    assert.ok(log);
  } finally {
    await cleanup();
  }
});

test("createReport respects the chat's report settings: disabled chats reject new reports", async () => {
  await cleanup();
  const { chat, admin } = await setup();

  try {
    await updateChatReportSettings({
      chatId: chat.id,
      actingAdminId: admin.id,
      settings: { ...DEFAULT_REPORT_SETTINGS, enabled: false }
    });

    const result = await createReport({
      chatId: chat.id,
      reporterTelegramUserId: Number(REPORTER_ID),
      reportedTelegramUserId: Number(REPORTED_ID),
      messageTelegramId: MESSAGE_ID,
      reason: null
    });
    assert.equal(result.outcome, "disabled");

    const count = await prisma.report.count({ where: { chatId: chat.id } });
    assert.equal(count, 0, "a disabled chat must not create a report row at all");
  } finally {
    await cleanup();
  }
});

test("resolveReport: DISMISS resolves without touching Telegram, and is idempotent on a second tap", async () => {
  await cleanup();
  const { chat, admin, reported } = await setup();

  try {
    const submitted = await createReport({
      chatId: chat.id,
      reporterTelegramUserId: Number(REPORTER_ID),
      reportedTelegramUserId: Number(REPORTED_ID),
      messageTelegramId: MESSAGE_ID,
      reason: "спам"
    });
    assert.equal(submitted.outcome, "submitted");
    if (submitted.outcome !== "submitted") return;

    const first = await resolveReport({ reportId: submitted.reportId, actingAdminId: admin.id, action: "DISMISS" });
    assert.equal(first.status, "DISMISSED");
    assert.equal(first.actionTaken, null);

    const second = await resolveReport({ reportId: submitted.reportId, actingAdminId: admin.id, action: "DISMISS" });
    assert.equal(second.status, "DISMISSED", "resolving an already-resolved report is a no-op, not an error");

    const log = await prisma.auditLog.findFirst({ where: { chatId: chat.id, action: "REPORT_DISMISSED" } });
    assert.ok(log);
    assert.equal(log?.affectedUserId, reported.id);
  } finally {
    await cleanup();
  }
});

test("resolveReport: DELETE resolves the report even though the Telegram delete call fails (no bot token in CI)", async () => {
  await cleanup();
  const { chat, admin } = await setup();

  try {
    const submitted = await createReport({
      chatId: chat.id,
      reporterTelegramUserId: Number(REPORTER_ID),
      reportedTelegramUserId: Number(REPORTED_ID),
      messageTelegramId: MESSAGE_ID,
      reason: null
    });
    assert.equal(submitted.outcome, "submitted");
    if (submitted.outcome !== "submitted") return;

    const result = await resolveReport({ reportId: submitted.reportId, actingAdminId: admin.id, action: "DELETE" });
    assert.equal(result.status, "RESOLVED");
    assert.equal(result.actionTaken, "DELETE");

    const stored = await prisma.report.findUnique({ where: { id: submitted.reportId } });
    assert.equal(stored?.status, "RESOLVED");
    assert.equal(stored?.resolutionAction, "DELETE");
  } finally {
    await cleanup();
  }
});

test("resolveReport: WARN resolves purely locally (no Telegram call needed for a warning)", async () => {
  await cleanup();
  const { chat, admin, reportedMember } = await setup();

  try {
    const submitted = await createReport({
      chatId: chat.id,
      reporterTelegramUserId: Number(REPORTER_ID),
      reportedTelegramUserId: Number(REPORTED_ID),
      messageTelegramId: MESSAGE_ID,
      reason: "оскорбления"
    });
    assert.equal(submitted.outcome, "submitted");
    if (submitted.outcome !== "submitted") return;

    const result = await resolveReport({ reportId: submitted.reportId, actingAdminId: admin.id, action: "WARN" });
    assert.equal(result.status, "RESOLVED");
    assert.equal(result.actionTaken, "WARN");

    const updatedMember = await prisma.chatMember.findUnique({ where: { id: reportedMember.id } });
    assert.equal(updatedMember?.warningCount, 1);
  } finally {
    await cleanup();
  }
});

test("resolveReport: MUTE/BAN surface a ReportError when the Telegram call fails, and leave the report PENDING", async () => {
  await cleanup();
  const { chat, admin } = await setup();

  try {
    const submitted = await createReport({
      chatId: chat.id,
      reporterTelegramUserId: Number(REPORTER_ID),
      reportedTelegramUserId: Number(REPORTED_ID),
      messageTelegramId: MESSAGE_ID,
      reason: "флуд"
    });
    assert.equal(submitted.outcome, "submitted");
    if (submitted.outcome !== "submitted") return;

    await assert.rejects(
      () => resolveReport({ reportId: submitted.reportId, actingAdminId: admin.id, action: "MUTE" }),
      ReportError
    );

    const stored = await prisma.report.findUnique({ where: { id: submitted.reportId } });
    assert.equal(stored?.status, "PENDING", "a failed Telegram call must not mark the report resolved");
  } finally {
    await cleanup();
  }
});
