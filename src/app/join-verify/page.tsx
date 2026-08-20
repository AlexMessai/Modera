"use client";

import { useEffect, useState } from "react";
import Script from "next/script";

type TelegramWebApp = {
  initData: string;
  ready: () => void;
  expand: () => void;
  close: () => void;
  themeParams?: {
    bg_color?: string;
    text_color?: string;
    hint_color?: string;
    button_color?: string;
    button_text_color?: string;
  };
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

type Status = "loading" | "ready" | "submitting" | "done" | "error";

export default function JoinVerifyPage() {
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);

  function onScriptLoad() {
    const webApp = window.Telegram?.WebApp;
    if (!webApp || !webApp.initData) {
      setStatus("error");
      setError("Откройте эту страницу из Telegram по кнопке в заявке на вступление.");
      return;
    }
    webApp.ready();
    webApp.expand();
    setStatus("ready");
  }

  async function confirm() {
    const webApp = window.Telegram?.WebApp;
    if (!webApp) return;
    setStatus("submitting");
    setError(null);
    try {
      const response = await fetch("/api/telegram/join-verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ initData: webApp.initData })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось подтвердить заявку.");
      setStatus("done");
      setTimeout(() => webApp.close(), 1500);
    } catch (caught) {
      setStatus("error");
      setError(caught instanceof Error ? caught.message : "Не удалось подтвердить заявку.");
    }
  }

  useEffect(() => {
    // themeParams only exist once the script has run; harmless no-op before that.
    const theme = window.Telegram?.WebApp?.themeParams;
    if (!theme) return;
    const root = document.documentElement.style;
    if (theme.bg_color) root.setProperty("--tg-bg", theme.bg_color);
    if (theme.text_color) root.setProperty("--tg-text", theme.text_color);
    if (theme.hint_color) root.setProperty("--tg-hint", theme.hint_color);
    if (theme.button_color) root.setProperty("--tg-button", theme.button_color);
    if (theme.button_text_color) root.setProperty("--tg-button-text", theme.button_text_color);
  }, [status]);

  return (
    <>
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" onLoad={onScriptLoad} />
      <main className="join-verify-shell">
        <div className="join-verify-card">
          {status === "loading" ? <p>Загрузка…</p> : null}

          {status === "ready" || status === "submitting" ? (
            <>
              <h1>Подтвердите, что вы не бот</h1>
              <p>Нажмите кнопку ниже, чтобы завершить заявку на вступление в чат.</p>
              <button type="button" onClick={() => void confirm()} disabled={status === "submitting"}>
                {status === "submitting" ? "Проверяю…" : "Я не бот, продолжить"}
              </button>
            </>
          ) : null}

          {status === "done" ? <p>✅ Готово! Возвращайтесь в чат.</p> : null}

          {status === "error" ? <p className="join-verify-error">{error}</p> : null}
        </div>
      </main>
      <style>{`
        :root {
          --tg-bg: #ffffff;
          --tg-text: #1c1c1e;
          --tg-hint: #8e8e93;
          --tg-button: #2481cc;
          --tg-button-text: #ffffff;
        }
        .join-verify-shell {
          min-height: 100vh;
          display: grid;
          place-items: center;
          padding: 24px;
          background: var(--tg-bg);
          color: var(--tg-text);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        .join-verify-card {
          width: min(100%, 360px);
          text-align: center;
          display: grid;
          gap: 12px;
        }
        .join-verify-card h1 {
          font-size: 20px;
          margin: 0;
        }
        .join-verify-card p {
          margin: 0;
          color: var(--tg-hint);
          font-size: 14px;
          line-height: 1.5;
        }
        .join-verify-card button {
          margin-top: 8px;
          padding: 12px 20px;
          border: none;
          border-radius: 10px;
          background: var(--tg-button);
          color: var(--tg-button-text);
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
        }
        .join-verify-card button:disabled {
          opacity: 0.6;
          cursor: default;
        }
        .join-verify-error {
          color: #d33;
        }
      `}</style>
    </>
  );
}
