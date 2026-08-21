import type { Metadata } from "next";
import { CommandsReference } from "@/components/commands-reference-client";
import { COMMAND_CATEGORIES } from "@/components/commands-reference-data";

export const metadata: Metadata = {
  title: "Команды Modera",
  description: "Команды ручной модерации Modera: /warn, /mute, /ban и другие."
};

export default function CommandsPage() {
  return (
    <main className="cmd-page">
      <header className="cmd-page-header">
        <div className="brand"><span className="brand-mark">M</span><span>Modera</span></div>
        <h1>Команды Modera</h1>
        <p>Modera управляется командами прямо в чате. Отправьте команду, отвечая (Reply) на сообщение участника — либо укажите @username или Telegram ID сразу после команды.</p>

        <div className="cmd-note-grid">
          <div className="cmd-note"><strong>Цель команды</strong><div>Reply на сообщение участника, либо <code>@username</code> / Telegram ID сразу после названия команды. Причина и срок (где применимо) идут дальше в том же сообщении.</div></div>
          <div className="cmd-note"><strong>Права</strong><div>Каждая команда требует своего права — их выдают в разделе «Роли» для конкретного чата.</div></div>
          <div className="cmd-note"><strong>Сообщение с командой</strong><div>Удаляется ботом сразу после обработки — независимо от результата.</div></div>
          <div className="cmd-note"><strong>Публичные и приватные уведомления</strong><div>Показывать ли результат в общем чате и присылать ли наказанному участнику личное уведомление — настраивается глобально в «Модерация → Ручная модерация», а не по отдельным командам.</div></div>
        </div>
      </header>

      <CommandsReference categories={COMMAND_CATEGORIES} />
    </main>
  );
}
