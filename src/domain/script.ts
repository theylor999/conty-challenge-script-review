import { endOfDay, formatCivilDate, parseCivilDate } from "./civil-date.ts";
import { fail } from "./errors.ts";
import type { Clock } from "./clock.ts";

export const BRAND_TIMEZONE = "America/Sao_Paulo";

export type Actor = "brand" | "creator";
export type ScriptStatus = "awaiting_brand_review" | "changes_requested" | "approved";
export type Action = "submit_version" | "request_changes" | "approve";
export type ChangeRequestStatus = "open" | "answered" | "answered_late" | "closed_by_approval";

const MAX_DAYS_AHEAD = 366;

export interface ScriptVersion {
  number: number;
  content: string; // never edited after creation
  submittedAt: string;
}

export interface ChangeRequest {
  number: number;
  /** Version the brand reviewed when asking for changes. */
  version: number;
  reason: string;
  dueDate: string; // civil date in BRAND_TIMEZONE, as the brand typed it
  dueAt: string; // last millisecond of dueDate in BRAND_TIMEZONE, ISO UTC
  requestedAt: string;
  status: ChangeRequestStatus;
  answeredByVersion: number | null;
  closedAt: string | null;
}

export interface Script {
  id: string;
  title: string;
  status: ScriptStatus;
  createdAt: string;
  versions: ScriptVersion[]; // append-only
  changeRequests: ChangeRequest[]; // append-only; only status/answered* change, once
  approvedVersion: number | null;
  approvedAt: string | null;
}

export type TimelineEntry =
  | { type: "version_submitted"; at: string; actor: "creator"; version: number; answers_change_request: number | null; late: boolean }
  | {
      type: "changes_requested";
      at: string;
      actor: "brand";
      version: number;
      change_request: number;
      reason: string;
      due_date: string;
      due_at: string;
      status: ChangeRequestStatus;
    }
  | { type: "approved"; at: string; actor: "brand"; version: number };

export const currentVersion = (s: Script): ScriptVersion => s.versions[s.versions.length - 1]!;

export const openChangeRequest = (s: Script): ChangeRequest | null =>
  s.changeRequests.find((c) => c.status === "open") ?? null;

export function awaiting(s: Script): Actor | "none" {
  if (s.status === "approved") return "none";
  return s.status === "changes_requested" ? "creator" : "brand";
}

/** Actions the given actor may take right now. Read access is open to both and not listed. */
export function allowedActions(s: Script, actor: Actor): Action[] {
  if (actor === "brand") {
    if (s.status === "awaiting_brand_review") return ["request_changes", "approve"];
    if (s.status === "changes_requested") return ["approve"];
  }
  if (actor === "creator" && s.status === "changes_requested") return ["submit_version"];
  return [];
}

export function createScript(input: { id: string; title: string; content: string }, clock: Clock): Script {
  const now = clock.now().toISOString();
  return {
    id: input.id,
    title: input.title,
    status: "awaiting_brand_review",
    createdAt: now,
    versions: [{ number: 1, content: input.content, submittedAt: now }],
    changeRequests: [],
    approvedVersion: null,
    approvedAt: null,
  };
}

/** Every mutation starts here: an approved script is closed for good. */
export function assertNotApproved(s: Script): void {
  if (s.status === "approved") fail("conflict", "script_approved", "O roteiro já foi aprovado e não aceita mais alterações.");
}

function assertCurrentVersion(s: Script, version: number): void {
  const current = currentVersion(s).number;
  if (version !== current) {
    fail(
      "conflict",
      "stale_version",
      `A versão ${version} não é mais a atual. A versão atual é a ${current}.`,
    );
  }
}

