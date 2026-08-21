# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Modera — a production-oriented Telegram group management/moderation bot with a Russian-language
admin panel. Single Next.js app: Telegram webhook handler, business-logic services, and admin UI
all live in one deployment. No fake data or simulated actions anywhere — every feature only shows
real Telegram-observed state; honest limitations (things the Bot API genuinely can't do) are
documented per stage in `docs/STAGE_*.md` rather than worked around with fake UI.

## Commands

```bash
npm run dev              # local dev server
npm run typecheck        # tsc --noEmit
npm run lint             # eslint .
npm test                 # runs the full test list below
npm run build             # next build
npm run db:migrate:dev    # create + apply a new migration locally (needs a running Postgres)
npm run db:migrate        # prisma migrate deploy (used in CI and in vercel-build)
npm run db:seed           # create/update the owner admin account (ADMIN_EMAIL/ADMIN_PASSWORD/ADMIN_NAME)
npm run telegram:set-webhook   # tsx scripts/set-webhook.ts
```

- **Run a single test file**: `node --import tsx --test src/server/services/<file>.test.ts`
  (the `test` script in package.json just lists every `*.test.ts` file explicitly — there's no
  glob — so a newly added test file must also be appended to that script string).
- Local Postgres via `docker compose up -d`, then `cp .env.example .env` and fill it in.
- Tests hit a **real Postgres** via `DATABASE_URL` (no mocking layer) — see Testing below.

## Architecture

### Request flow

```
Telegram → /api/telegram/webhook → processTelegramUpdate (src/server/telegram/update-handler.ts)
                                        ├─ chat.type === "private" → processPrivateMessage
                                        │     (bot DM commands: /start /help /status /unmute /appeal)
                                        └─ chat.type === group/supergroup → sync chat/members/messages,
                                              run automod, anti-raid, captcha, appeal-notification hooks
```

`update-handler.ts` is the single dispatch point for every Telegram update type (`message`,
`edited_message`, `chat_member`, `my_chat_member`, `chat_join_request`, `callback_query`). Reading
this file top-to-bottom is the fastest way to see how a feature actually gets triggered — most
services are wired in from here, not from the admin API routes.

### Server layers

- `src/server/telegram/client.ts` — thin wrapper around the Bot API. `getTelegramClient()` throws
  if `TELEGRAM_BOT_TOKEN` is unset; **always call it inside the surrounding `try` block**, never
  assign it to a variable before the `try` — otherwise a missing/misconfigured token skips the
  intended graceful-degradation path entirely (this has caused real, silent bugs in this repo).
- `src/server/services/*` — all business logic. Two recurring patterns:
  - **Global + per-chat settings with inheritance**: `Global<X>Settings` / `Chat<X>Settings` tables,
    a `useGlobalProfile` boolean, and a `resolveEffective<X>Settings(chatId)` helper that returns
    `{ source: "CHAT" | "GLOBAL", settings }`. See `captcha-settings-service.ts`,
    `chat-moderation-settings-service.ts`, `manual-moderation-settings-service.ts` for the canonical
    shape — copy one of these exactly when adding a new configurable feature rather than inventing a
    new shape.
  - **Moderation actions funnel through `moderation-service.ts`**: `executeModerationAction` (admin),
    `executeAutomatedModerationAction` (automod escalation), `executeExpiredMuteRelease` (cron),
    `executeSelfServiceUnmute` (self-unmute) all delegate to the private `executeTelegramBackedAction`,
    which does the Telegram call + `ChatMember` update + `ModerationAction` row + `AuditLog` row as
    one unit, and throws `ModerationError` with a stable `.code` for callers to branch on (e.g.
    `NOT_MUTED`, `TARGET_PROTECTED`).
- Notification services (`appeal-notification-service.ts`) send Telegram DMs best-effort — every
  call site wraps them in `.catch(() => undefined)` because a user who never started a chat with
  the bot cannot be messaged first (Bot API limitation), and that must never block the underlying
  moderation action.
- `AuditLog` is the single audit trail for everything (Telegram-sourced, admin, or system/automated
  events). `journal-service.ts` filters it through an explicit **action-name whitelist**
  (`JOURNAL_ACTIONS` and friends) for the admin "Журнал" page — a new action type must be added to
  that whitelist or it silently never appears there, even though the row exists in the DB.

### Admin panel (`src/app/(admin)/*`)

Each admin section is a server component page (`page.tsx`) that fetches via a `*-service.ts` and
renders a paired `"use client"` component from `src/components/*-client.tsx` (list + filters +
actions, polling via `setInterval`, not websockets). Per-page CSS lives in `src/app/<name>.css` and
must be imported once in `src/app/layout.tsx` — there's no CSS-in-JS. Shared primitives
(`.panel`, `.metric-card`, `.metrics-grid`, `.moderation-confirm`, `.badge`, ...) live in
`globals.css`; check there before inventing a new class name for something generic-looking.

Route protection: `src/server/auth/guards.ts` (`requireAdminPage`/`requireAdminApi`/
`requireModerationApi`) + `src/server/auth/permissions.ts` (role → capability checks, e.g.
`canModerate`, `canManageChatSettings`). Mutating API routes also call `isSameOrigin(request)`.

### Database

Prisma 7 with the `prisma-client` generator (output at `src/generated/prisma`, gitignored, import
enums/types from `@/generated/prisma/client`). Migrations under `prisma/migrations/` are timestamp-
named folders with a single `migration.sql` — write them by hand to exactly match the
`schema.prisma` diff when you can't run `prisma migrate dev` against a live database, matching the
style of existing migrations (explicit `CONSTRAINT`/`CREATE INDEX` names, no down-migrations).

**Production `DATABASE_URL` must be Neon's *direct* connection string, not the `-pooler` one.**
`prisma migrate deploy` acquires a Postgres advisory lock, which PgBouncer's transaction-pooling
mode doesn't preserve across statements — this reliably breaks migrations on every deploy with a
`P1002` advisory-lock timeout once the lock gets stuck on the pooler side. The app itself
(`src/server/db/prisma.ts`, `PrismaPg`/`PrismaNeonHttp` adapters selected via `DATABASE_ADAPTER`)
uses the same single `DATABASE_URL` for runtime queries — fine at this project's scale (a handful
of small chats) to just use the direct connection for both.

