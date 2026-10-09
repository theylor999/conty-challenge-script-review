import { describe, expect, it } from "vitest";
import { LIMITS } from "../src/domain/validation.ts";
import { setup } from "./helpers.ts";

const ok = { version: 1, reason: "Motivo", due_date: "2026-03-20" };

describe("pedido de ajustes: motivo e prazo obrigatórios", () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ["sem reason", { version: 1, due_date: "2026-03-20" }, "reason_required"],
    ["reason vazio", { ...ok, reason: "" }, "reason_required"],
    ["reason só com espaços e quebras", { ...ok, reason: "  \n\t " }, "reason_required"],
    ["reason que não é texto", { ...ok, reason: 42 }, "reason_required"],
    ["reason acima do limite", { ...ok, reason: "x".repeat(LIMITS.reason + 1) }, "reason_too_long"],
    ["sem due_date", { version: 1, reason: "Motivo" }, "due_date_required"],
    ["due_date nulo", { ...ok, due_date: null }, "due_date_required"],
    ["due_date vazio", { ...ok, due_date: "" }, "due_date_required"],
    ["due_date com horário", { ...ok, due_date: "2026-03-20T10:00:00Z" }, "due_date_invalid"],
    ["due_date com espaços", { ...ok, due_date: " 2026-03-20" }, "due_date_invalid"],
    ["due_date no formato brasileiro", { ...ok, due_date: "20/03/2026" }, "due_date_invalid"],
    ["due_date sem zero à esquerda", { ...ok, due_date: "2026-3-20" }, "due_date_invalid"],
    ["30 de fevereiro", { ...ok, due_date: "2026-02-30" }, "due_date_invalid"],
    ["29 de fevereiro em ano comum", { ...ok, due_date: "2026-02-29" }, "due_date_invalid"],
    ["mês 13", { ...ok, due_date: "2026-13-01" }, "due_date_invalid"],
    ["dia 31 em mês de 30", { ...ok, due_date: "2026-04-31" }, "due_date_invalid"],
    ["due_date numérico (timestamp)", { ...ok, due_date: 1773792000000 }, "due_date_invalid"],
    ["sem version", { reason: "Motivo", due_date: "2026-03-20" }, "version_required"],
    ["version como texto", { ...ok, version: "1" }, "version_invalid"],
    ["version fracionária", { ...ok, version: 1.5 }, "version_invalid"],
    ["version zero", { ...ok, version: 0 }, "version_invalid"],
  ];

  it.each(cases)("%s -> 422 %s", async (_name, body, code) => {
    const t = setup();
    await t.create();
    const res = await t.requestChanges("s1", body);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe(code);
    expect(res.body.error.message).toEqual(expect.any(String));
  });

  it("29 de fevereiro em ano bissexto é uma data válida", async () => {
    const t = setup("2028-02-01T12:00:00.000Z");
    await t.create();
    const res = await t.requestChanges("s1", { ...ok, due_date: "2028-02-29" });
    expect(res.status).toBe(201);
    expect(res.body.open_change_request?.due_at).toBe("2028-03-01T02:59:59.999Z");
  });

  it("o motivo é guardado sem espaços nas pontas", async () => {
    const t = setup();
    await t.create();
    const res = await t.requestChanges("s1", { ...ok, reason: "\n  Trocar a abertura \t" });
    expect(res.body.open_change_request?.reason).toBe("Trocar a abertura");
  });
});

describe("outras entradas", () => {
  it("JSON inválido -> 400 invalid_json", async () => {
    const t = setup();
    await t.create();
    const res = await t.call("POST", "/scripts/s1/change-requests", "brand", "{nope");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_json");
  });

  it("corpo que não é objeto -> 422 body_invalid", async () => {
    const t = setup();
    const res = await t.call("POST", "/scripts", "creator", [1, 2]);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("body_invalid");
  });

  it("criar roteiro exige título e conteúdo", async () => {
    const t = setup();
    expect((await t.call("POST", "/scripts", "creator", { content: "x" })).body.error.code).toBe("title_required");
    expect((await t.call("POST", "/scripts", "creator", { title: "x", content: "   " })).body.error.code).toBe("content_required");
    expect((await t.call("POST", "/scripts", "creator", { title: "x", content: "y".repeat(LIMITS.content + 1) })).body.error.code).toBe("content_too_long");
  });

  it("nova versão exige conteúdo", async () => {
    const t = setup();
    await t.create();
    await t.requestChanges("s1", ok);
    const res = await t.submit("s1", "  ");
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("content_required");
    expect((await t.get("s1")).body.current_version).toBe(1);
  });

  it("aprovar exige a versão", async () => {
    const t = setup();
    await t.create();
    const res = await t.call("POST", "/scripts/s1/approve", "brand", {});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("version_required");
  });

  it("roteiro e rota inexistentes -> 404 no formato padrão", async () => {
    const t = setup();
    const missing = await t.get("nao-existe");
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("script_not_found");
    expect((await t.requestChanges("nao-existe", ok)).body.error.code).toBe("script_not_found");
    const route = await t.call("GET", "/nada", "brand");
    expect(route.status).toBe(404);
    expect(route.body.error.code).toBe("route_not_found");
  });
});
