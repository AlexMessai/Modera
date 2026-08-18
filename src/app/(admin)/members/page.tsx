import { MembersClient } from "@/components/members-client";

export default function MembersPage() {
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
      <MembersClient />
    </main>
  );
}
