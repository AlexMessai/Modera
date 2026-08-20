import "dotenv/config";
import { GROUP_ADMIN_RIGHTS, TelegramClient } from "../src/server/telegram/client";

async function main() {
  if (process.env.VERCEL === "1" && process.env.VERCEL_ENV !== "production") {
    console.log("Skipping Telegram default admin rights setup outside Vercel production");
    return;
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("Missing required environment variable: TELEGRAM_BOT_TOKEN");
  }

  const client = new TelegramClient(token);
  const success = await client.setMyDefaultAdministratorRights(GROUP_ADMIN_RIGHTS);

  if (!success) throw new Error("Telegram did not accept default administrator rights");

  console.log("Default group administrator rights set:", GROUP_ADMIN_RIGHTS);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Default admin rights setup failed");
  process.exit(1);
});
