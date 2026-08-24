"use client";

import { Braces, Code2, EyeOff, Link2, MessageSquareQuote, Smile, SquareCode } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";

type Props = {
  value: string;
  onChange: (value: string) => void;
  variables?: string[];
  disabled?: boolean;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
  className?: string;
  id?: string;
  autoFocus?: boolean;
  "aria-label"?: string;
};

const ALLOWED_TAGS: Record<string, string> = {
  B: "b", STRONG: "b", I: "i", EM: "i", U: "u", INS: "u", S: "s", STRIKE: "s", DEL: "s",
  BLOCKQUOTE: "blockquote", CODE: "code", PRE: "pre", "TG-SPOILER": "tg-spoiler", A: "a", BR: "br"
};

function sanitizeEditorHtml(source: string) {
  const parsed = new DOMParser().parseFromString(`<body>${source}</body>`, "text/html");
  const output = document.createElement("div");

  function appendChildren(parent: Node, target: Node) {
    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        target.appendChild(document.createTextNode(child.textContent ?? ""));
        continue;
      }
      if (!(child instanceof HTMLElement)) continue;
      const tag = ALLOWED_TAGS[child.tagName];
      if (tag === "br") {
        target.appendChild(document.createElement("br"));
        continue;
      }
      if (tag) {
        const clean = document.createElement(tag);
        if (tag === "a") {
          const href = child.getAttribute("href") ?? "";
          if (!/^(?:https?:\/\/|tg:\/\/)/i.test(href)) {
            appendChildren(child, target);
            continue;
          }
          clean.setAttribute("href", href);
        }
        appendChildren(child, clean);
        target.appendChild(clean);
        continue;
      }
      if (child.tagName === "DIV" || child.tagName === "P") {
        if (target.childNodes.length && target.lastChild?.nodeName !== "BR") target.appendChild(document.createElement("br"));
        appendChildren(child, target);
      } else {
        appendChildren(child, target);
      }
    }
  }

  appendChildren(parsed.body, output);
  return output.textContent ? output.innerHTML : "";
}

function closestElement(node: Node | null, selector: string) {
  const element = node instanceof Element ? node : node?.parentElement;
  return element?.closest(selector) ?? null;
}

const INLINE_FORMATS = [
  { key: "bold", command: "bold", selector: "b, strong" },
  { key: "italic", command: "italic", selector: "i, em" },
  { key: "underline", command: "underline", selector: "u, ins" },
  { key: "strike", command: "strikeThrough", selector: "s, strike, del" }
] as const;

