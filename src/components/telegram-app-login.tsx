"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type LoginState =
  | { phase: "loading" }
  | { phase: "ready"; token: string; deepLink: string }
  | { phase: "failed"; message: string };

const ERROR_MESSAGES: Record<string, string> = {
  not_linked: "Этот Telegram-аккаунт не привязан ни к одному администратору. Войдите по email и привяжите Telegram в разделе «Система → Аккаунты».",
  no_admin_chats: "Вы не администратор ни одного чата, подключённого к Modera.",
  not_found: "Ссылка устарела или уже использована — попробуйте ещё раз."
};

/**
 * Opens the login inside the Telegram app itself (t.me/<bot>?start=login_<token>)
 * instead of Telegram's JS login widget -- the widget authenticates whatever
 * Telegram Web/Desktop session is already active in this browser with no way to
 * choose a different one. A t.me deep link opens the Telegram app, and if the
 * person has multiple accounts signed into it, Telegram's own UI is what handles
 * picking which one sends /start -- nothing here renders that picker, it's just
 * the flow that lets Telegram's native one apply.
 */
export function TelegramAppLogin({ botUsername }: { botUsername: string }) {
  const router = useRouter();
  const [state, setState] = useState<LoginState>({ phase: "loading" });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function requestLogin() {
    let active = true;
    fetch("/api/auth/telegram-login", { method: "POST" })
      .then((response) => response.json().catch(() => null).then((payload) => ({ response, payload })))
      .then(({ response, payload }) => {
        if (!active) return;
        if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось начать вход через Telegram.");
        const token = payload.data.token as string;
        setState({ phase: "ready", token, deepLink: `https://t.me/${botUsername}?start=login_${token}` });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({ phase: "failed", message: error instanceof Error ? error.message : "Не удалось начать вход через Telegram." });
      });
    return () => {
      active = false;
    };
  }

  function retryLogin() {
    setState({ phase: "loading" });
    requestLogin();
  }

  useEffect(() => {
    return requestLogin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (state.phase !== "ready") return;
    const token = state.token;

    async function poll() {
      const response = await fetch(`/api/auth/telegram-login/${token}`).catch(() => null);
      const payload = await response?.json().catch(() => null);
      const status = payload?.data?.status as string | undefined;
      if (status === "completed") {
        if (pollRef.current) clearInterval(pollRef.current);
        router.replace("/overview");
        router.refresh();
      } else if (status === "failed" || status === "not_found") {
        if (pollRef.current) clearInterval(pollRef.current);
        const errorCode = payload?.data?.errorCode as string | undefined;
        setState({ phase: "failed", message: ERROR_MESSAGES[errorCode ?? status] ?? ERROR_MESSAGES.not_found });
      }
    }

    pollRef.current = setInterval(() => void poll(), 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [state, router]);

  if (state.phase === "loading") {
    return <div className="auth-telegram-status">Готовим ссылку для входа…</div>;
  }

  if (state.phase === "failed") {
    return (
      <div className="auth-telegram-status">
        <div className="form-error" role="alert">{state.message}</div>
        <button type="button" className="button button--secondary button--full" onClick={retryLogin}>
          Попробовать снова
        </button>
      </div>
    );
  }

  return (
    <div className="auth-telegram-status">
      <a className="button button--primary button--full" href={state.deepLink} target="_blank" rel="noreferrer">
        Войти через Telegram
      </a>
      <small>Откроется приложение Telegram. Если в нём несколько аккаунтов — Telegram сам предложит выбрать нужный.</small>
    </div>
  );
}
