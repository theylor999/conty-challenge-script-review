import { parseCivilDate } from "./civil-date.ts";
import { fail } from "./errors.ts";

export const LIMITS = { title: 120, content: 50_000, reason: 1_000 } as const;

type Body = Record<string, unknown>;

export function asBody(raw: unknown): Body {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return fail("validation", "body_invalid", "O corpo da requisição deve ser um objeto JSON.");
  }
  return raw as Body;
}

function requiredText(body: Body, field: string, max: number, label: string, tooLong: string, missing: string, trim: boolean): string {
  const value = body[field];
  if (typeof value !== "string" || value.trim() === "") {
    return fail("validation", missing, `${label} é obrigatório e não pode ficar em branco.`);
  }
  const text = trim ? value.trim() : value;
  if (text.length > max) fail("validation", tooLong, `${label} deve ter no máximo ${max} caracteres.`);
  return text;
}

export function parseCreateScript(raw: unknown): { title: string; content: string } {
  const body = asBody(raw);
  return {
    title: requiredText(body, "title", LIMITS.title, "O título", "title_too_long", "title_required", true),
    content: requiredText(body, "content", LIMITS.content, "O conteúdo do roteiro", "content_too_long", "content_required", false),
  };
}

export function parseContent(raw: unknown): { content: string } {
  const body = asBody(raw);
  return { content: requiredText(body, "content", LIMITS.content, "O conteúdo do roteiro", "content_too_long", "content_required", false) };
}

export function parseVersion(body: Body): number {
  const version = body.version;
  if (version === undefined || version === null) {
    return fail("validation", "version_required", "Informe a versão analisada em `version`.");
  }
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return fail("validation", "version_invalid", "`version` deve ser um número inteiro positivo.");
  }
  return version;
}

export function parseApprove(raw: unknown): { version: number } {
  return { version: parseVersion(asBody(raw)) };
}

export function parseChangeRequest(raw: unknown): { version: number; reason: string; dueDate: string } {
  const body = asBody(raw);
  const reason = requiredText(body, "reason", LIMITS.reason, "O motivo", "reason_too_long", "reason_required", true);
  const dueDate = body.due_date;
  if (dueDate === undefined || dueDate === null || dueDate === "") {
    return fail("validation", "due_date_required", "Informe o prazo em `due_date` (YYYY-MM-DD).");
  }
  if (typeof dueDate !== "string" || parseCivilDate(dueDate) === null) {
    return fail("validation", "due_date_invalid", "`due_date` deve ser uma data válida no formato YYYY-MM-DD, sem horário.");
  }
  return { version: parseVersion(body), reason, dueDate };
}
