export const memberStatusLabels: Record<string, string> = {
  CREATOR: "Владелец",
  ADMINISTRATOR: "Администратор",
  MEMBER: "Участник",
  RESTRICTED: "Ограничен",
  PENDING: "Запрос на вступление",
  LEFT: "Вышел",
  BANNED: "Заблокирован",
  UNKNOWN: "Не определён"
};

export function memberStatusLabel(status: string) {
  return memberStatusLabels[status] ?? status;
}

export function memberStatusBadgeClass(status: string) {
  switch (status) {
    case "CREATOR":
    case "ADMINISTRATOR":
      return "badge--admin";
    case "MEMBER":
      return "badge--active";
    case "RESTRICTED":
    case "PENDING":
      return "badge--warning";
    case "LEFT":
    case "BANNED":
      return "badge--danger";
    default:
      return "";
  }
}
