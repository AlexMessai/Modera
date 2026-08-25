export type UsageVariant = {
  /** Short caption distinguishing this variant from the others (e.g. "Reply" vs "Без Reply") — otherwise multiple usage lines read as separate commands rather than alternative ways to name the same one. */
  label: string;
  line: string;
};

export type CommandDoc = {
  key: string;
  command: string;
  /** Copy-paste usage variant(s) shown in the code block — always alternative ways to run the *same* command (different ways to specify the target), never different commands. */
  usage: UsageVariant[];
  description: string;
  /** Chat permission required to run it (see Роли в панели). */
  permission: string;
  tags: string[];
  notes?: string[];
};

export type CommandCategory = {
  id: string;
  title: string;
  description: string;
  commands: CommandDoc[];
};

// Content mirrors the actual command grammar in
// src/server/telegram/update-handler.ts + command-parser.ts — keep in sync
// when either changes (there's no shared source of truth between the two).
export const COMMAND_CATEGORIES: CommandCategory[] = [
  {
    id: "cat-warnings",
    title: "Предупреждения",
    description: "Накопленные предупреждения считаются вместе с автомодерацией и могут автоматически перейти в mute или бан — см. цепочку наказаний в разделе «Модерация».",
    commands: [
      {
        key: "warn",
        command: "/warn",
        usage: [
          { label: "Reply на сообщение", line: "/warn [причина]" },
          { label: "По @username или ID", line: "/warn (@username|ID) [причина]" }
        ],
        description: "Выдаёт участнику предупреждение. Причина — необязательна, весь текст после команды (или после цели).",
        permission: "Выдавать предупреждения",
        tags: ["Reply", "@username / ID", "Причина"],
        notes: [
          "Цель — либо Reply на сообщение участника, либо @username / Telegram ID сразу после команды.",
          "При достижении порога предупреждений автоматически выдаётся mute или бан по цепочке наказаний."
        ]
      },
      {
        key: "unwarn",
        command: "/unwarn",
        usage: [
          { label: "Reply на сообщение", line: "/unwarn" },
          { label: "По @username или ID", line: "/unwarn (@username|ID)" }
        ],
        description: "Снимает последнее активное предупреждение с участника.",
        permission: "Выдавать предупреждения",
        tags: ["Reply", "@username / ID"]
      }
    ]
  },
  {
    id: "cat-mute",
    title: "Mute",
    description: "Запрещает участнику писать в чат на указанный срок.",
    commands: [
      {
        key: "mute",
        command: "/mute",
        usage: [
          { label: "Reply на сообщение", line: "/mute [срок] [причина]" },
          { label: "По @username или ID", line: "/mute (@username|ID) [срок] [причина]" }
        ],
        description: "Ограничивает участника на указанный срок. Без срока — ограничение постоянное.",
        permission: "Ограничивать (mute)",
        tags: ["Reply", "@username / ID", "Срок опционален", "Причина"],
        notes: [
          "Срок нужно указывать явно с суффиксом — 10m, 2h, 3d. Голое число без суффикса команда не выполняет.",
          "Без срока mute выдаётся навсегда."
        ]
      },
      {
        key: "unmute",
        command: "/unmute",
        usage: [
          { label: "Reply на сообщение", line: "/unmute" },
          { label: "По @username или ID", line: "/unmute (@username|ID)" }
        ],
        description: "Досрочно снимает mute с участника.",
        permission: "Ограничивать (mute)",
        tags: ["Reply", "@username / ID"]
      }
    ]
  },
  {
    id: "cat-ban",
    title: "Блокировка",
    description: "Блокирует участника в чате — с указанием срока или навсегда.",
    commands: [
      {
        key: "ban",
        command: "/ban",
        usage: [
          { label: "Reply на сообщение", line: "/ban [срок] [причина]" },
          { label: "По @username или ID", line: "/ban (@username|ID) [срок] [причина]" }
        ],
        description: "Блокирует участника. Без срока — блокировка постоянная.",
        permission: "Блокировать (ban)",
        tags: ["Reply", "@username / ID", "Срок опционален", "Причина"],
        notes: [
          "Срок нужно указывать явно с суффиксом — 10m, 2h, 3d. Голое число без суффикса команда не выполняет."
        ]
      },
      {
        key: "unban",
        command: "/unban",
        usage: [
          { label: "Reply на сообщение", line: "/unban" },
          { label: "По @username или ID", line: "/unban (@username|ID)" }
        ],
        description: "Снимает блокировку — участник сможет вернуться в чат по новой ссылке-приглашению.",
        permission: "Блокировать (ban)",
        tags: ["Reply", "@username / ID"]
      }
    ]
  },
  {
    id: "cat-kick",
    title: "Кик",
    description: "Удаляет участника из чата без блокировки.",
    commands: [
      {
        key: "kick",
        command: "/kick",
        usage: [
          { label: "Reply на сообщение", line: "/kick [причина]" },
          { label: "По @username или ID", line: "/kick (@username|ID) [причина]" }
        ],
        description: "Исключает участника из чата — он может вернуться по ссылке-приглашению.",
        permission: "Исключать (kick)",
        tags: ["Reply", "@username / ID", "Причина"],
        notes: ["Личное уведомление недоступно: участник уже покидает чат в момент действия."]
      }
    ]
  },
  {
    id: "cat-info",
    title: "Информация",
    description: "Просмотр — не считается наказанием и не публикуется в чат.",
    commands: [
      {
        key: "warns",
        command: "/warns",
        usage: [
          { label: "Reply на сообщение", line: "/warns" },
          { label: "По @username или ID", line: "/warns (@username|ID)" }
        ],
        description: "Показывает число активных и всего выданных предупреждений участнику. Ответ виден только тому, кто запросил.",
        permission: "Просматривать историю",
        tags: ["Reply", "@username / ID", "Только для запросившего"]
      }
    ]
  }
];
