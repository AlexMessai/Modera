"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { TelegramAppLogin } from "@/components/telegram-app-login";

export function LoginForm({ telegramBotUsername }: { telegramBotUsername?: string | null }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? "")
      })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setError(payload?.error?.message ?? "Не удалось войти.");
      setLoading(false);
      return;
    }
    router.replace("/overview");
    router.refresh();
  }

  return (
    <form className="auth-form" onSubmit={onSubmit}>
      <label className="field">
        <span>Электронная почта</span>
        <input name="email" type="email" autoComplete="email" placeholder="owner@example.com" required />
      </label>
      <label className="field">
        <span>Пароль</span>
        <input name="password" type="password" autoComplete="current-password" placeholder="Введите пароль" minLength={8} required />
      </label>
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      <button className="button button--primary button--full" disabled={loading}>
        {loading ? "Входим…" : "Войти"}
      </button>

      {telegramBotUsername ? (
        <div className="auth-divider-block">
          <div className="auth-divider"><span>или</span></div>
          <TelegramAppLogin botUsername={telegramBotUsername} />
        </div>
      ) : null}
    </form>
  );
}
