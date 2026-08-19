# Modera

Production-oriented Telegram management and moderation platform with a Russian-language admin panel.

## What works

- protected Russian-language admin panel;
- owner login backed by PostgreSQL sessions;
- PostgreSQL schema and versioned migrations;
- official Telegram Bot API integration;
- protected Telegram webhook using `X-Telegram-Bot-Api-Secret-Token`;
- real group/supergroup discovery;
- real bot membership and moderation-permission detection;
- real chat persistence in PostgreSQL;
- real Telegram user and chat-member synchronization from observed updates;
- administrator bootstrap through `getChatAdministrators`;
- membership statuses, joined/left timestamps and last activity;
- observed message persistence with idempotent message counters;
- Telegram `update_id` ordering protection so stale webhook deliveries cannot regress membership state;
- protected `/api/chats` and `/api/members` endpoints with server-side search/filtering;
- chat and participant lists with automatic 5-second refresh;
- participant profile with memberships and Telegram audit events;
- real participant/message metrics on the overview page;
- `/api/health` for backend, database and Telegram integration;
- audit events for discovered chats and membership changes;
- captcha for new supergroup members ("I'm not a bot" button) with a configurable timeout and kick/ban on failure, global default + per-chat override;
- appeals for warn/mute/ban submitted via bot DM (`/appeal` as a reply) and reviewed from the admin panel, with real unmute/unban on approval.

No fake users, chats, statistics or moderation actions are used.

## Architecture

```text
Telegram
  -> /api/telegram/webhook
  -> Telegram update handler
  -> Telegram adapter (official Bot API)
  -> Chat / member services
  -> Prisma
  -> PostgreSQL
  -> protected APIs
  -> Admin Panel
```

The current stage intentionally uses one Next.js full-stack deployment. Business logic remains separated into auth, Telegram, services and database layers. A separate worker/queue will be introduced for temporary punishments, delayed actions and retryable moderation jobs.

## Requirements

- Node.js 22.12+
- PostgreSQL 15+
- Telegram bot token
- public HTTPS URL for the production webhook

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
3. Optionally generate a long random `TELEGRAM_WEBHOOK_SECRET`. If it is absent, Modera derives a stable webhook secret from the server-side bot token.
4. Set `TELEGRAM_WEBHOOK_URL=https://your-domain.example/api/telegram/webhook`, or let the Vercel production deployment resolve its production URL automatically.
5. Deploy the application over HTTPS.
6. Run `npm run telegram:set-webhook` when configuring outside the automated Vercel production build.

The webhook subscribes to:

- `message`
- `edited_message`
- `my_chat_member`
- `chat_member`
- `chat_join_request`
- `callback_query`

`chat_member` updates are available only when Telegram's requirements are met, including bot administrator status and explicit subscription to this update type.

## End-to-end verification

1. Sign in to the admin panel.
2. Add the bot to a test group/supergroup and promote it to administrator.
3. Send a message or change a member's status.
4. Open **Чаты** and verify the real chat, Telegram ID, member count, bot status and moderation-relevant rights.
5. Open **Участники** and verify users observed from Telegram updates.
6. Open a participant profile and verify status, activity, message count and audit history.

## Environment variables

See `.env.example`.

Secrets are never exposed to the browser. `TELEGRAM_BOT_TOKEN`, database credentials, admin password and webhook secret are server-side only.

## Database and deployment

Prisma ORM 7 with the PostgreSQL driver adapter is used.

Apply migrations with:

```bash
npm run db:migrate
```

Create/update the initial owner with:

```bash
npm run db:seed
```

On Vercel, migrations and owner seeding run only for `VERCEL_ENV=production`. Preview deployments build the application but never mutate the production database. Production deployment also registers the Telegram webhook after a successful build.

## Security foundation

- database-backed opaque sessions;
- hashed session tokens;
- HTTP-only secure cookie in production;
- same-site cookie;
- same-origin login check;
- password hashing with bcrypt;
- protected API endpoints;
- constant-time Telegram webhook secret comparison;
- deterministic webhook-secret fallback without exposing the bot token;
- no bot token in frontend or logs;
- server-side authorization guard;
- ordered Telegram membership processing using `update_id`.

Full RBAC permission matrices, security event UI and rate limiting remain planned for the security stage.

## Health

`GET /api/health`

Checks:

- backend;
- PostgreSQL;
- Telegram Bot API.

The endpoint never returns secrets.

## CI

GitHub Actions runs against a clean PostgreSQL 17 service:

- dependency audit;
- Prisma generation;
- all database migrations;
- owner seed;
- TypeScript typecheck;
- ESLint;
- tests;
- production build.

## Telegram limitation

The Bot API does **not** provide a universal endpoint for downloading the full historical member list of an arbitrary group. Modera accumulates real users from Telegram updates and known administrators and clearly exposes that limitation in the UI instead of fabricating a complete list.

## Next stage

Richer statistics, per [docs/STAGE_3.md](docs/STAGE_3.md):

- per-chat analytics charts (messages, joins/leaves, punishments) without adding a chart library;
- worker/queue for delayed unmute/unban and retries (the current daily cron is an accepted, honestly-documented limitation);
- RBAC enforcement refinements for moderation actions.
