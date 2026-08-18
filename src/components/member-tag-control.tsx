"use client";

import { FormEvent, useEffect, useState } from "react";
import { Tag, Trash2 } from "lucide-react";

type TagState = {
  status: string;
  telegramCustomTitle: string | null;
  tag: string | null;
  tagUpdatedAt: string | null;
  editable: boolean;
};

async function loadTag(membershipId: string) {
  const response = await fetch(`/api/members/${membershipId}/tag`, {
    cache: "no-store"
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? "Не удалось обновить Telegram-тег.");
  }
  return payload.data as TagState;
}

export function MemberTagControl({
  membershipId,
  initialTag,
  initialStatus,
  telegramCustomTitle
}: {
  membershipId: string;
  initialTag: string | null;
  initialStatus: string;
  telegramCustomTitle: string | null;
}) {
  const [state, setState] = useState<TagState>({
    status: initialStatus,
    telegramCustomTitle,
    tag: initialTag,
    tagUpdatedAt: null,
    editable: initialStatus === "MEMBER" || initialStatus === "RESTRICTED"
  });
  const [draft, setDraft] = useState(initialTag ?? "");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const update = () => {
      void loadTag(membershipId)
        .then((next) => {
          if (!active) return;
          setState(next);
          if (!dirty && !saving) setDraft(next.tag ?? "");
        })
        .catch(() => undefined);
    };

    const interval = window.setInterval(update, 5000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [dirty, membershipId, saving]);

  async function save(tag: string | null) {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/members/${membershipId}/tag`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tag })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Не удалось изменить Telegram-тег.");
      }
      const savedTag = (payload.data?.tag as string | null) ?? null;
      setState((current) => ({ ...current, tag: savedTag }));
      setDraft(savedTag ?? "");
      setDirty(false);
      setNotice(savedTag ? "Тег изменён в Telegram." : "Тег удалён в Telegram.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось изменить Telegram-тег."
      );
    } finally {
      setSaving(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void save(draft.trim() || null);
  }

  const length = Array.from(draft).length;

  return (
    <div className="member-tag-control">
      <div className="member-tag-heading">
        <span className="member-tag-icon"><Tag size={16} /></span>
        <div>
          <strong>Telegram-тег участника</strong>
          <span>{state.tag ?? "Тег не установлен"}</span>
        </div>
      </div>

      {state.editable ? (
        <form className="member-tag-form" onSubmit={submit}>
          <label>
            <span>До 16 символов, без эмодзи</span>
            <input
              className="text-control"
              value={draft}
              maxLength={32}
              onChange={(event) => {
                setDraft(event.target.value);
                setDirty(true);
                setNotice(null);
              }}
              placeholder="Например: 5 этаж"
              disabled={saving}
            />
            <small className={length > 16 ? "text-danger" : undefined}>{length}/16</small>
          </label>
          <div className="member-tag-actions">
            <button
              className="button button--primary button--compact"
              type="submit"
              disabled={saving || length > 16 || (!dirty && draft === (state.tag ?? ""))}
            >
              {saving ? "Сохраняю…" : "Сохранить в Telegram"}
            </button>
            {state.tag ? (
              <button
                className="button button--secondary button--compact"
                type="button"
                disabled={saving}
                onClick={() => void save(null)}
              >
                <Trash2 size={14} /> Удалить
              </button>
            ) : null}
          </div>
        </form>
      ) : (
        <p className="member-tag-limitation">
          {state.telegramCustomTitle
            ? `Telegram title администратора: ${state.telegramCustomTitle}`
            : "Для владельцев и администраторов Telegram использует отдельный custom title."}
        </p>
      )}

      {notice ? <div className="moderation-feedback moderation-feedback--success" role="status">{notice}</div> : null}
      {error ? <div className="moderation-feedback moderation-feedback--error" role="alert">{error}</div> : null}
    </div>
  );
}
