import type { Metadata } from "next";
import { Onest } from "next/font/google";
import "./globals.css";
import "./members.css";
import "./automod.css";
import "./journal.css";
import "./messages.css";

const onest = Onest({
  subsets: ["cyrillic", "latin"],
  variable: "--font-onest",
  display: "swap"
});

export const metadata: Metadata = {
  title: "Modera — Управление Telegram",
  description: "Управление Telegram-чатами и модерацией"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body className={onest.variable}>{children}</body>
    </html>
  );
}
