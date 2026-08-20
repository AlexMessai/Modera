import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";
import { TelegramLoginError, verifyTelegramLoginPayload, type TelegramLoginPayload } from "./telegram-login";

const BOT_TOKEN = "123456:CI-test-token";

function sign(payload: Omit<TelegramLoginPayload, "hash">) {
  const dataCheckString = Object.entries(payload)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHash("sha256").update(BOT_TOKEN).digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  return { ...payload, hash };
}

test("accepts a correctly signed, recent payload", () => {
  const payload = sign({
    id: 42,
    first_name: "Алексей",
    username: "alex",
    auth_date: Math.floor(Date.now() / 1000)
  });
  assert.deepEqual(verifyTelegramLoginPayload(payload, BOT_TOKEN), payload);
});

test("rejects a payload signed with a different bot token", () => {
  const payload = sign({ id: 42, first_name: "Алексей", auth_date: Math.floor(Date.now() / 1000) });
  assert.throws(
    () => verifyTelegramLoginPayload(payload, "999999:different-token"),
    (error: unknown) => error instanceof TelegramLoginError && error.code === "INVALID_SIGNATURE"
  );
});

test("rejects a tampered field even if the hash is well-formed hex", () => {
  const payload = sign({ id: 42, first_name: "Алексей", auth_date: Math.floor(Date.now() / 1000) });
  const tampered = { ...payload, first_name: "Другое имя" };
  assert.throws(
    () => verifyTelegramLoginPayload(tampered, BOT_TOKEN),
    (error: unknown) => error instanceof TelegramLoginError && error.code === "INVALID_SIGNATURE"
  );
});

test("rejects a stale auth_date even with a valid signature", () => {
  const payload = sign({
    id: 42,
    first_name: "Алексей",
    auth_date: Math.floor(Date.now() / 1000) - 25 * 60 * 60
  });
  assert.throws(
    () => verifyTelegramLoginPayload(payload, BOT_TOKEN),
    (error: unknown) => error instanceof TelegramLoginError && error.code === "EXPIRED"
  );
});
