"use client";

import { useEffect, useId, useRef } from "react";

export type TelegramAuthUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
};

/**
 * Renders Telegram's own login-widget iframe (https://core.telegram.org/widgets/login).
 * The bot must have its domain registered via @BotFather (/setdomain) for the
 * widget to work — that's a manual step outside this codebase.
 */
export function TelegramLoginWidget({
  botUsername,
  onAuth,
  size = "large"
}: {
  botUsername: string;
  onAuth: (user: TelegramAuthUser) => void;
  size?: "large" | "medium" | "small";
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onAuthRef = useRef(onAuth);
  onAuthRef.current = onAuth;
  const rawId = useId();
  const callbackName = `telegramLoginCallback_${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    (window as unknown as Record<string, unknown>)[callbackName] = (user: TelegramAuthUser) => onAuthRef.current(user);

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", size);
    script.setAttribute("data-onauth", `${callbackName}(user)`);
    script.setAttribute("data-request-access", "write");
    container.appendChild(script);

    return () => {
      delete (window as unknown as Record<string, unknown>)[callbackName];
      container.replaceChildren();
    };
  }, [botUsername, size, callbackName]);

  return <div ref={containerRef} className="telegram-login-widget" />;
}
