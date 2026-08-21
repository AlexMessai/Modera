"use client";

import { useMemo, useState } from "react";
import { Check, Copy, Search } from "lucide-react";
import type { CommandCategory } from "@/components/commands-reference-data";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can be unavailable (older browsers, insecure context) — the code block itself is still selectable/copyable by hand.
    }
  }

  return (
    <button type="button" className="cmd-copy-btn" onClick={() => void copy()} aria-label="Копировать">
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? "Скопировано" : "Копировать"}
    </button>
  );
}

function matchesQuery(category: CommandCategory, query: string) {
  if (!query) return category;
  const needle = query.trim().toLowerCase();
  const commands = category.commands.filter((cmd) =>
    cmd.command.toLowerCase().includes(needle) ||
    cmd.description.toLowerCase().includes(needle) ||
    cmd.tags.some((tag) => tag.toLowerCase().includes(needle))
  );
  return commands.length > 0 ? { ...category, commands } : null;
}

export function CommandsReference({ categories }: { categories: CommandCategory[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(
    () => categories.map((category) => matchesQuery(category, query)).filter((category): category is CommandCategory => category !== null),
    [categories, query]
  );

  return (
    <div className="cmd-layout">
      <nav className="cmd-sidebar" aria-label="Категории команд">
        <div className="cmd-search">
          <Search size={15} />
          <input
            type="search"
            placeholder="Поиск команд…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Поиск команд"
          />
        </div>
        <ul className="cmd-sidebar-list">
          {categories.map((category) => (
            <li key={category.id}><a href={`#${category.id}`}>{category.title}</a></li>
          ))}
        </ul>
      </nav>

      <main className="cmd-main">
        {filtered.length === 0 ? (
          <div className="state-box"><strong>Ничего не найдено</strong><p>Попробуйте другой запрос.</p></div>
        ) : (
          filtered.map((category) => (
            <section id={category.id} className="cmd-category" key={category.id}>
              <h2>{category.title}</h2>
              <p className="cmd-category-description">{category.description}</p>
              <div className="cmd-list">
                {category.commands.map((cmd) => (
                  <article className="cmd-card" key={cmd.key}>
                    <div className="cmd-card-head">
                      <code className="cmd-chip">{cmd.command}</code>
                      <div className="cmd-tags">
                        {cmd.tags.map((tag) => <span className="badge" key={tag}>{tag}</span>)}
                      </div>
                    </div>
                    <p className="cmd-description">{cmd.description}</p>
                    <div className="cmd-usage-list">
                      {cmd.usage.map((variant) => (
                        <div className="cmd-usage" key={variant.line}>
                          <div className="cmd-usage-line">
                            <span className="cmd-usage-label">{variant.label}</span>
                            <code>{variant.line}</code>
                          </div>
                          <CopyButton text={variant.line} />
                        </div>
                      ))}
                    </div>
                    {cmd.notes?.map((note) => <p className="cmd-note" key={note}>{note}</p>)}
                    <div className="cmd-permission"><span>Нужные права</span><strong>{cmd.permission}</strong></div>
                  </article>
                ))}
              </div>
            </section>
          ))
        )}
      </main>
    </div>
  );
}
