import type { TelegramMessageEntity } from "@/server/telegram/types";

export function escapeTelegramHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function decode(value: string) {
  return value.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&amp;", "&");
}

const ENTITY_TYPES: Record<string, string> = {
  b: "bold", strong: "bold", i: "italic", em: "italic", u: "underline", ins: "underline",
  s: "strikethrough", strike: "strikethrough", del: "strikethrough", code: "code", pre: "pre",
  blockquote: "blockquote", "tg-spoiler": "spoiler"
};

export function parseTelegramHtml(source: string): { text: string; entities: TelegramMessageEntity[] } {
  const entities: TelegramMessageEntity[] = [];
  const stack: Array<{ tag: string; type: string; offset: number; url?: string }> = [];
  const tagPattern = /<\/?(?:b|strong|i|em|u|ins|s|strike|del|code|pre|blockquote|tg-spoiler|a|br)\b[^>]*>/gi;
  let text = "";
  let cursor = 0;

  for (const match of source.matchAll(tagPattern)) {
    const index = match.index ?? 0;
    text += decode(source.slice(cursor, index));
    const raw = match[0];
    const closing = raw.startsWith("</");
    const tag = raw.match(/^<\/?([\w-]+)/i)?.[1]?.toLowerCase() ?? "";
    if (tag === "br" && !closing) {
      text += "\n";
    } else if (closing) {
      const position = stack.map((item) => item.tag).lastIndexOf(tag);
      if (position >= 0) {
        const [opened] = stack.splice(position, 1);
        if (opened && text.length > opened.offset) entities.push({ type: opened.type, offset: opened.offset, length: text.length - opened.offset, ...(opened.url ? { url: opened.url } : {}) });
      }
    } else {
      const type = tag === "a" ? "text_link" : ENTITY_TYPES[tag];
      if (type) {
        const url = tag === "a" ? decode(raw.match(/href\s*=\s*["']([^"']+)["']/i)?.[1] ?? "") : undefined;
        if (tag !== "a" || /^(?:https?:\/\/|tg:\/\/)/i.test(url ?? "")) stack.push({ tag, type, offset: text.length, ...(url ? { url } : {}) });
      }
    }
    cursor = index + raw.length;
  }
  text += decode(source.slice(cursor));
  return { text, entities: entities.sort((a, b) => a.offset - b.offset || b.length - a.length) };
}
