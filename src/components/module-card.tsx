"use client";

import type { ReactNode } from "react";
import { Settings2 } from "lucide-react";

type ToggleProps = {
  enabled: boolean;
  busy?: boolean;
  onToggle: () => void;
};

type Props = {
  icon: ReactNode;
  title: string;
  description: string;
  tag: string;
  status: string;
  onConfigure: () => void;
  toggle?: ToggleProps;
};

export function ModuleCard({ icon, title, description, tag, status, onConfigure, toggle }: Props) {
  return (
    <article className="module-card">
      <div className="module-card-header">
        <span className="module-card-icon">{icon}</span>
        <strong>{title}</strong>
      </div>
      <p>{description}</p>
      <div className="module-card-tags">
        <span className="badge">#{tag}</span>
        <span className={`badge ${toggle ? (toggle.enabled ? "badge--active" : "") : ""}`}>{status}</span>
      </div>
      <div className="module-card-actions">
        <button className="button button--compact button--secondary" type="button" onClick={onConfigure}>
          <Settings2 size={14} /> Настроить
        </button>
        {toggle ? (
          <button
            className="button button--compact"
            type="button"
            disabled={toggle.busy}
            onClick={toggle.onToggle}
          >
            {toggle.busy ? "…" : toggle.enabled ? "Удалить" : "Включить"}
          </button>
        ) : null}
      </div>
    </article>
  );
}
