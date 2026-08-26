import type { Metadata } from "next";
import { Manrope, Inter } from "next/font/google";
import "./globals.css";
import "./members.css";
import "./automod.css";
import "./journal.css";
import "./messages.css";
import "./moderation.css";
import "./system.css";
import "./notification-center.css";
import "./settings.css";
import "./join-requests.css";
import "./dashboard.css";
import "./appeals.css";
import "./commands.css";
import "./chats.css";

const manrope = Manrope({
  subsets: ["cyrillic", "latin"],
  variable: "--font-heading",
  display: "swap"
});

const inter = Inter({
  subsets: ["cyrillic", "latin"],
  variable: "--font-body",
  display: "swap"
});

export const metadata: Metadata = {
  title: "Modera — Управление Telegram",
  description: "Управление Telegram-чатами и модерацией"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body className={`${manrope.variable} ${inter.variable}`}>{children}</body>
    </html>
  );
}
