"use client";

import { Children, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Server-rendered rows come in as `children` (already-rendered elements, not
 * data) — this only slices what's shown, no re-fetching. Keeps long profile
 * lists (moderation history, audit log, chat memberships) from stretching
 * the page to thousands of pixels for rows that are mostly whitespace.
 */
export function CollapsibleList({
  children,
  initialVisible = 6
}: {
  children: ReactNode;
  initialVisible?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const items = Children.toArray(children);
  const hiddenCount = items.length - initialVisible;

  if (hiddenCount <= 0) return <>{items}</>;

  return (
    <>
      {expanded ? items : items.slice(0, initialVisible)}
      <button
        type="button"
        className="collapsible-list-toggle"
        onClick={() => setExpanded((current) => !current)}
      >
        <ChevronDown size={15} className={expanded ? "collapsible-list-toggle-icon--open" : undefined} />
        {expanded ? "Свернуть" : `Показать всё (${items.length})`}
      </button>
    </>
  );
}