export function requestChanges(
  s: Script,
  input: { version: number; reason: string; dueDate: string },
  clock: Clock,
): Script {
  assertNotApproved(s);
  assertCurrentVersion(s, input.version);
  if (s.status === "changes_requested") {
    fail("conflict", "changes_already_requested", "Já existe uma solicitação de ajustes em aberto para esta versão.");
  }
  const date = parseCivilDate(input.dueDate)!; // validated at the edge
  const dueAt = endOfDay(date, BRAND_TIMEZONE);
  const now = clock.now();
  if (now.getTime() > dueAt) {
    fail("validation", "due_date_in_past", "O prazo já passou. Informe uma data de hoje ou futura (fuso America/Sao_Paulo).");
  }
  if (dueAt - now.getTime() > MAX_DAYS_AHEAD * 86_400_000) {
    fail("validation", "due_date_too_far", `O prazo está longe demais. Ele deve terminar em até ${MAX_DAYS_AHEAD} dias a partir de agora.`);
  }
  const request: ChangeRequest = {
    number: s.changeRequests.length + 1,
    version: input.version,
    reason: input.reason,
    dueDate: formatCivilDate(date),
    dueAt: new Date(dueAt).toISOString(),
    requestedAt: now.toISOString(),
    status: "open",
    answeredByVersion: null,
    closedAt: null,
  };
  return { ...s, status: "changes_requested", changeRequests: [...s.changeRequests, request] };
}

/**
 * The creator may answer after the deadline: the version is accepted and the
 * request is closed as answered_late, so the delay stays on record.
 */
export function submitVersion(s: Script, content: string, clock: Clock): Script {
  assertNotApproved(s);
  if (s.status !== "changes_requested") {
    fail("conflict", "not_awaiting_creator", "A versão atual está em análise pela marca. Aguarde um pedido de ajustes para enviar outra versão.");
  }
  const now = clock.now();
  const nowIso = now.toISOString();
  const number = currentVersion(s).number + 1;
  const changeRequests = s.changeRequests.map((c) =>
    c.status === "open"
      ? {
          ...c,
          status: now.getTime() > Date.parse(c.dueAt) ? ("answered_late" as const) : ("answered" as const),
          answeredByVersion: number,
          closedAt: nowIso,
        }
      : c,
  );
  return {
    ...s,
    status: "awaiting_brand_review",
    versions: [...s.versions, { number, content, submittedAt: nowIso }],
    changeRequests,
  };
}

/**
 * The brand may approve the current version while its own request is still open
 * (it changed its mind, or the creator never answered). The request stays on
 * record as closed_by_approval.
 */
export function approve(s: Script, version: number, clock: Clock): Script {
  assertNotApproved(s);
  assertCurrentVersion(s, version);
  const at = clock.now().toISOString();
  return {
    ...s,
    status: "approved",
    approvedVersion: version,
    approvedAt: at,
    changeRequests: s.changeRequests.map((c) =>
      c.status === "open" ? { ...c, status: "closed_by_approval" as const, closedAt: at } : c,
    ),
  };
}

/**
 * Causal order, not clock order: v1, then the request on v1, then v2, ... then the approval.
 * Each version has at most one request or approval, so (version, kind) is a total order.
 */
export function timeline(s: Script): TimelineEntry[] {
  const entries: Array<{ key: number; entry: TimelineEntry }> = [];
  for (const v of s.versions) {
    const answered = s.changeRequests.find((c) => c.answeredByVersion === v.number) ?? null;
    entries.push({
      key: v.number * 10,
      entry: {
        type: "version_submitted",
        at: v.submittedAt,
        actor: "creator",
        version: v.number,
        answers_change_request: answered?.number ?? null,
        late: answered?.status === "answered_late",
      },
    });
  }
  for (const c of s.changeRequests) {
    entries.push({
      key: c.version * 10 + 1,
      entry: {
        type: "changes_requested",
        at: c.requestedAt,
        actor: "brand",
        version: c.version,
        change_request: c.number,
        reason: c.reason,
        due_date: c.dueDate,
        due_at: c.dueAt,
        status: c.status,
      },
    });
  }
  if (s.approvedVersion !== null && s.approvedAt !== null) {
    entries.push({
      key: s.approvedVersion * 10 + 2,
      entry: { type: "approved", at: s.approvedAt, actor: "brand", version: s.approvedVersion },
    });
  }
  return entries.sort((a, b) => a.key - b.key).map((e) => e.entry);
}
