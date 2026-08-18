# Modera

Production-oriented foundation for a Telegram management and moderation platform.

## What works in stage 1

- protected Russian-language admin panel;
- owner login backed by PostgreSQL sessions;
- PostgreSQL schema and migration;
- official Telegram Bot API integration;
- protected Telegram webhook using `X-Telegram-Bot-Api-Secret-Token`;
- real group/supergroup discovery;
- real bot membership and permission detection;
- real chat persistence in PostgreSQL;
- real `/api/chats` endpoint with server-side search;
- chat list with automatic 5-second refresh;
- `/api/health` for backend, database and Telegram integration;
- audit event when a Telegram chat is first discovered.

No fake users, chats, statistics or moderation actions are used.

## Architecture

```text
Telegram
  -> /api/telegram/webhook
  -> Telegram update handler
  -> Telegram adapter (official Bot API)
  -> Chat service
  -> Prisma
  -> PostgreSQL
  -> /api/chats
  -> Admin Panel
```

The current stage intentionally uses one Next.js full-stack deployment to keep the first production flow small and reliable. Business logic is still separated into auth, Telegram, services and database layers. A separate worker/queue will be introduced when temporary punishments and retryable moderation jobs are implemented.

## Requirements

- Node.js 22.12+
- PostgreSQL 15+
- Telegram bot token
- public HTTPS URL for production webhook

## Local setup

```bash
cp .env.example .env
docker compose up -d
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Open `http://localhost:3000`.

## Telegram setup

1. Create a bot with BotFather.
2. Put the token in `TELEGRAM_BOT_TOKEN`.
3. Generate a long random `TELEGRAM_WEBHOOK_SECRET`.
4. Set `TELEGRAM_WEBHOOK_URL=https://your-domain.example/api/telegram/webhook`.
5. Deploy the application over HTTPS.
6. Run:

```bash
npm run telegram:set-webhook
```

The script registers these update types:

- `message`
- `edited_message`
- `my_chat_member`
- `chat_member`
- `chat_join_request`
- `callback_query`

`chat_member` updates are available only when Telegram's requirements are met, including bot administrator status and explicit subscription to this update type.

## First end-to-end verification

1. Sign in to the admin panel.
2. Configure and register the Telegram webhook.
3. Add the bot to a test group/supergroup.
4. Promote it to administrator.
5. Send a message or change the bot's membership.
6. Open **Чаты**.
7. Verify the real chat, Telegram ID, member count, bot status and moderation-relevant rights.

## Environment variables

See `.env.example`.

Secrets are never exposed to the browser. `TELEGRAM_BOT_TOKEN` and webhook secret are server-side only.

## Database

Prisma ORM 7 with PostgreSQL driver adapter is used.

Apply production migrations with:

```bash
npm run db:migrate
```

Create/update the initial owner:

```bash
npm run db:seed
```

## Security foundation

- database-backed opaque sessions;
- hashed session tokens;
- HTTP-only secure cookie in production;
- same-site cookie;
- same-origin login check;
- password hashing with bcrypt;
- protected API endpoints;
- constant-time Telegram webhook secret comparison;
- no bot token in frontend or logs;
- server-side authorization guard.

Full RBAC permission matrices, security event UI and rate limiting are planned in the security stage.

## Health

`GET /api/health`

Checks:

- backend;
- PostgreSQL;
- Telegram Bot API if a token is configured.

The endpoint never returns secrets.

## CI

GitHub Actions runs:

- Prisma generation
- TypeScript typecheck
- ESLint
- tests
- production build

## Telegram limitation

The Bot API does **not** provide a universal endpoint for downloading the full historical member list of an arbitrary group. Modera will accumulate known users from Telegram updates and clearly expose that limitation in the UI instead of fabricating a complete list.

## Next stage

Member synchronization:

- `TelegramUser`;
- `ChatMember`;
- `message`;
- `edited_message`;
- `chat_member`;
- `new_chat_members`;
- `left_chat_member`;
- `chat_join_request`;
- `callback_query`;
- member search, filters and profile;
- real-time update channel foundation.
