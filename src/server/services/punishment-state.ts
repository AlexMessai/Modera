export function isMuteExpired(
  member: { punishmentState: string | null; punishmentExpiresAt: Date | null },
  now = new Date()
) {
  return member.punishmentState === "MUTED" &&
    Boolean(member.punishmentExpiresAt && member.punishmentExpiresAt <= now);
}

export function effectivePunishmentState(
  member: { punishmentState: string | null; punishmentExpiresAt: Date | null },
  now = new Date()
) {
  return isMuteExpired(member, now) ? null : member.punishmentState;
}

export function effectiveMembershipStatus(
  member: { status: string; punishmentState: string | null; punishmentExpiresAt: Date | null },
  now = new Date()
) {
  return isMuteExpired(member, now) && member.status === "RESTRICTED" ? "MEMBER" : member.status;
}
