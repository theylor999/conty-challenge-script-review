import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

const due = (due_date: string) => ({ version: 1, reason: "Ajustar o tom", due_date });

describe("prazo: último instante do dia em America/Sao_Paulo", () => {
  it("23:59:59.999 de São Paulo (02:59:59.999Z do dia UTC seguinte) ainda vale", async () => {
    const t = setup("2026-03-13T02:59:59.999Z"); // 12/03 23:59:59.999 em SP
    await t.create();
    const res = await t.requestChanges("s1", due("2026-03-12"));
    expect(res.status).toBe(201);
    expect(res.body.open_change_request).toMatchObject({ due_at: "2026-03-13T02:59:59.999Z", overdue: false });
  });

  it("00:00:00.000 de São Paulo do dia seguinte (03:00:00.000Z) já não vale", async () => {
    const t = setup("2026-03-13T03:00:00.000Z"); // 13/03 00:00:00.000 em SP
    await t.create();
    const res = await t.requestChanges("s1", due("2026-03-12"));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("due_date_in_past");
    expect((await t.get("s1")).body.status).toBe("awaiting_brand_review");
  });

  it("UTC já virou o dia mas em SP ainda é dia 13: due_date 2026-03-13 é válido", async () => {
    const t = setup("2026-03-14T01:30:00.000Z"); // 14/03 em UTC, 13/03 22:30 em SP
    await t.create();
    const res = await t.requestChanges("s1", due("2026-03-13"));
    expect(res.status).toBe(201);
    expect(res.body.open_change_request).toMatchObject({ due_date: "2026-03-13", due_at: "2026-03-14T02:59:59.999Z" });
  });

  it("no mesmo instante, o dia 14 em SP ainda é futuro e o dia 12 é passado", async () => {
    const t = setup("2026-03-14T01:30:00.000Z");
    await t.create();
    expect((await t.requestChanges("s1", due("2026-03-12"))).body.error.code).toBe("due_date_in_past");
    expect((await t.requestChanges("s1", due("2026-03-14"))).status).toBe(201);
  });

  it("prazo de hoje (em SP) vale mesmo com o dia já avançado", async () => {
    const t = setup("2026-03-12T14:00:00.000Z");
    await t.create();
    expect((await t.requestChanges("s1", due("2026-03-12"))).status).toBe(201);
  });

  it("data de ontem em SP é recusada", async () => {
    const t = setup("2026-03-12T14:00:00.000Z");
    await t.create();
    const res = await t.requestChanges("s1", due("2026-03-11"));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("due_date_in_past");
  });
});

describe("resposta da criadora depois do prazo", () => {
  async function openRequest(due_date = "2026-03-12") {
    const t = setup("2026-03-10T15:00:00.000Z");
    await t.create();
    await t.requestChanges("s1", due(due_date));
    return t;
  }

  it("no último instante do prazo a versão entra como answered", async () => {
    const t = await openRequest();
    t.clock.set("2026-03-13T02:59:59.999Z");
    expect((await t.get("s1")).body.open_change_request?.overdue).toBe(false);
    await t.submit("s1");
    const { body } = await t.history("s1");
    expect(body.timeline[1]).toMatchObject({ status: "answered" });
    expect(body.timeline[2]).toMatchObject({ late: false });
  });

  it("um milissegundo depois o pedido aparece como overdue, mas segue aberto", async () => {
    const t = await openRequest();
    t.clock.set("2026-03-13T03:00:00.000Z");
    const { body } = await t.get("s1", "creator");
    expect(body.status).toBe("changes_requested");
    expect(body.awaiting).toBe("creator");
    expect(body.allowed_actions).toEqual(["submit_version"]);
    expect(body.open_change_request?.overdue).toBe(true);
  });

  it("envio atrasado é aceito e fica registrado como answered_late", async () => {
    const t = await openRequest();
    t.clock.set("2026-03-13T03:00:00.000Z");
    const res = await t.submit("s1", "chegou atrasado");
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "awaiting_brand_review", current_version: 2, content: "chegou atrasado" });
    const { body } = await t.history("s1");
    expect(body.timeline[1]).toMatchObject({ type: "changes_requested", status: "answered_late" });
    expect(body.timeline[2]).toMatchObject({ type: "version_submitted", version: 2, answers_change_request: 1, late: true });
  });

  it("depois de atrasar, a marca ainda pode aprovar ou pedir novos ajustes com prazo novo", async () => {
    const t = await openRequest();
    t.clock.set("2026-03-20T12:00:00.000Z");
    await t.submit("s1");
    const next = await t.requestChanges("s1", { version: 2, reason: "mais uma", due_date: "2026-03-25" });
    expect(next.status).toBe(201);
    expect(next.body.open_change_request).toMatchObject({ number: 2, overdue: false });
  });
});
