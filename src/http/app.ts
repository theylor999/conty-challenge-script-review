import { Hono, type Context } from "hono";
import { randomUUID } from "node:crypto";
import type { ScriptStore } from "../db.ts";
import type { Clock } from "../domain/clock.ts";
import { DomainError, fail, type ErrorKind } from "../domain/errors.ts";
import { approve, createScript, requestChanges, submitVersion, type Actor, type Script } from "../domain/script.ts";
import { parseApprove, parseChangeRequest, parseContent, parseCreateScript } from "../domain/validation.ts";
import { historyView, scriptView } from "./view.ts";

export interface Deps {
  store: ScriptStore;
  clock: Clock;
  newId?: () => string;
}

const STATUS: Record<ErrorKind, 400 | 401 | 403 | 404 | 409 | 422> = {
  bad_request: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  validation: 422,
};

/**
 * x-actor is a stand-in for real authentication: whoever sends the header is
 * trusted. A real deployment would derive the actor from a token.
 */
function actorOf(c: Context): Actor {
  const header = c.req.header("x-actor");
  if (header === "brand" || header === "creator") return header;
  return fail("unauthenticated", "actor_invalid", "Informe o cabeçalho x-actor com o valor `brand` ou `creator`.");
}

function requireRole(c: Context, role: Actor): Actor {
  const actor = actorOf(c);
  if (actor !== role) {
    const who = role === "brand" ? "a marca" : "a criadora ou o criador";
    fail("forbidden", "forbidden_actor", `Somente ${who} pode executar esta ação.`);
  }
  return actor;
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return fail("bad_request", "invalid_json", "O corpo da requisição não é um JSON válido.");
  }
}

export function createApp({ store, clock, newId = randomUUID }: Deps) {
  const app = new Hono();

  const load = (id: string): Script => store.get(id) ?? fail("not_found", "script_not_found", "Roteiro não encontrado.");

  // Handlers read the body first and then run load -> change -> save with no await in between,
  // so two requests cannot interleave on the same script.
  app.post("/scripts", async (c) => {
    const actor = requireRole(c, "creator");
    const input = parseCreateScript(await readJson(c));
    const script = createScript({ id: newId(), ...input }, clock);
    store.insert(script);
    return c.json(scriptView(script, actor, clock.now()), 201);
  });

  app.get("/scripts/:id", (c) => {
    const actor = actorOf(c);
    return c.json(scriptView(load(c.req.param("id")), actor, clock.now()));
  });

  app.get("/scripts/:id/history", (c) => {
    const actor = actorOf(c);
    return c.json(historyView(load(c.req.param("id")), actor, clock.now()));
  });

  app.post("/scripts/:id/versions", async (c) => {
    const actor = requireRole(c, "creator");
    const body = await readJson(c);
    const script = load(c.req.param("id"));
    const next = submitVersion(script, parseContent(body).content, clock);
    store.save(next);
    return c.json(scriptView(next, actor, clock.now()), 201);
  });

  app.post("/scripts/:id/change-requests", async (c) => {
    const actor = requireRole(c, "brand");
    const body = await readJson(c);
    const script = load(c.req.param("id"));
    const next = requestChanges(script, parseChangeRequest(body), clock);
    store.save(next);
    return c.json(scriptView(next, actor, clock.now()), 201);
  });

  app.post("/scripts/:id/approve", async (c) => {
    const actor = requireRole(c, "brand");
    const body = await readJson(c);
    const script = load(c.req.param("id"));
    const next = approve(script, parseApprove(body).version, clock);
    store.save(next);
    return c.json(scriptView(next, actor, clock.now()));
  });

  app.notFound((c) => c.json({ error: { code: "route_not_found", message: "Rota não encontrada." } }, 404));

  app.onError((err, c) => {
    if (err instanceof DomainError) {
      return c.json({ error: { code: err.code, message: err.message } }, STATUS[err.kind]);
    }
    console.error(err);
    return c.json({ error: { code: "internal_error", message: "Erro interno." } }, 500);
  });

  return app;
}
