import { MembersClient } from "@/components/members-client";
import { requireAdminPage } from "@/server/auth/guards";
import { canManageChatSettings } from "@/server/auth/permissions";

export default async function MembersPage() {
  const admin = await requireAdminPage();
  return (
    <main className="page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Telegram</span>
          <h1>Участники</h1>
          <p>
            Реальные пользователи, которых Modera обнаружила через Telegram updates и
            список администраторов.
          </p>
        </div>
      </header>
      <MembersClient canManageTrust={canManageChatSettings(admin.role)} />
    </main>
  );
}