### Testing

`node:test` files run against a real Postgres (`@/server/db/prisma`), not a mock — CI spins up a
throwaway `postgres:17-alpine` service and runs real migrations against it. There is **no**
`TELEGRAM_BOT_TOKEN` in CI, so tests are written to exercise only the DB-level branches and the
Telegram-call **failure/graceful-degradation** path (which is deterministic: `getTelegramClient()`
always throws without a token), never the "Telegram call actually succeeds" branch. Follow this
split when adding tests for anything that calls Telegram — see `appeal-service.test.ts` or
`captcha-service.test.ts` for the pattern (unknown-user / not-found / already-done branches tested
directly; the success branch left to manual QA against a real bot).

### Deployment

Vercel, single Next.js deployment. `vercel-build` runs `db:migrate && db:seed && next build &&
telegram:set-webhook` only when `VERCEL_ENV=production`; preview deployments build but never touch
the production database. GitHub Actions CI (`.github/workflows/ci.yml`) runs on every PR and on
push to `main`: install → audit → generate → migrate → seed → typecheck → lint → test → build,
against a clean database — it does **not** exercise the production `vercel-build` chain (in
particular `telegram:set-webhook`, which needs a real bot token), so a green CI does not guarantee
the production deploy itself will succeed.

## Roadmap context

`docs/STAGE_1.md`, `STAGE_2.md`, `STAGE_3.md` document what was built at each stage and its honest,
Telegram-API-driven limitations (e.g. a bot can't message a user who never started a chat with it;
`unbanChatMember` doesn't return the user to the group). Read the relevant stage doc before
extending a feature area — it usually explains a design constraint that isn't obvious from the code
alone.
