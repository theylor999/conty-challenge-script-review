import { DatabaseSync } from "node:sqlite";
import type { Script } from "./domain/script.ts";

export interface ScriptStore {
  get(id: string): Script | undefined;
  insert(script: Script): void;
  /** Replaces the stored aggregate. Callers load, change and save without awaiting in between. */
  save(script: Script): void;
  close(): void;
}

/**
 * The aggregate is always read and written whole, so it is stored as one JSON
 * document. node:sqlite is synchronous, which makes load-modify-save atomic
 * inside a single process.
 */
export function openStore(path = ":memory:"): ScriptStore {
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE IF NOT EXISTS scripts (id TEXT PRIMARY KEY, doc TEXT NOT NULL)");
  const get = db.prepare("SELECT doc FROM scripts WHERE id = ?");
  const insert = db.prepare("INSERT INTO scripts (id, doc) VALUES (?, ?)");
  const update = db.prepare("UPDATE scripts SET doc = ? WHERE id = ?");
  return {
    get(id) {
      const row = get.get(id) as { doc: string } | undefined;
      return row ? (JSON.parse(row.doc) as Script) : undefined;
    },
    insert(script) {
      insert.run(script.id, JSON.stringify(script));
    },
    save(script) {
      update.run(JSON.stringify(script), script.id);
    },
    close() {
      db.close();
    },
  };
}
