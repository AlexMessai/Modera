"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, ClipboardCopy, X } from "lucide-react";

type CopyableSection =
  | "automod"
  | "newusers"
  | "antiraid"
  | "manual"
  | "appeals"
  | "roles"
  | "reports";

const SECTION_OPTIONS: Array<{ value: CopyableSection; label: string }> = [
  { value: "automod", label: "Automod и Фильтры" },
  { value: "newusers", label: "Новые пользователи (капча и приветствие)" },
  { value: "antiraid", label: "Anti-Raid" },
  { value: "manual", label: "Ручная модерация" },
  { value: "appeals", label: "Апелляции" },
  { value: "reports", label: "Жалобы" },
  { value: "roles", label: "Роли" }
];

type ChatOption = { id: string; title: string };

type Props = {
  chatId: string;
};

export function ChatSettingsCopy({ chatId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loadingChats, setLoadingChats] = useState(false);
  const [chats, setChats] = useState<ChatOption[]>([]);
  const [sourceChatId, setSourceChatId] = useState("");
  const [sections, setSections] = useState<Set<CopyableSection>>(new Set());
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function toggleOpen() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setError(null);
    setSuccess(null);
    if (chats.length > 0) return;
    setLoadingChats(true);
    try {
      const response = await fetch("/api/chats?page=1&pageSize=100", { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      const items = (payload?.data?.items ?? []) as Array<{ id: string; title: string }>;
      setChats(items.filter((chat) => chat.id !== chatId));
    } finally {
      setLoadingChats(false);
    }
  }

  function toggleSection(section: CopyableSection) {
    setSections((current) => {
      const next = new Set(current);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }

  async function apply() {
    if (!sourceChatId || sections.size === 0) return;
    setApplying(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/chats/${chatId}/settings/copy`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceChatId, sections: Array.from(sections) })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось скопировать настройки.");
      setSuccess("Настройки скопированы.");
      setSections(new Set());
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось скопировать настройки.");
    } finally {
      setApplying(false);
    }
  }

  if (!open) {
    return (
      <button className="button button--secondary button--compact" type="button" onClick={() => void toggleOpen()}>
        <ClipboardCopy size={14} />Скопировать из другого чата
      </button>
    );
  }

  return (
    <div className="panel automod-settings chat-settings-copy">
      <div className="panel-header">
        <div>
          <h2>Скопировать настройки из другого чата</h2>
          <p>Разовое применение — после копирования чаты снова независимы. «Команда» и «Канал логов» не копируются: это привязка к конкретным людям и конкретному каналу.</p>
        </div>
        <button className="button button--secondary button--compact" type="button" onClick={() => void toggleOpen()}>
          <X size={14} />Закрыть
        </button>
      </div>

      <div className="settings-section">
        <label className="automod-field">
          <span>Чат-источник</span>
          <select
            className="select-control"
            value={sourceChatId}
            disabled={loadingChats}
            onChange={(event) => setSourceChatId(event.target.value)}
          >
            <option value="">{loadingChats ? "Загрузка…" : "Выберите чат"}</option>
            {chats.map((chat) => (
              <option value={chat.id} key={chat.id}>{chat.title}</option>
            ))}
          </select>
        </label>

        <div className="chat-settings-copy-sections">
          {SECTION_OPTIONS.map((option) => (
            <label className="chat-settings-copy-checkbox" key={option.value}>
              <input
                type="checkbox"
                checked={sections.has(option.value)}
                onChange={() => toggleSection(option.value)}
              />
              {option.label}
            </label>
          ))}
        </div>
      </div>

      {error ? <div className="moderation-feedback moderation-feedback--error">{error}</div> : null}
      {success ? <div className="moderation-feedback moderation-feedback--success">{success}</div> : null}

      <div className="automod-actions">
        <button
          className="button button--primary"
          type="button"
          onClick={() => void apply()}
          disabled={applying || !sourceChatId || sections.size === 0}
        >
          <Check size={16} />{applying ? "Копирую…" : "Скопировать"}
        </button>
      </div>
    </div>
  );
}
