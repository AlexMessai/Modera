"use client";

import { Mark, mergeAttributes } from "@tiptap/core";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Braces, Code2, EyeOff, Link2, MessageSquareQuote, Smile, SquareCode } from "lucide-react";
import { useEffect, useMemo, useRef, type MouseEvent, type ReactNode } from "react";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    telegramSpoiler: { toggleTelegramSpoiler: () => ReturnType };
  }
}

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

const TelegramSpoiler = Mark.create({
  name: "telegramSpoiler",
  parseHTML: () => [{ tag: "tg-spoiler" }],
  renderHTML: ({ HTMLAttributes }) => ["tg-spoiler", mergeAttributes(HTMLAttributes), 0],
  addCommands() {
    return { toggleTelegramSpoiler: () => ({ commands }) => commands.toggleMark(this.name) };
  }
});

const EMPTY_TOOLBAR_STATE = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  quote: false,
  link: false,
  code: false,
  pre: false,
  spoiler: false
};

function sanitizeTelegramHtml(source: string) {
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
        if (tag === "pre") clean.textContent = child.textContent ?? "";
        else appendChildren(child, clean);
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

function toEditorHtml(source: string) {
  const clean = sanitizeTelegramHtml(source);
  if (!clean) return "";
  const parsed = new DOMParser().parseFromString(`<body>${clean}</body>`, "text/html");
  const walker = document.createTreeWalker(parsed.body, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!node.parentElement?.closest("pre") && /\r?\n/.test(node.data)) textNodes.push(node);
  }
  for (const node of textNodes) {
    const fragment = document.createDocumentFragment();
    node.data.split(/\r?\n/).forEach((part, index) => {
      if (index) fragment.appendChild(document.createElement("br"));
      fragment.appendChild(document.createTextNode(part));
    });
    node.replaceWith(fragment);
  }
  return parsed.body.innerHTML;
}

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
  const onChangeRef = useRef(onChange);
  const lastEmittedRef = useRef(value);
  onChangeRef.current = onChange;

  const extensions = useMemo(() => [
    StarterKit.configure({
      heading: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      horizontalRule: false,
      link: { openOnClick: false, autolink: false, linkOnPaste: true }
    }),
    Placeholder.configure({ placeholder: placeholder ?? "" }),
    TelegramSpoiler
  ], [placeholder]);

  const editor = useEditor({
    extensions,
    content: "",
    editable: !disabled,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        id: id ?? "",
        role: "textbox",
        "aria-label": ariaLabel ?? "Редактор сообщения",
        "aria-multiline": "true"
      }
    },
    onUpdate: ({ editor: currentEditor }) => {
      if (maxLength != null && currentEditor.getText({ blockSeparator: "\n" }).length > maxLength) {
        currentEditor.commands.undo();
        return;
      }
      const next = sanitizeTelegramHtml(currentEditor.getHTML());
      lastEmittedRef.current = next;
      onChangeRef.current(next);
    }
  });

  const selectedToolbarState = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => ({
      bold: currentEditor?.isActive("bold") ?? false,
      italic: currentEditor?.isActive("italic") ?? false,
      underline: currentEditor?.isActive("underline") ?? false,
      strike: currentEditor?.isActive("strike") ?? false,
      quote: currentEditor?.isActive("blockquote") ?? false,
      link: currentEditor?.isActive("link") ?? false,
      code: currentEditor?.isActive("code") ?? false,
      pre: currentEditor?.isActive("codeBlock") ?? false,
      spoiler: currentEditor?.isActive("telegramSpoiler") ?? false
    })
  });
  const toolbarState = selectedToolbarState ?? EMPTY_TOOLBAR_STATE;

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [disabled, editor]);

  useEffect(() => {
    if (!editor || value === lastEmittedRef.current) return;
    const next = toEditorHtml(value);
    const current = sanitizeTelegramHtml(editor.getHTML());
    if (sanitizeTelegramHtml(next) !== current) editor.commands.setContent(next, { emitUpdate: false });
    lastEmittedRef.current = value;
  }, [editor, value]);

  useEffect(() => {
    if (!editor) return;
    const next = toEditorHtml(value);
    editor.commands.setContent(next, { emitUpdate: false });
    lastEmittedRef.current = value;
    if (autoFocus) editor.commands.focus("end");
  // Initial content belongs to the editor lifecycle; later updates are synchronized above.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  function preserveSelection(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
  }

  function toggleLink() {
    if (!editor) return;
    if (editor.isActive("link")) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    const href = window.prompt("Введите ссылку", "https://");
    if (href && /^(?:https?:\/\/|tg:\/\/)/i.test(href)) editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
  }

  const button = (key: keyof typeof toolbarState, label: string, content: ReactNode, action: () => void) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={toolbarState[key]}
      className={toolbarState[key] ? "is-active" : undefined}
      disabled={disabled || !editor}
      onMouseDown={preserveSelection}
      onClick={action}
    >{content}</button>
  );

  return <div className={`formatted-textarea${disabled ? " is-disabled" : ""}${className ? ` ${className}` : ""}`}>
    <div className="formatted-textarea-toolbar" role="toolbar" aria-label="Форматирование текста">
      {button("bold", "Жирный", <strong>B</strong>, () => editor?.chain().focus().toggleBold().run())}
      {button("italic", "Курсив", <em>I</em>, () => editor?.chain().focus().toggleItalic().run())}
      {button("underline", "Подчёркнутый", <u>U</u>, () => editor?.chain().focus().toggleUnderline().run())}
      {button("strike", "Зачёркнутый", <s>S</s>, () => editor?.chain().focus().toggleStrike().run())}
      {button("quote", "Цитата", <MessageSquareQuote size={14} />, () => editor?.chain().focus().toggleBlockquote().run())}
      {button("link", toolbarState.link ? "Убрать ссылку" : "Добавить ссылку", <Link2 size={14} />, toggleLink)}
      {button("code", "Код", <Code2 size={14} />, () => editor?.chain().focus().toggleCode().run())}
      {button("pre", "Блок кода", <SquareCode size={14} />, () => editor?.chain().focus().toggleCodeBlock().run())}
      {button("spoiler", "Спойлер", <EyeOff size={14} />, () => editor?.chain().focus().toggleTelegramSpoiler().run())}
      <button type="button" title="Вставить эмодзи" aria-label="Вставить эмодзи" disabled={disabled || !editor} onMouseDown={preserveSelection} onClick={() => editor?.chain().focus().insertContent("🙂").run()}><Smile size={14} /></button>
      {variables.length ? <button type="button" title={`Вставить ${variables[0]}`} aria-label="Вставить переменную" disabled={disabled || !editor} onMouseDown={preserveSelection} onClick={() => editor?.chain().focus().insertContent(variables[0]!).run()}><Braces size={14} /></button> : null}
    </div>
    <EditorContent editor={editor} className="formatted-textarea-editor" style={{ minHeight: `${Math.max(rows, 2) * 22 + 22}px` }} />
  </div>;
}
