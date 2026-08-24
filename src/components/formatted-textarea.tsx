"use client";

import { Braces, Code2, EyeOff, Link2, MessageSquareQuote, Smile, SquareCode } from "lucide-react";
import { useRef, type TextareaHTMLAttributes } from "react";

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  variables?: string[];
};

export function FormattedTextarea({ value, onChange, variables = [], disabled, ...props }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function insert(open: string, close = "", placeholder = "текст") {
    const element = ref.current;
    if (!element) return;
    const start = element.selectionStart;
    const end = element.selectionEnd;
    const selected = value.slice(start, end) || placeholder;
    const next = `${value.slice(0, start)}${open}${selected}${close}${value.slice(end)}`;
    onChange(next);
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(start + open.length, start + open.length + selected.length);
    });
  }

  return <div className="formatted-textarea">
    <div className="formatted-textarea-toolbar" role="toolbar" aria-label="Форматирование текста">
      <button type="button" title="Жирный" aria-label="Жирный" disabled={disabled} onClick={() => insert("<b>", "</b>")}><strong>B</strong></button>
      <button type="button" title="Курсив" aria-label="Курсив" disabled={disabled} onClick={() => insert("<i>", "</i>")}><em>I</em></button>
      <button type="button" title="Подчёркнутый" aria-label="Подчёркнутый" disabled={disabled} onClick={() => insert("<u>", "</u>")}><u>U</u></button>
      <button type="button" title="Зачёркнутый" aria-label="Зачёркнутый" disabled={disabled} onClick={() => insert("<s>", "</s>")}><s>S</s></button>
      <button type="button" title="Цитата" aria-label="Цитата" disabled={disabled} onClick={() => insert("<blockquote>", "</blockquote>")}><MessageSquareQuote size={14} /></button>
      <button type="button" title="Ссылка" aria-label="Ссылка" disabled={disabled} onClick={() => insert('<a href="https://example.com">', "</a>", "название ссылки")}><Link2 size={14} /></button>
      <button type="button" title="Код" aria-label="Код" disabled={disabled} onClick={() => insert("<code>", "</code>")}><Code2 size={14} /></button>
      <button type="button" title="Блок кода" aria-label="Блок кода" disabled={disabled} onClick={() => insert("<pre>", "</pre>")}><SquareCode size={14} /></button>
      <button type="button" title="Спойлер" aria-label="Спойлер" disabled={disabled} onClick={() => insert("<tg-spoiler>", "</tg-spoiler>")}><EyeOff size={14} /></button>
      <button type="button" title="Эмодзи" aria-label="Эмодзи" disabled={disabled} onClick={() => insert("", "", "🙂")}><Smile size={14} /></button>
      {variables.length ? <button type="button" title={`Вставить ${variables[0]}`} aria-label="Вставить переменную" disabled={disabled} onClick={() => insert("", "", variables[0]!)}><Braces size={14} /></button> : null}
    </div>
    <textarea ref={ref} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} {...props} />
  </div>;
}