export function FormattedTextarea({
  value,
  onChange,
  variables = [],
  disabled = false,
  rows = 5,
  maxLength,
  placeholder,
  className,
  id,
  autoFocus,
  "aria-label": ariaLabel
}: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastEmittedRef = useRef(value);
  const [active, setActive] = useState<Set<string>>(() => new Set());

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor || value === lastEmittedRef.current) return;
    const safeValue = sanitizeEditorHtml(value);
    if (editor.innerHTML !== safeValue) editor.innerHTML = safeValue;
    lastEmittedRef.current = value;
  }, [value]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.innerHTML = sanitizeEditorHtml(value);
    lastEmittedRef.current = value;
    if (autoFocus) editor.focus();
    document.execCommand("defaultParagraphSeparator", false, "br");
    document.execCommand("styleWithCSS", false, "false");
  // The initial value is loaded once; subsequent external updates are handled above.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateActiveFormats = useCallback(() => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.anchorNode || !editor.contains(selection.anchorNode)) {
      setActive(new Set());
      return;
    }
    const next = new Set<string>();
    for (const format of INLINE_FORMATS) {
      if (closestElement(selection.anchorNode, format.selector)) next.add(format.key);
    }
    if (closestElement(selection.anchorNode, "blockquote")) next.add("quote");
    if (closestElement(selection.anchorNode, "code")) next.add("code");
    if (closestElement(selection.anchorNode, "pre")) next.add("pre");
    if (closestElement(selection.anchorNode, "tg-spoiler")) next.add("spoiler");
    if (closestElement(selection.anchorNode, "a")) next.add("link");
    setActive(next);
  }, []);

  useEffect(() => {
    document.addEventListener("selectionchange", updateActiveFormats);
    return () => document.removeEventListener("selectionchange", updateActiveFormats);
  }, [updateActiveFormats]);

  function emitChange() {
    const editor = editorRef.current;
    if (!editor) return;
    const next = sanitizeEditorHtml(editor.innerHTML);
    if (maxLength != null && editor.innerText.length > maxLength) {
      editor.innerHTML = sanitizeEditorHtml(lastEmittedRef.current);
      return;
    }
    if (!next && editor.innerHTML) {
      editor.innerHTML = "";
      const range = document.createRange();
      const selection = window.getSelection();
      range.selectNodeContents(editor);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
      resetPendingFormatting();
    }
    lastEmittedRef.current = next;
    onChange(next);
    updateActiveFormats();
  }

  function runCommand(command: string, commandValue?: string) {
    if (disabled) return;
    editorRef.current?.focus();
    document.execCommand(command, false, commandValue);
    emitChange();
  }

  function resetPendingFormatting() {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.anchorNode || !editor.contains(selection.anchorNode)) return;
    for (const format of INLINE_FORMATS) {
      if (!closestElement(selection.anchorNode, format.selector) && document.queryCommandState(format.command)) {
        document.execCommand(format.command, false);
      }
    }
    setActive(new Set());
  }

  function toggleElement(tag: "code" | "pre" | "tg-spoiler") {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    const existing = closestElement(selection.anchorNode, tag);
    if (existing && editor.contains(existing)) {
      existing.replaceWith(...Array.from(existing.childNodes));
    } else {
      const wrapper = document.createElement(tag);
      if (range.collapsed) wrapper.textContent = tag === "pre" ? "код" : "текст";
      else wrapper.appendChild(range.extractContents());
      range.insertNode(wrapper);
      selection.selectAllChildren(wrapper);
    }
    emitChange();
  }

  function toggleLink() {
    const selection = window.getSelection();
    const existing = closestElement(selection?.anchorNode ?? null, "a");
    if (existing) {
      existing.replaceWith(...Array.from(existing.childNodes));
      emitChange();
      return;
    }
    const href = window.prompt("Введите ссылку", "https://");
    if (href && /^(?:https?:\/\/|tg:\/\/)/i.test(href)) runCommand("createLink", href);
  }

  function insertText(text: string) {
    runCommand("insertText", text);
  }

  function preserveSelection(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!(event.ctrlKey || event.metaKey)) return;
    const commands: Record<string, string> = { b: "bold", i: "italic", u: "underline" };
    const command = commands[event.key.toLowerCase()];
    if (!command) return;
    event.preventDefault();
    runCommand(command);
  }

  const button = (key: string, label: string, content: ReactNode, action: () => void) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active.has(key)}
      className={active.has(key) ? "is-active" : undefined}
      disabled={disabled}
      onMouseDown={preserveSelection}
      onClick={action}
    >{content}</button>
  );

  return <div className={`formatted-textarea${disabled ? " is-disabled" : ""}${className ? ` ${className}` : ""}`}>
    <div className="formatted-textarea-toolbar" role="toolbar" aria-label="Форматирование текста">
      {button("bold", "Жирный", <strong>B</strong>, () => runCommand("bold"))}
      {button("italic", "Курсив", <em>I</em>, () => runCommand("italic"))}
      {button("underline", "Подчёркнутый", <u>U</u>, () => runCommand("underline"))}
      {button("strike", "Зачёркнутый", <s>S</s>, () => runCommand("strikeThrough"))}
      {button("quote", "Цитата", <MessageSquareQuote size={14} />, () => runCommand("formatBlock", active.has("quote") ? "div" : "blockquote"))}
      {button("link", active.has("link") ? "Убрать ссылку" : "Добавить ссылку", <Link2 size={14} />, toggleLink)}
      {button("code", "Код", <Code2 size={14} />, () => toggleElement("code"))}
      {button("pre", "Блок кода", <SquareCode size={14} />, () => toggleElement("pre"))}
      {button("spoiler", "Спойлер", <EyeOff size={14} />, () => toggleElement("tg-spoiler"))}
      {button("emoji", "Вставить эмодзи", <Smile size={14} />, () => insertText("🙂"))}
      {variables.length ? button("variable", `Вставить ${variables[0]}`, <Braces size={14} />, () => insertText(variables[0]!)) : null}
    </div>
    <div
      ref={editorRef}
      id={id}
      role="textbox"
      aria-label={ariaLabel}
      aria-multiline="true"
      aria-disabled={disabled}
      contentEditable={!disabled}
      suppressContentEditableWarning
      className="formatted-textarea-editor"
      data-placeholder={placeholder ?? ""}
      style={{ minHeight: `${Math.max(rows, 2) * 22 + 22}px` }}
      onFocus={() => {
        document.execCommand("styleWithCSS", false, "false");
        resetPendingFormatting();
        updateActiveFormats();
      }}
      onInput={emitChange}
      onBlur={() => {
        const editor = editorRef.current;
        if (editor) editor.innerHTML = sanitizeEditorHtml(editor.innerHTML);
        updateActiveFormats();
      }}
      onKeyDown={handleKeyDown}
    />
  </div>;
}
