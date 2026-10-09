import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

describe("fluxo completo", () => {
  it("criação -> ajustes -> nova versão -> aprovação, com estado explícito em cada passo", async () => {
    const t = setup("2026-03-10T15:00:00.000Z");

    const created = await t.create("Abertura com o produto");
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      id: "s1",
      status: "awaiting_brand_review",
      awaiting: "brand",
      current_version: 1,
      content: "Abertura com o produto",
      open_change_request: null,
      timezone: "America/Sao_Paulo",
    });
    // allowed_actions é calculado para quem pergunta
    expect(created.body.allowed_actions).toEqual([]);
    expect((await t.get("s1", "brand")).body.allowed_actions).toEqual(["request_changes", "approve"]);

    const changes = await t.requestChanges("s1", { version: 1, reason: "  Falta citar o cupom  ", due_date: "2026-03-12" });
    expect(changes.status).toBe(201);
    expect(changes.body).toMatchObject({
      status: "changes_requested",
      awaiting: "creator",
      current_version: 1,
      allowed_actions: ["approve"],
      open_change_request: {
        number: 1,
        version: 1,
        reason: "Falta citar o cupom",
        due_date: "2026-03-12",
        due_at: "2026-03-13T02:59:59.999Z",
        overdue: false,
      },
    });
    expect((await t.get("s1", "creator")).body.allowed_actions).toEqual(["submit_version"]);

    t.clock.set("2026-03-11T12:00:00.000Z");
    const v2 = await t.submit("s1", "Abertura com o produto e o cupom");
    expect(v2.status).toBe(201);
    expect(v2.body).toMatchObject({
      status: "awaiting_brand_review",
      awaiting: "brand",
      current_version: 2,
      content: "Abertura com o produto e o cupom",
      open_change_request: null,
    });

    t.clock.set("2026-03-11T18:00:00.000Z");
    const approved = await t.approve("s1", 2);
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({
      status: "approved",
      awaiting: "none",
      current_version: 2,
      approved_version: 2,
      approved_at: "2026-03-11T18:00:00.000Z",
      allowed_actions: [],
    });
  });

  it("várias rodadas: cada pedido mira a versão atual e o número do pedido cresce", async () => {
    const t = setup();
    await t.create();
    await t.requestChanges("s1", { version: 1, reason: "a", due_date: "2026-03-20" });
    await t.submit("s1", "v2");
    const second = await t.requestChanges("s1", { version: 2, reason: "b", due_date: "2026-03-21" });
    expect(second.status).toBe(201);
    expect(second.body.open_change_request).toMatchObject({ number: 2, version: 2 });
    await t.submit("s1", "v3");
    expect((await t.approve("s1", 3)).body.approved_version).toBe(3);
  });

  it("histórico: versões antigas continuam legíveis e a linha do tempo segue a ordem causal", async () => {
    const t = setup("2026-03-10T15:00:00.000Z");
    await t.create("texto v1");
    await t.requestChanges("s1", { version: 1, reason: "encurtar", due_date: "2026-03-12" });
    await t.submit("s1", "texto v2");
    await t.approve("s1", 2); // mesmo instante em todos os eventos: a ordem não pode depender do relógio

    const { status, body } = await t.history("s1");
    expect(status).toBe(200);
    expect(body.versions.map((v) => [v.number, v.content])).toEqual([
      [1, "texto v1"],
      [2, "texto v2"],
    ]);
    expect(body.timeline.map((e) => [e.type, e.version, e.actor])).toEqual([
      ["version_submitted", 1, "creator"],
      ["changes_requested", 1, "brand"],
      ["version_submitted", 2, "creator"],
      ["approved", 2, "brand"],
    ]);
    expect(body.timeline[1]).toMatchObject({
      reason: "encurtar",
      due_date: "2026-03-12",
      due_at: "2026-03-13T02:59:59.999Z",
      status: "answered",
    });
    expect(body.timeline[2]).toMatchObject({ answers_change_request: 1, late: false });
  });

  it("o texto de uma versão não muda quando chega outra", async () => {
    const t = setup();
    await t.create("original");
    await t.requestChanges("s1", { version: 1, reason: "x", due_date: "2026-03-20" });
    await t.submit("s1", "revisado");
    const { body } = await t.history("s1", "creator");
    expect(body.versions[0]?.content).toBe("original");
    expect(body.script.content).toBe("revisado");
  });
});

