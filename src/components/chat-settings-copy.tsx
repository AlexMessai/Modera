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
  | "reports";

const SECTION_OPTIONS: Array<{ value: CopyableSection; label: string }> = [
  { value: "automod", label: "Automod и Фильтры" },
  { value: "newusers", label: "Новые пользователи (капча и приветствие)" },
  { value: "antiraid", label: "Anti-Raid" },
  { value: "manual", label: "Ручная модерация" },
  { value: "appeals", label: "Апелляции" },
  { value: "reports", label: "Жалобы" }
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

  async function openModal() {
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

  function closeModal() {
    if (applying) return;
    setOpen(false);
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

  return (
    <>
      <button className="button button--secondary button--compact" type="button" onClick={() => void openModal()}>
        <ClipboardCopy size={14} />Скопировать из другого чата
      </button>

      {open ? (
        <div
          className="automod-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget) closeModal(); }}
        >
          <div className="automod-modal" role="dialog" aria-modal="true" aria-labelledby="chat-settings-copy-title">
            <div className="automod-modal-header">
              <div className="automod-modal-heading">
                <span><ClipboardCopy size={19} /></span>
                <div>
                  <h3 id="chat-settings-copy-title">Скопировать настройки из другого чата</h3>
                  <p>Разовое применение — после копирования чаты снова независимы.</p>
                </div>
              </div>
              <button type="button" className="icon-button" aria-label="Закрыть" onClick={closeModal}><X size={18} /></button>
            </div>

            <div className="automod-modal-body">
              <p className="automod-modal-note">«Команда» и «Канал логов» не копируются: это привязка к конкретным людям и конкретному каналу.</p>

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

              {error ? <div className="moderation-feedback moderation-feedback--error">{error}</div> : null}
              {success ? <div className="moderation-feedback moderation-feedback--success">{success}</div> : null}
            </div>

            <div className="automod-modal-footer">
              <button type="button" className="button" onClick={closeModal} disabled={applying}>Отмена</button>
              <button
                type="button"
                className="button button--primary"
                onClick={() => void apply()}
                disabled={applying || !sourceChatId || sections.size === 0}
              >
                <Check size={16} />{applying ? "Копирую…" : "Скопировать"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
