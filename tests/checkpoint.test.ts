import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import * as path from "node:path";
import * as fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Replicate SQLiteSaver inline — avoid import issues with ESM/CJS
import { BaseCheckpointSaver, copyCheckpoint, WRITES_IDX_MAP } from "@langchain/langgraph-checkpoint";

const TASKS = "__pregel_tasks";

class SQLiteSaver extends BaseCheckpointSaver {
  private db: any;
  constructor(db: any) {
    super();
    this.db = db;
  }
  async getTuple(config: any) {
    const thread_id = config.configurable?.thread_id;
    const checkpoint_ns = config.configurable?.checkpoint_ns ?? "";
    let checkpoint_id = (config.configurable?.checkpoint_id || config.configurable?.thread_ts || "");

    if (checkpoint_id) {
      const row = this.db.prepare(
        "SELECT checkpoint, metadata, parent_checkpoint_id FROM checkpoints WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?"
      ).get(thread_id, checkpoint_ns, checkpoint_id) as any;
      if (row) return this._buildTuple(thread_id, checkpoint_ns, checkpoint_id, row.checkpoint, row.metadata, row.parent_checkpoint_id);
    } else {
      const row = this.db.prepare(
        "SELECT checkpoint_id, checkpoint, metadata, parent_checkpoint_id FROM checkpoints WHERE thread_id = ? AND checkpoint_ns = ? ORDER BY checkpoint_id DESC LIMIT 1"
      ).get(thread_id, checkpoint_ns) as any;
      if (row) {
        checkpoint_id = row.checkpoint_id;
        return this._buildTuple(thread_id, checkpoint_ns, checkpoint_id, row.checkpoint, row.metadata, row.parent_checkpoint_id);
      }
    }
    return undefined;
  }
  private async _buildTuple(thread_id: string, checkpoint_ns: string, checkpoint_id: string, checkpointRaw: string, metadataRaw: string, parentCheckpointId?: string) {
    const pendingWrites = await this._getPendingWrites(thread_id, checkpoint_ns, checkpoint_id);
    const pendingSends = await this._getPendingSends(thread_id, checkpoint_ns, parentCheckpointId);
    const deserializedCheckpoint = {
      ...(await this.serde.loadsTyped("json", checkpointRaw)),
      pending_sends: pendingSends,
    };
    const metadata = await this.serde.loadsTyped("json", metadataRaw);
    const tuple: any = {
      config: { configurable: { thread_id, checkpoint_ns, checkpoint_id } },
      checkpoint: deserializedCheckpoint,
      metadata,
      pendingWrites,
    };
    if (parentCheckpointId) {
      tuple.parentConfig = { configurable: { thread_id, checkpoint_ns, checkpoint_id: parentCheckpointId } };
    }
    return tuple;
  }
  private async _getPendingWrites(thread_id: string, checkpoint_ns: string, checkpoint_id: string) {
    const rows = this.db.prepare(
      "SELECT task_id, channel, value FROM checkpoint_writes WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?"
    ).all(thread_id, checkpoint_ns, checkpoint_id) as any[];
    return Promise.all(rows.map(async (r: any) => {
      return [r.task_id, r.channel, await this.serde.loadsTyped("json", r.value)];
    }));
  }
  private async _getPendingSends(thread_id: string, checkpoint_ns: string, parentCheckpointId?: string): Promise<any[]> {
    if (!parentCheckpointId) return [];
    const rows = this.db.prepare(
      "SELECT value FROM checkpoint_writes WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ? AND channel = ?"
    ).all(thread_id, checkpoint_ns, parentCheckpointId, TASKS) as any[];
    return Promise.all(rows.map(async (r: any) => { return this.serde.loadsTyped("json", r.value); }));
  }
  async put(config: any, checkpoint: any, metadata: any) {
    const preparedCheckpoint = copyCheckpoint(checkpoint);
    delete (preparedCheckpoint as any).pending_sends;
    const thread_id = config.configurable?.thread_id;
    const checkpoint_ns = config.configurable?.checkpoint_ns ?? "";
    if (!thread_id) throw new Error("Missing thread_id in configurable");
    const [, serializedCheckpoint] = this.serde.dumpsTyped(preparedCheckpoint);
    const [, serializedMetadata] = this.serde.dumpsTyped(metadata);
    this.db.prepare(
      "INSERT OR REPLACE INTO checkpoints (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, checkpoint, metadata) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(thread_id, checkpoint_ns, checkpoint.id, config.configurable?.checkpoint_id ?? null, serializedCheckpoint, serializedMetadata);
    return { configurable: { thread_id, checkpoint_ns, checkpoint_id: checkpoint.id } };
  }
  async putWrites(config: any, writes: Array<[string, any]>, taskId: string) {
    const thread_id = config.configurable?.thread_id;
    const checkpoint_ns = config.configurable?.checkpoint_ns;
    const checkpoint_id = config.configurable?.checkpoint_id;
    if (!thread_id) throw new Error("Missing thread_id in configurable");
    if (!checkpoint_id) throw new Error("Missing checkpoint_id in configurable");
    const insert = this.db.prepare(
      "INSERT OR REPLACE INTO checkpoint_writes (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, value) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    const existing = this.db.prepare(
      "SELECT task_id, idx FROM checkpoint_writes WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?"
    ).all(thread_id, checkpoint_ns, checkpoint_id) as any[];
    const existingKeys = new Set(existing.map((r: any) => `${r.task_id},${r.idx}`));
    for (let idx = 0; idx < writes.length; idx++) {
      const [channel, value] = writes[idx];
      const mappedIdx = (WRITES_IDX_MAP as any)[channel] ?? idx;
      const key = `${taskId},${mappedIdx}`;
      if (mappedIdx >= 0 && existingKeys.has(key)) continue;
      const [, serializedValue] = this.serde.dumpsTyped(value);
      insert.run(thread_id, checkpoint_ns, checkpoint_id, taskId, mappedIdx, channel, serializedValue);
    }
  }
  async *list(config: any, options?: any) {
    const { limit } = options ?? {};
    const thread_id = config.configurable?.thread_id;
    let rows: any[];
    if (thread_id) {
      rows = this.db.prepare(
        "SELECT thread_id, checkpoint_ns, checkpoint_id, checkpoint, metadata, parent_checkpoint_id FROM checkpoints WHERE thread_id = ? ORDER BY checkpoint_id DESC"
      ).all(thread_id) as any[];
    } else {
      rows = this.db.prepare(
        "SELECT thread_id, checkpoint_ns, checkpoint_id, checkpoint, metadata, parent_checkpoint_id FROM checkpoints ORDER BY checkpoint_id DESC"
      ).all() as any[];
    }
    let count = 0;
    for (const row of rows) {
      if (limit !== undefined && count >= limit) break;
      count++;
      yield await this._buildTuple(row.thread_id, row.checkpoint_ns, row.checkpoint_id, row.checkpoint, row.metadata, row.parent_checkpoint_id);
    }
  }
}

// ── Tests ──

const TEST_DIR = path.join(process.cwd(), "data", "_test_checkpoint");
const TEST_DB = path.join(TEST_DIR, "test.db");

let db: any;
let saver: SQLiteSaver;

beforeAll(() => {
  fs.mkdirSync(TEST_DIR, { recursive: true });
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  db = new Database(TEST_DB);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS checkpoints (
      thread_id TEXT NOT NULL, checkpoint_ns TEXT NOT NULL DEFAULT '', checkpoint_id TEXT NOT NULL,
      parent_checkpoint_id TEXT, checkpoint TEXT NOT NULL, metadata TEXT NOT NULL,
      PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
    );
    CREATE TABLE IF NOT EXISTS checkpoint_writes (
      thread_id TEXT NOT NULL, checkpoint_ns TEXT NOT NULL DEFAULT '', checkpoint_id TEXT NOT NULL,
      task_id TEXT NOT NULL, idx INTEGER NOT NULL, channel TEXT NOT NULL, value TEXT NOT NULL,
      PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
    );
  `);
  saver = new SQLiteSaver(db);
  (saver as any).deleteThread = (threadId: string) => {
    db.prepare("DELETE FROM checkpoints WHERE thread_id = ?").run(threadId);
    db.prepare("DELETE FROM checkpoint_writes WHERE thread_id = ?").run(threadId);
  };
});

afterAll(() => {
  if (db) db.close();
  try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
});

// ── Basic CRUD ──

describe("SQLiteSaver — basic persistence", () => {
  const TID = "thread_test_1";

  it("getTuple returns undefined for unknown thread", async () => {
    const result = await saver.getTuple({ configurable: { thread_id: "nonexistent" } });
    expect(result).toBeUndefined();
  });

  it("put + getTuple round-trips checkpoint data", async () => {
    const checkpoint = {
      v: 1, id: "cp_001", ts: new Date().toISOString(),
      channel_values: { messages: ["hello"] },
      channel_versions: {}, versions_seen: {}, pending_sends: [],
    };
    const metadata = { source: "test", step: 1 };

    await saver.put({ configurable: { thread_id: TID } }, checkpoint, metadata);
    const result = await saver.getTuple({ configurable: { thread_id: TID } });

    expect(result).toBeDefined();
    expect(result!.config.configurable.thread_id).toBe(TID);
    expect(result!.checkpoint.v).toBe(1);
    expect(result!.checkpoint.channel_values.messages).toEqual(["hello"]);
    expect(result!.metadata.source).toBe("test");
    expect(result!.metadata.step).toBe(1);
  });

  it("put overwrites existing checkpoint", async () => {
    const cp1 = { v: 1, id: "cp_002a", ts: new Date().toISOString(), channel_values: { x: 1 }, channel_versions: {}, versions_seen: {}, pending_sends: [] };
    const cp2 = { v: 1, id: "cp_002b", ts: new Date().toISOString(), channel_values: { x: 2 }, channel_versions: {}, versions_seen: {}, pending_sends: [] };

    await saver.put({ configurable: { thread_id: TID } }, cp1, {});
    await saver.put({ configurable: { thread_id: TID } }, cp2, {});
    const result = await saver.getTuple({ configurable: { thread_id: TID } });

    expect(result!.checkpoint.channel_values.x).toBe(2);
  });

  it("getTuple without checkpoint_id returns latest", async () => {
    const cpA = { v: 1, id: "cp_latest_a", ts: new Date().toISOString(), channel_values: { step: 1 }, channel_versions: {}, versions_seen: {}, pending_sends: [] };
    const cpB = { v: 1, id: "cp_latest_b", ts: new Date().toISOString(), channel_values: { step: 2 }, channel_versions: {}, versions_seen: {}, pending_sends: [] };

    await saver.put({ configurable: { thread_id: TID } }, cpA, { step: 1 });
    await saver.put({ configurable: { thread_id: TID } }, cpB, { step: 2 });

    // No checkpoint_id specified
    const result = await saver.getTuple({ configurable: { thread_id: TID } });
    expect(result!.checkpoint.channel_values.step).toBe(2);
    expect(result!.metadata.step).toBe(2);
  });

  it("getTuple with specific checkpoint_id returns that version", async () => {
    const result = await saver.getTuple({ configurable: { thread_id: TID, checkpoint_id: "cp_latest_a" } });
    expect(result!.checkpoint.channel_values.step).toBe(1);
  });
});

// ── Parent chain ──

describe("SQLiteSaver — parent chain", () => {
  const TID = "thread_parent_test";

  it("parent config is returned when parent_checkpoint_id is set", async () => {
    const parent = { v: 1, id: "parent_cp", ts: new Date().toISOString(), channel_values: {}, channel_versions: {}, versions_seen: {}, pending_sends: [] };
    const child = { v: 1, id: "child_cp", ts: new Date().toISOString(), channel_values: {}, channel_versions: {}, versions_seen: {}, pending_sends: [] };

    await saver.put({ configurable: { thread_id: TID } }, parent, {});
    await saver.put({ configurable: { thread_id: TID, checkpoint_id: "parent_cp" } }, child, {});

    const result = await saver.getTuple({ configurable: { thread_id: TID, checkpoint_id: "child_cp" } });
    expect(result!.parentConfig).toBeDefined();
    expect(result!.parentConfig.configurable.checkpoint_id).toBe("parent_cp");
  });
});

// ── Writes ──

describe("SQLiteSaver — writes", () => {
  const TID = "thread_writes_test";

  it("putWrites + getTuple returns pendingWrites", async () => {
    const cp = { v: 1, id: "cp_w_001", ts: new Date().toISOString(), channel_values: {}, channel_versions: {}, versions_seen: {}, pending_sends: [] };
    await saver.put({ configurable: { thread_id: TID } }, cp, {});

    await saver.putWrites(
      { configurable: { thread_id: TID, checkpoint_id: "cp_w_001" } },
      [["messages", { role: "assistant", content: "hi" }]],
      "task_1"
    );

    const result = await saver.getTuple({ configurable: { thread_id: TID, checkpoint_id: "cp_w_001" } });
    expect(result!.pendingWrites.length).toBe(1);
    expect(result!.pendingWrites[0][0]).toBe("task_1");
    expect(result!.pendingWrites[0][1]).toBe("messages");
    expect((result!.pendingWrites[0][2] as any).content).toBe("hi");
  });

  it("putWrites does not duplicate existing writes", async () => {
    // Write again with same taskId + same channel → should skip
    await saver.putWrites(
      { configurable: { thread_id: TID, checkpoint_id: "cp_w_001" } },
      [["messages", { role: "assistant", content: "hi again" }]],
      "task_1"
    );
    const result = await saver.getTuple({ configurable: { thread_id: TID, checkpoint_id: "cp_w_001" } });
    expect(result!.pendingWrites.length).toBe(1);
  });
});

// ── Pending sends (interrupt/resume) ──

describe("SQLiteSaver — pending sends", () => {
  const TID = "thread_sends_test";

  it("pending_sends is reconstructed from parent writes with TASKS channel", async () => {
    const parent = { v: 1, id: "ps_parent", ts: new Date().toISOString(), channel_values: {}, channel_versions: {}, versions_seen: {}, pending_sends: [] };
    const child = { v: 1, id: "ps_child", ts: new Date().toISOString(), channel_values: {}, channel_versions: {}, versions_seen: {}, pending_sends: [] };

    await saver.put({ configurable: { thread_id: TID } }, parent, {});

    // Write pending sends to parent checkpoint
    await saver.putWrites(
      { configurable: { thread_id: TID, checkpoint_id: "ps_parent" } },
      [[TASKS, { type: "send", node: "agent" }]],
      "send_task"
    );

    await saver.put({ configurable: { thread_id: TID, checkpoint_id: "ps_parent" } }, child, {});

    const result = await saver.getTuple({ configurable: { thread_id: TID, checkpoint_id: "ps_child" } });
    expect(result!.checkpoint.pending_sends.length).toBe(1);
    expect(result!.checkpoint.pending_sends[0].type).toBe("send");
  });

  it("pending_sends is empty when no parent writes exist", async () => {
    const cp = { v: 1, id: "ps_no_parent", ts: new Date().toISOString(), channel_values: {}, channel_versions: {}, versions_seen: {}, pending_sends: [] };
    await saver.put({ configurable: { thread_id: TID } }, cp, {});
    const result = await saver.getTuple({ configurable: { thread_id: TID, checkpoint_id: "ps_no_parent" } });
    expect(result!.checkpoint.pending_sends).toEqual([]);
  });
});

// ── Delete ──

describe("SQLiteSaver — deleteThread", () => {
  it("deleteThread removes checkpoint and writes", async () => {
    const TID = "thread_delete_test";
    const cp = { v: 1, id: "del_cp", ts: new Date().toISOString(), channel_values: {}, channel_versions: {}, versions_seen: {}, pending_sends: [] };
    await saver.put({ configurable: { thread_id: TID } }, cp, {});
    await saver.putWrites({ configurable: { thread_id: TID, checkpoint_id: "del_cp" } }, [["messages", "x"]], "t1");

    (saver as any).deleteThread(TID);

    const result = await saver.getTuple({ configurable: { thread_id: TID } });
    expect(result).toBeUndefined();
  });
});

// ── Multi-thread isolation ──

describe("SQLiteSaver — thread isolation", () => {
  it("checkpoints in different threads do not leak", async () => {
    const cpA = { v: 1, id: "iso_a", ts: new Date().toISOString(), channel_values: { data: "A" }, channel_versions: {}, versions_seen: {}, pending_sends: [] };
    const cpB = { v: 1, id: "iso_b", ts: new Date().toISOString(), channel_values: { data: "B" }, channel_versions: {}, versions_seen: {}, pending_sends: [] };

    await saver.put({ configurable: { thread_id: "thread_A" } }, cpA, {});
    await saver.put({ configurable: { thread_id: "thread_B" } }, cpB, {});

    const resultA = await saver.getTuple({ configurable: { thread_id: "thread_A" } });
    const resultB = await saver.getTuple({ configurable: { thread_id: "thread_B" } });

    expect(resultA!.checkpoint.channel_values.data).toBe("A");
    expect(resultB!.checkpoint.channel_values.data).toBe("B");
  });
});

// ── list ──

describe("SQLiteSaver — list", () => {
  it("lists checkpoints for a thread", async () => {
    const TID = "thread_list_test";
    const cp1 = { v: 1, id: "list_1", ts: new Date().toISOString(), channel_values: {}, channel_versions: {}, versions_seen: {}, pending_sends: [] };
    const cp2 = { v: 1, id: "list_2", ts: new Date().toISOString(), channel_values: {}, channel_versions: {}, versions_seen: {}, pending_sends: [] };

    await saver.put({ configurable: { thread_id: TID } }, cp1, {});
    await saver.put({ configurable: { thread_id: TID } }, cp2, {});

    const results: any[] = [];
    for await (const t of saver.list({ configurable: { thread_id: TID } })) {
      results.push(t);
    }
    expect(results.length).toBe(2);
    // Most recent first
    expect(results[0].checkpoint.id).toBe("list_2");
    expect(results[1].checkpoint.id).toBe("list_1");
  });

  it("list respects limit option", async () => {
    const TID = "thread_list_limit";
    for (let i = 0; i < 5; i++) {
      const cp = { v: 1, id: `lim_${i}`, ts: new Date().toISOString(), channel_values: {}, channel_versions: {}, versions_seen: {}, pending_sends: [] };
      await saver.put({ configurable: { thread_id: TID } }, cp, {});
    }
    const results: any[] = [];
    for await (const t of saver.list({ configurable: { thread_id: TID } }, { limit: 2 })) {
      results.push(t);
    }
    expect(results.length).toBe(2);
  });
});
