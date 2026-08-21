export type CommandDoc = {
  key: string;
  command: string;
  /** Copy-paste usage line(s) shown in the code block. */
  usage: string[];
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
        usage: ["/warn [причина]", "/warn (@username|ID) [причина]"],
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
        usage: ["/unwarn", "/unwarn (@username|ID)"],
        description: "Снимает одно предупреждение с участника (самое старое активное).",
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
        usage: ["/mute <срок> [причина]", "/mute (@username|ID) <срок> [причина]"],
        description: "Ограничивает участника на указанный срок. Срок обязателен.",
        permission: "Ограничивать (mute)",
        tags: ["Reply", "@username / ID", "Срок обязателен", "Причина"],
        notes: [
          "Срок: число = минуты, либо число с суффиксом m/h/d — например 30, 3h, 7d.",
          "Без срока команда отклоняется с подсказкой указать длительность."
        ]
      },
      {
        key: "unmute",
        command: "/unmute",
        usage: ["/unmute", "/unmute (@username|ID)"],
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
        usage: ["/ban [срок] [причина]", "/ban (@username|ID) [срок] [причина]"],
        description: "Блокирует участника. Без срока — блокировка постоянная.",
        permission: "Блокировать (ban)",
        tags: ["Reply", "@username / ID", "Срок опционален", "Причина"],
        notes: [
          "Срок нужно указывать явно с суффиксом — 30m, 3h, 7d (в отличие от /mute, голое число здесь читается как часть причины, а не как минуты)."
        ]
      },
      {
        key: "unban",
        command: "/unban",
        usage: ["/unban", "/unban (@username|ID)"],
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
        usage: ["/kick [причина]", "/kick (@username|ID) [причина]"],
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
        usage: ["/warns", "/warns (@username|ID)"],
        description: "Показывает число активных и всего выданных предупреждений участнику. Ответ виден только тому, кто запросил.",
        permission: "Просматривать историю",
        tags: ["Reply", "@username / ID", "Только для запросившего"]
      }
    ]
  }
];
