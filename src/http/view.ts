import {
  allowedActions,
  awaiting,
  BRAND_TIMEZONE,
  currentVersion,
  openChangeRequest,
  timeline,
  type Actor,
  type Script,
} from "../domain/script.ts";

/** Response shape shared by every endpoint, so the client reads state instead of inferring it. */
export function scriptView(s: Script, actor: Actor, now: Date) {
  const current = currentVersion(s);
  const open = openChangeRequest(s);
  return {
    id: s.id,
    title: s.title,
    status: s.status,
    awaiting: awaiting(s),
    current_version: current.number,
    content: current.content,
    allowed_actions: allowedActions(s, actor),
    open_change_request: open && {
      number: open.number,
      version: open.version,
      reason: open.reason,
      due_date: open.dueDate,
      due_at: open.dueAt,
      overdue: now.getTime() > Date.parse(open.dueAt),
      requested_at: open.requestedAt,
    },
    approved_version: s.approvedVersion,
    approved_at: s.approvedAt,
    timezone: BRAND_TIMEZONE,
    created_at: s.createdAt,
  };
}

export function historyView(s: Script, actor: Actor, now: Date) {
  return {
    script: scriptView(s, actor, now),
    versions: s.versions.map((v) => ({ number: v.number, content: v.content, submitted_at: v.submittedAt })),
    timeline: timeline(s),
  };
}
