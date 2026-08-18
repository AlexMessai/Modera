# Этап 1 — Foundation + Telegram chat flow

## Реализованный контур

```text
Telegram group/supergroup
  → protected Telegram webhook
  → update handler
  → Telegram Bot API status/permissions check
  → chat service
  → PostgreSQL
  → protected /api/chats
  → Russian admin panel
```

## Проверяемый сценарий

1. Создать `.env` из `.env.example`.
2. Запустить PostgreSQL.
3. Применить миграции и seed владельца.
4. Запустить приложение.
5. Настроить публичный HTTPS URL и зарегистрировать webhook.
6. Добавить бота в тестовую группу или супергруппу.
7. Выдать необходимые права администратора.
8. Получить Telegram update.
9. Проверить появление реального чата в разделе «Чаты».
10. Проверить статус и доступные права бота.

## Честные ограничения этапа

На этом этапе ещё не реализованы persistence сообщений, накопление участников, moderation engine, полноценный RBAC permission matrix, background jobs и постоянный realtime-канал. Эти элементы не имитируются fake-данными или нерабочими кнопками.
