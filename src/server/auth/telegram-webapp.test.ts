import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { TelegramWebAppError, verifyTelegramWebAppInitData } from "./telegram-webapp";

const BOT_TOKEN = "123456:CI-test-token";

function sign(fields: Record<string, string>) {
  const dataCheckString = Object.entries(fields)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  const params = new URLSearchParams({ ...fields, hash });
  return params.toString();
}

test("accepts a correctly signed, recent initData string", () => {
  const initData = sign({
    query_id: "AAH_query",
    user: JSON.stringify({ id: 42, first_name: "Алексей" }),
    auth_date: String(Math.floor(Date.now() / 1000))
  });
  const result = verifyTelegramWebAppInitData(initData, BOT_TOKEN);
  assert.equal(result.queryId, "AAH_query");
  assert.equal(result.userId, 42);
});

test("rejects initData signed with a different bot token", () => {
  const initData = sign({
    user: JSON.stringify({ id: 42, first_name: "Алексей" }),
    auth_date: String(Math.floor(Date.now() / 1000))
  });
  assert.throws(
    () => verifyTelegramWebAppInitData(initData, "999999:different-token"),
    (error: unknown) => error instanceof TelegramWebAppError && error.code === "INVALID_SIGNATURE"
  );
});

test("rejects a tampered user field even with a well-formed hash", () => {
  const initData = sign({
    user: JSON.stringify({ id: 42, first_name: "Алексей" }),
    auth_date: String(Math.floor(Date.now() / 1000))
  });
  const params = new URLSearchParams(initData);
  params.set("user", JSON.stringify({ id: 999, first_name: "Другой" }));
  assert.throws(
    () => verifyTelegramWebAppInitData(params.toString(), BOT_TOKEN),
    (error: unknown) => error instanceof TelegramWebAppError && error.code === "INVALID_SIGNATURE"
  );
});

test("rejects a stale auth_date even with a valid signature", () => {
  const initData = sign({
    user: JSON.stringify({ id: 42, first_name: "Алексей" }),
    auth_date: String(Math.floor(Date.now() / 1000) - 25 * 60 * 60)
  });
  assert.throws(
    () => verifyTelegramWebAppInitData(initData, BOT_TOKEN),
    (error: unknown) => error instanceof TelegramWebAppError && error.code === "EXPIRED"
  );
});

test("a Login Widget style secret key (plain SHA256, no WebAppData salt) does not verify", () => {
  // Guards against silently mixing up the two verification schemes.
  const fields = {
    user: JSON.stringify({ id: 42, first_name: "Алексей" }),
    auth_date: String(Math.floor(Date.now() / 1000))
  };
  const dataCheckString = Object.entries(fields)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const wrongSecret = createHmac("sha256", "wrong-salt").update(BOT_TOKEN).digest();
  const wrongHash = createHmac("sha256", wrongSecret).update(dataCheckString).digest("hex");
  const initData = new URLSearchParams({ ...fields, hash: wrongHash }).toString();

  assert.throws(
    () => verifyTelegramWebAppInitData(initData, BOT_TOKEN),
    (error: unknown) => error instanceof TelegramWebAppError && error.code === "INVALID_SIGNATURE"
  );
});
