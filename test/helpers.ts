import { openStore } from "../src/db.ts";
import { fixedClock } from "../src/domain/clock.ts";
import { createApp } from "../src/http/app.ts";

interface TimelineItem {
  type: string;
  version: number;
  actor: string;
  reason: string;
  due_date: string;
  due_at: string;
  status: string;
  answers_change_request: number | null;
  late: boolean;
}

/** One loose shape for every response; each endpoint only fills the fields it documents. */
export interface Body {
  id: string;
  status: string;
  awaiting: string;
  current_version: number;
  content: string;
  allowed_actions: string[];
  open_change_request: { number: number; version: number; reason: string; due_at: string; overdue: boolean } | null;
  approved_version: number | null;
  script: Body;
  versions: { number: number; content: string }[];
  timeline: TimelineItem[];
  error: { code: string; message: string };
}

export function setup(startAt = "2026-03-10T15:00:00.000Z") {
  const clock = fixedClock(startAt);
  let seq = 0;
  const app = createApp({ store: openStore(), clock, newId: () => `s${++seq}` });

  async function call(method: string, path: string, actor?: string, body?: unknown) {
    const res = await app.request(path, {
      method,
      headers: { ...(actor ? { "x-actor": actor } : {}), "content-type": "application/json" },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Body };
  }

  const create = (content = "Roteiro v1") => call("POST", "/scripts", "creator", { title: "Campanha Verão", content });
  const requestChanges = (id: string, body: unknown) => call("POST", `/scripts/${id}/change-requests`, "brand", body);
  const submit = (id: string, content = "Roteiro novo") => call("POST", `/scripts/${id}/versions`, "creator", { content });
  const approve = (id: string, version: number) => call("POST", `/scripts/${id}/approve`, "brand", { version });
  const get = (id: string, actor = "brand") => call("GET", `/scripts/${id}`, actor);
  const history = (id: string, actor = "brand") => call("GET", `/scripts/${id}/history`, actor);

  return { app, clock, call, create, requestChanges, submit, approve, get, history };
}
