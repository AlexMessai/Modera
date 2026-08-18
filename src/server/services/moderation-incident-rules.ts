export type IncidentSeverityValue = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export function incidentSeverityFor(rule: string, previousViolationCount: number): IncidentSeverityValue {
  if (previousViolationCount >= 5) return "CRITICAL";
  if (["SPAM", "DUPLICATE", "MENTIONS"].includes(rule) || previousViolationCount >= 2) return "HIGH";
  return ["LINK", "TERM", "MEDIA"].includes(rule) ? "MEDIUM" : "LOW";
}