describe("estados e conflitos", () => {
  it("pedir ajustes duas vezes na mesma versão -> 409 changes_already_requested", async () => {
    const t = setup();
    await t.create();
    await t.requestChanges("s1", { version: 1, reason: "a", due_date: "2026-03-20" });
    const again = await t.requestChanges("s1", { version: 1, reason: "b", due_date: "2026-03-21" });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("changes_already_requested");
  });

  it("aprovar a versão atual com ajustes em aberto é permitido e fecha o pedido (closed_by_approval)", async () => {
    const t = setup();
    await t.create();
    await t.requestChanges("s1", { version: 1, reason: "a", due_date: "2026-03-20" });
    const res = await t.approve("s1", 1);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "approved", awaiting: "none", open_change_request: null, approved_version: 1 });
    const { body } = await t.history("s1");
    expect(body.timeline.map((e) => [e.type, e.version])).toEqual([
      ["version_submitted", 1],
      ["changes_requested", 1],
      ["approved", 1],
    ]);
    expect(body.timeline[1]?.status).toBe("closed_by_approval");
    expect((await t.submit("s1")).body.error.code).toBe("script_approved");
  });

  it("enviar versão sem pedido de ajustes -> 409 not_awaiting_creator", async () => {
    const t = setup();
    await t.create();
    const res = await t.submit("s1");
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("not_awaiting_creator");
  });

  it("versão desatualizada -> 409 stale_version (aprovar e pedir ajustes)", async () => {
    const t = setup();
    await t.create();
    await t.requestChanges("s1", { version: 1, reason: "a", due_date: "2026-03-20" });
    await t.submit("s1", "v2");

    const staleApprove = await t.approve("s1", 1);
    expect(staleApprove.status).toBe(409);
    expect(staleApprove.body.error.code).toBe("stale_version");
    expect(staleApprove.body.error.message).toContain("atual é a 2");

    const staleChanges = await t.requestChanges("s1", { version: 1, reason: "a", due_date: "2026-03-20" });
    expect(staleChanges.status).toBe(409);
    expect(staleChanges.body.error.code).toBe("stale_version");

    const future = await t.approve("s1", 3);
    expect(future.body.error.code).toBe("stale_version");
    expect((await t.get("s1")).body.status).toBe("awaiting_brand_review");
  });

  it("aprovado trava: nova versão, pedido de ajustes e segunda aprovação -> 409 script_approved", async () => {
    const t = setup();
    await t.create();
    await t.approve("s1", 1);

    for (const res of [
      await t.submit("s1", "tarde demais"),
      await t.requestChanges("s1", { version: 1, reason: "mudei de ideia", due_date: "2026-03-20" }),
      await t.approve("s1", 1),
    ]) {
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("script_approved");
    }
    const { body } = await t.history("s1");
    expect(body.versions).toHaveLength(1);
    expect(body.timeline.map((e) => e.type)).toEqual(["version_submitted", "approved"]);
    expect(body.script).toMatchObject({ status: "approved", awaiting: "none", allowed_actions: [] });
  });

  it("aprovado trava antes da validação: corpo inválido também recebe 409", async () => {
    const t = setup();
    await t.create();
    await t.approve("s1", 1);
    const calls = [
      await t.call("POST", "/scripts/s1/versions", "creator", {}),
      await t.call("POST", "/scripts/s1/change-requests", "brand", {}),
      await t.call("POST", "/scripts/s1/approve", "brand", {}),
    ];
    for (const res of calls) expect(res.body.error.code).toBe("script_approved");
  });

  it("falha de validação ou de estado não altera o roteiro", async () => {
    const t = setup();
    await t.create();
    await t.requestChanges("s1", { version: 1, reason: "", due_date: "2026-03-20" });
    await t.requestChanges("s1", { version: 1, reason: "ok", due_date: "2026-03-01" });
    const after = (await t.history("s1")).body;
    expect(after.script.status).toBe("awaiting_brand_review");
    expect(after.timeline).toHaveLength(1);
  });
});
