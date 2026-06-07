// ── SQLite-backed checkpoint persistence for LangGraph agent ──

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

import { BaseCheckpointSaver, copyCheckpoint, getCheckpointId, WRITES_IDX_MAP } from "@langchain/langgraph-checkpoint";

// Cannot be imported directly from the package (no subpath export)
const TASKS = "__pregel_tasks";

let _checkpointer: any = null;

export function getCheckpointer(): any {
  if (_checkpointer) return _checkpointer;

  try {
    const Database = require("better-sqlite3");
    const path = require("node:path");
    const dbPath = path.join(process.cwd(), "data", "gaoshi.db");
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");

    // Create checkpoint tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        thread_id TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL DEFAULT '',
        checkpoint_id TEXT NOT NULL,
        parent_checkpoint_id TEXT,
        checkpoint TEXT NOT NULL,
        metadata TEXT NOT NULL,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
      );
      CREATE TABLE IF NOT EXISTS checkpoint_writes (
        thread_id TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL DEFAULT '',
        checkpoint_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        idx INTEGER NOT NULL,
        channel TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
      );
    `);

    _checkpointer = new SQLiteSaver(db);

    // Attach deleteThread helper
    (_checkpointer as any).deleteThread = (threadId: string) => {
      db.prepare("DELETE FROM checkpoints WHERE thread_id = ?").run(threadId);
      db.prepare("DELETE FROM checkpoint_writes WHERE thread_id = ?").run(threadId);
    };

  } catch (err: any) {
    console.error("[gaoshi] SQLiteSaver init failed, falling back to MemorySaver:", err.message);
    const { MemorySaver } = require("@langchain/langgraph-checkpoint");
    _checkpointer = new MemorySaver();
  }

  return _checkpointer;
}

// ── SQLiteSaver ──

class SQLiteSaver extends BaseCheckpointSaver {
  private db: any;

  constructor(db: any) {
    super();
    this.db = db;
  }

  async getTuple(config: any) {
    const thread_id = config.configurable?.thread_id;
    const checkpoint_ns = config.configurable?.checkpoint_ns ?? "";
    let checkpoint_id = getCheckpointId(config);

    if (checkpoint_id) {
      const row = this.db.prepare(
        "SELECT checkpoint, metadata, parent_checkpoint_id FROM checkpoints WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?"
      ).get(thread_id, checkpoint_ns, checkpoint_id) as any;

      if (row) {
        return this._buildTuple(thread_id, checkpoint_ns, checkpoint_id, row.checkpoint, row.metadata, row.parent_checkpoint_id);
      }
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

    return Promise.all(rows.map(async (r: any) => {
      return this.serde.loadsTyped("json", r.value);
    }));
  }

  async put(config: any, checkpoint: any, metadata: any) {
    const preparedCheckpoint = copyCheckpoint(checkpoint);
    delete (preparedCheckpoint as any).pending_sends;

    const thread_id = config.configurable?.thread_id;
    const checkpoint_ns = config.configurable?.checkpoint_ns ?? "";

    if (!thread_id) {
      throw new Error("Missing thread_id in configurable");
    }

    const [, serializedCheckpoint] = this.serde.dumpsTyped(preparedCheckpoint);
    const [, serializedMetadata] = this.serde.dumpsTyped(metadata);

    this.db.prepare(
      "INSERT OR REPLACE INTO checkpoints (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, checkpoint, metadata) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(thread_id, checkpoint_ns, checkpoint.id, config.configurable?.checkpoint_id ?? null, serializedCheckpoint, serializedMetadata);

    return {
      configurable: { thread_id, checkpoint_ns, checkpoint_id: checkpoint.id },
    };
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
