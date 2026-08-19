import { AppealsClient } from "@/components/appeals-client";
import { requireAdminPage } from "@/server/auth/guards";
import { canModerate } from "@/server/auth/permissions";

export const dynamic = "force-dynamic";

export default async function AppealsPage() {
  const admin = await requireAdminPage();
  return (
    <main className="page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Апелляции</span>
          <h1>Апелляции</h1>
          <p>Пользователи подают апелляцию в ЛС бота (/appeal ответом на уведомление о наказании). Здесь — рассмотрение и решение.</p>
        </div>
      </header>
      <AppealsClient canModerate={canModerate(admin.role)} />
    </main>
  );
}
