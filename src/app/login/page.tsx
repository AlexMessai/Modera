import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { getCurrentAdmin } from "@/server/auth/session";

export default async function LoginPage() {
  const admin = await getCurrentAdmin();
  if (admin) redirect("/overview");

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="brand brand--auth"><span className="brand-mark">M</span><span>Modera</span></div>
        <div className="auth-copy">
          <h1>Вход в админ-панель</h1>
          <p>Управление Telegram-чатами, участниками и модерацией.</p>
        </div>
        <LoginForm />
      </section>
    </main>
  );
}
