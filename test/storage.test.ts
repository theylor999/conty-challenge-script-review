import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openStore } from "../src/db.ts";
import { createScript, requestChanges } from "../src/domain/script.ts";
import { fixedClock } from "./fixed-clock.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("store sqlite em arquivo", () => {
  it("versões e pedidos de ajuste sobrevivem a reabrir o banco", () => {
    const dir = mkdtempSync(join(tmpdir(), "script-review-"));
    dirs.push(dir);
    const path = join(dir, "test.db");
    const clock = fixedClock("2026-03-10T15:00:00.000Z");

    const first = openStore(path);
    const script = createScript({ id: "a", title: "T", content: "v1" }, clock);
    first.insert(script);
    first.save(requestChanges(script, { version: 1, reason: "r", dueDate: "2026-03-12" }, clock));

    first.close();
    const second = openStore(path);
    const reopened = second.get("a");
    second.close();
    expect(reopened?.status).toBe("changes_requested");
    expect(reopened?.versions[0]?.content).toBe("v1");
    expect(reopened?.changeRequests[0]).toMatchObject({ reason: "r", dueAt: "2026-03-13T02:59:59.999Z" });
  });

  it("id desconhecido devolve undefined", () => {
    expect(openStore().get("nope")).toBeUndefined();
  });
});
