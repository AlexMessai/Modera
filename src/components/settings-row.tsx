"use client";

import type { ReactNode } from "react";

type SettingsRowProps = {
  title: string;
  description?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
};

/**
 * One settings row: label + description on the left, a switch flush right.
 * Every switch in a section lines up on the same right edge because the row
 * is always full width with `justify-content: space-between` — see
 * .settings-row in automod.css. Pair with ConditionalSettingsSection for the
 * dependent block a switch reveals.
 */
export function SettingsRow({ title, description, checked, disabled, onChange }: SettingsRowProps) {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <strong>{title}</strong>
        {description ? <small>{description}</small> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        disabled={disabled}
        className={`switch ${checked ? "switch--on" : ""}`}
        onClick={() => onChange(!checked)}
      >
        <span className="switch-thumb" />
      </button>
    </div>
  );
}

/** Renders its children, indented, only while `visible` — the dependent block under a SettingsRow's switch. */
export function ConditionalSettingsSection({ visible, children }: { visible: boolean; children: ReactNode }) {
  if (!visible) return null;
  return <div className="conditional-settings-section">{children}</div>;
}
