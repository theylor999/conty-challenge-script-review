import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

const changes = { version: 1, reason: "Motivo", due_date: "2026-03-20" };

describe("quem pode o quê", () => {
  it("sem x-actor ou com valor desconhecido -> 401 actor_invalid", async () => {
    const t = setup();
    await t.create();
    for (const actor of [undefined, "admin", "BRAND", ""]) {
      const res = await t.call("GET", "/scripts/s1", actor);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("actor_invalid");
    }
  });

  it("só a criadora cria roteiro e envia versão", async () => {
    const t = setup();
    const create = await t.call("POST", "/scripts", "brand", { title: "x", content: "y" });
    expect(create.status).toBe(403);
    expect(create.body.error.code).toBe("forbidden_actor");

    await t.create();
    await t.requestChanges("s1", changes);
    const submit = await t.call("POST", "/scripts/s1/versions", "brand", { content: "z" });
    expect(submit.status).toBe(403);
    expect((await t.get("s1")).body.current_version).toBe(1);
  });

  it("só a marca pede ajustes e aprova", async () => {
    const t = setup();
    await t.create();
    const ask = await t.call("POST", "/scripts/s1/change-requests", "creator", changes);
    expect(ask.status).toBe(403);
    const approve = await t.call("POST", "/scripts/s1/approve", "creator", { version: 1 });
    expect(approve.status).toBe(403);
    expect((await t.get("s1")).body.status).toBe("awaiting_brand_review");
  });

  it("permissão é checada antes do estado: criadora aprovando roteiro aprovado recebe 403", async () => {
    const t = setup();
    await t.create();
    await t.approve("s1", 1);
    const res = await t.call("POST", "/scripts/s1/approve", "creator", { version: 1 });
    expect(res.status).toBe(403);
  });

  it("os dois papéis leem estado e histórico", async () => {
    const t = setup();
    await t.create();
    for (const actor of ["brand", "creator"]) {
      expect((await t.get("s1", actor)).status).toBe(200);
      expect((await t.history("s1", actor)).status).toBe(200);
    }
  });

  it("allowed_actions acompanha o estado e o papel", async () => {
    const t = setup();
    await t.create();
    expect((await t.get("s1", "brand")).body.allowed_actions).toEqual(["request_changes", "approve"]);
    expect((await t.get("s1", "creator")).body.allowed_actions).toEqual([]);
    await t.requestChanges("s1", changes);
    expect((await t.get("s1", "brand")).body.allowed_actions).toEqual(["approve"]);
    expect((await t.get("s1", "creator")).body.allowed_actions).toEqual(["submit_version"]);
    await t.submit("s1");
    await t.approve("s1", 2);
    for (const actor of ["brand", "creator"]) expect((await t.get("s1", actor)).body.allowed_actions).toEqual([]);
  });
});
