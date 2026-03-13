#!/usr/bin/env node
// memory-mcp — Dual-store for Personal Adas
// Long-term memory (permanent) + Ephemeral context (short-lived operational state)
// SQLite-backed via DATA_DIR (ADAS platform provides per-connector per-tenant storage)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { z } from "zod";

// ─── Database Setup ───

const DATA_DIR = process.env.DATA_DIR || "/tmp/memory-mcp-data";
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, "memory.db");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Create schema — long-term memory + ephemeral context
// Migration: if memories table exists with old CHECK constraint (missing 'rule', 'user_model'),
// recreate it with the updated constraint while preserving data.
const EXPECTED_TYPES = "'preference','fact','instruction','pattern','rule','user_model'";

const tableExists = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='memories'"
).get();

if (tableExists) {
  // Check if existing table supports 'rule' type by trying a dummy insert in a savepoint
  try {
    db.exec("SAVEPOINT migration_check");
    db.exec("INSERT INTO memories (type, content) VALUES ('rule', '__migration_test__')");
    db.exec("ROLLBACK TO migration_check");
    db.exec("RELEASE migration_check");
    // Table already supports 'rule' type — no migration needed
  } catch (e) {
    if (e.message && e.message.includes("CHECK constraint failed")) {
      // Need to migrate: recreate table with updated CHECK constraint
      console.error("[memory-mcp] Migrating memories table to support 'rule' and 'user_model' types...");
      db.exec("RELEASE migration_check");
      db.exec(`
        ALTER TABLE memories RENAME TO memories_old;
        CREATE TABLE memories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT NOT NULL CHECK(type IN (${EXPECTED_TYPES})),
          content TEXT NOT NULL,
          tags TEXT DEFAULT '[]',
          context TEXT DEFAULT '',
          source TEXT DEFAULT 'user',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        INSERT INTO memories (id, type, content, tags, context, source, created_at, updated_at)
          SELECT id, type, content, tags, context, source, created_at, updated_at FROM memories_old;
        DROP TABLE memories_old;
      `);
      console.error("[memory-mcp] Migration complete.");
    } else {
      db.exec("ROLLBACK TO migration_check");
      db.exec("RELEASE migration_check");
      throw e;
    }
  }
} else {
  // Fresh database — create tables
  db.exec(`
    CREATE TABLE memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN (${EXPECTED_TYPES})),
      content TEXT NOT NULL,
      tags TEXT DEFAULT '[]',
      context TEXT DEFAULT '',
      source TEXT DEFAULT 'user',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);

  CREATE TABLE IF NOT EXISTS ephemeral_context (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK(type IN ('situation','plan')),
    data TEXT NOT NULL,
    status TEXT DEFAULT 'active' CHECK(status IN ('active','resolved','expired','abandoned')),
    created_at TEXT DEFAULT (datetime('now')),
    resolved_at TEXT,
    expires_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_context_type ON ephemeral_context(type);
  CREATE INDEX IF NOT EXISTS idx_context_status ON ephemeral_context(status);
`);

// ─── Prepared Statements: Long-term Memory ───

const insertMemory = db.prepare(`
  INSERT INTO memories (type, content, tags, context, source)
  VALUES (@type, @content, @tags, @context, @source)
`);

const updateMemory = db.prepare(`
  UPDATE memories SET content = @content, tags = @tags, context = @context,
    updated_at = datetime('now') WHERE id = @id
`);

const deleteMemory = db.prepare(`DELETE FROM memories WHERE id = @id`);

const getById = db.prepare(`SELECT * FROM memories WHERE id = @id`);

const listByType = db.prepare(`
  SELECT * FROM memories WHERE type = @type ORDER BY updated_at DESC LIMIT @limit OFFSET @offset
`);

const listAll = db.prepare(`
  SELECT * FROM memories ORDER BY updated_at DESC LIMIT @limit OFFSET @offset
`);

const searchMemories = db.prepare(`
  SELECT * FROM memories
  WHERE (content LIKE @query OR tags LIKE @query)
  ORDER BY updated_at DESC LIMIT @limit
`);

const searchByType = db.prepare(`
  SELECT * FROM memories
  WHERE type = @type AND (content LIKE @query OR tags LIKE @query)
  ORDER BY updated_at DESC LIMIT @limit
`);

const countAll = db.prepare(`SELECT COUNT(*) as total FROM memories`);
const countByType = db.prepare(`SELECT COUNT(*) as total FROM memories WHERE type = @type`);
const listAllRules = db.prepare(`SELECT * FROM memories WHERE type = 'rule' ORDER BY updated_at DESC`);

// ─── Prepared Statements: Ephemeral Context ───

const insertContext = db.prepare(`
  INSERT INTO ephemeral_context (type, data, status, expires_at)
  VALUES (@type, @data, 'active', @expires_at)
`);

const getContextById = db.prepare(`SELECT * FROM ephemeral_context WHERE id = @id`);

const listActiveContext = db.prepare(`
  SELECT * FROM ephemeral_context WHERE status = 'active' ORDER BY created_at DESC LIMIT @limit
`);

const listActiveByType = db.prepare(`
  SELECT * FROM ephemeral_context WHERE type = @type AND status = 'active' ORDER BY created_at DESC LIMIT @limit
`);

const resolveContext = db.prepare(`
  UPDATE ephemeral_context SET status = @status, resolved_at = datetime('now') WHERE id = @id
`);

const clearExpiredContext = db.prepare(`
  UPDATE ephemeral_context SET status = 'expired', resolved_at = datetime('now')
  WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < datetime('now')
`);

const clearAllActiveContext = db.prepare(`
  UPDATE ephemeral_context SET status = 'resolved', resolved_at = datetime('now')
  WHERE status = 'active'
`);

const clearActiveByType = db.prepare(`
  UPDATE ephemeral_context SET status = 'resolved', resolved_at = datetime('now')
  WHERE status = 'active' AND type = @type
`);

// ─── Helpers ───

function formatMemory(row) {
  return {
    id: row.id,
    type: row.type,
    content: row.content,
    tags: JSON.parse(row.tags || "[]"),
    context: row.context || "",
    source: row.source,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function formatContext(row) {
  return {
    id: row.id,
    type: row.type,
    data: JSON.parse(row.data),
    status: row.status,
    created_at: row.created_at,
    resolved_at: row.resolved_at,
    expires_at: row.expires_at,
  };
}

function gcExpired() {
  clearExpiredContext.run();
}

// ─── MCP Server ───

const server = new McpServer({
  name: "memory-mcp",
  version: "3.0.0",
});

// ═══════════════════════════════════════════════════
// LONG-TERM MEMORY TOOLS (permanent user knowledge)
// ═══════════════════════════════════════════════════

// Tool: memory.store
server.tool(
  "memory.store",
  "Store a new long-term memory — preference, fact, instruction, pattern, rule, or user_model. " +
  "Use 'preference' for likes/dislikes/rules ('no meetings before 10am'). " +
  "Use 'fact' for personal facts ('wife's name is Sarah', 'allergic to peanuts'). " +
  "Use 'instruction' for standing orders ('always remind me about medications at 8am'). " +
  "Use 'pattern' for learned behavioral patterns. " +
  "Use 'rule' for taught automation rules (created by TeachThis). " +
  "Use 'user_model' for structured user profile data (people, routines, habits).",
  {
    type: z.enum(["preference", "fact", "instruction", "pattern", "rule", "user_model"]).describe(
      "Memory type"
    ),
    content: z.string().describe("The memory content in natural language or JSON for structured types"),
    tags: z.array(z.string()).optional().describe("Tags for categorization (e.g., ['calendar', 'morning', 'meetings'])"),
    context: z.string().optional().describe("Context about when/why this was stored"),
  },
  async ({ type, content, tags, context }) => {
    try {
      const result = insertMemory.run({
        type,
        content,
        tags: JSON.stringify(tags || []),
        context: context || "",
        source: "user",
      });
      const stored = getById.get({ id: result.lastInsertRowid });
      return {
        content: [{ type: "text", text: JSON.stringify({
          ok: true,
          message: `Memory stored successfully`,
          memory: formatMemory(stored),
        }) }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: e.message }) }] };
    }
  }
);

// Tool: memory.recall
server.tool(
  "memory.recall",
  "Recall memories by search query. Searches content and tags. " +
  "Use this when the user asks 'what did I tell you about...', 'do you remember...', " +
  "or when you need to check user preferences before taking action.",
  {
    query: z.string().describe("Search query — matches against memory content and tags"),
    type: z.enum(["preference", "fact", "instruction", "pattern", "rule", "user_model"]).optional().describe(
      "Filter by memory type (optional — omit to search all types)"
    ),
    limit: z.number().optional().describe("Max results to return (default 10)"),
  },
  async ({ query, type, limit }) => {
    try {
      const maxResults = Math.min(limit || 10, 50);
      const searchPattern = `%${query}%`;
      let rows;
      if (type) {
        rows = searchByType.all({ type, query: searchPattern, limit: maxResults });
      } else {
        rows = searchMemories.all({ query: searchPattern, limit: maxResults });
      }
      return {
        content: [{ type: "text", text: JSON.stringify({
          ok: true,
          query,
          type_filter: type || "all",
          count: rows.length,
          memories: rows.map(formatMemory),
        }) }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: e.message }) }] };
    }
  }
);

// Tool: memory.list
server.tool(
  "memory.list",
  "List all stored memories, optionally filtered by type. " +
  "Use this for 'what are my preferences?', 'show all my facts', etc.",
  {
    type: z.enum(["preference", "fact", "instruction", "pattern", "rule", "user_model"]).optional().describe(
      "Filter by type (optional — omit to list all)"
    ),
    limit: z.number().optional().describe("Max results (default 20)"),
    offset: z.number().optional().describe("Offset for pagination (default 0)"),
  },
  async ({ type, limit, offset }) => {
    try {
      const maxResults = Math.min(limit || 20, 100);
      const skip = offset || 0;
      let rows, total;
      if (type) {
        rows = listByType.all({ type, limit: maxResults, offset: skip });
        total = countByType.get({ type }).total;
      } else {
        rows = listAll.all({ limit: maxResults, offset: skip });
        total = countAll.get().total;
      }
      return {
        content: [{ type: "text", text: JSON.stringify({
          ok: true,
          type_filter: type || "all",
          total,
          count: rows.length,
          offset: skip,
          memories: rows.map(formatMemory),
        }) }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: e.message }) }] };
    }
  }
);

// Tool: memory.update
server.tool(
  "memory.update",
  "Update an existing memory by ID. Use when the user corrects or refines a stored memory.",
  {
    id: z.number().describe("Memory ID to update"),
    content: z.string().optional().describe("New content (if changing)"),
    tags: z.array(z.string()).optional().describe("New tags (if changing)"),
    context: z.string().optional().describe("New context (if changing)"),
  },
  async ({ id, content, tags, context }) => {
    try {
      const existing = getById.get({ id });
      if (!existing) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: `Memory #${id} not found` }) }] };
      }
      updateMemory.run({
        id,
        content: content || existing.content,
        tags: tags ? JSON.stringify(tags) : existing.tags,
        context: context !== undefined ? context : existing.context,
      });
      const updated = getById.get({ id });
      return {
        content: [{ type: "text", text: JSON.stringify({
          ok: true,
          message: `Memory #${id} updated`,
          memory: formatMemory(updated),
        }) }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: e.message }) }] };
    }
  }
);

// Tool: memory.delete
server.tool(
  "memory.delete",
  "Delete a memory by ID. Use when the user says 'forget that' or 'remove that preference'.",
  {
    id: z.number().describe("Memory ID to delete"),
  },
  async ({ id }) => {
    try {
      const existing = getById.get({ id });
      if (!existing) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: `Memory #${id} not found` }) }] };
      }
      deleteMemory.run({ id });
      return {
        content: [{ type: "text", text: JSON.stringify({
          ok: true,
          message: `Memory #${id} deleted`,
          deleted: formatMemory(existing),
        }) }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: e.message }) }] };
    }
  }
);

// ═══════════════════════════════════════════════════
// RULE ENGINE TOOLS (taught automation rules)
// ═══════════════════════════════════════════════════

// Tool: memory.rules.match
server.tool(
  "memory.rules.match",
  "Match taught rules against a situation description. Returns active rules ranked by relevance " +
  "(tag overlap with the query). The calling skill should do final semantic matching. " +
  "Use this before routing to check if any user-taught rules apply to the current situation.",
  {
    situation: z.string().describe(
      "Description of the current situation to match against (e.g., 'boss is calling', " +
      "'running late to meeting with Mark', 'morning routine')"
    ),
    limit: z.number().optional().describe("Max rules to return (default 10)"),
  },
  async ({ situation, limit }) => {
    try {
      const maxResults = Math.min(limit || 10, 50);
      const allRules = listAllRules.all();

      // Parse content JSON and filter active rules
      const activeRules = allRules
        .map(row => {
          const formatted = formatMemory(row);
          try {
            formatted.rule = JSON.parse(row.content);
          } catch {
            formatted.rule = null;
          }
          return formatted;
        })
        .filter(r => r.rule && r.rule.active !== false);

      // Score by tag overlap with situation keywords
      const situationWords = situation.toLowerCase().split(/\s+/);
      const scored = activeRules.map(r => {
        const tags = (r.tags || []).map(t => t.toLowerCase());
        const triggerStr = typeof r.rule.trigger === "string" ? r.rule.trigger : JSON.stringify(r.rule.trigger || "");
        const descStr = typeof r.rule.description === "string" ? r.rule.description : JSON.stringify(r.rule.description || "");
        const contentLower = triggerStr.toLowerCase() + " " + descStr.toLowerCase();

        let score = 0;
        for (const word of situationWords) {
          if (tags.some(tag => tag.includes(word) || word.includes(tag))) score += 2;
          if (contentLower.includes(word)) score += 1;
        }
        // Boost by rule confidence
        score *= (r.rule.confidence || 0.5);

        return { ...r, match_score: score };
      });

      // Sort by score descending, then by recency
      scored.sort((a, b) => b.match_score - a.match_score ||
        new Date(b.updated_at) - new Date(a.updated_at));

      const results = scored.slice(0, maxResults);

      return {
        content: [{ type: "text", text: JSON.stringify({
          ok: true,
          situation,
          total_active_rules: activeRules.length,
          matched: results.length,
          rules: results,
        }) }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: e.message }) }] };
    }
  }
);

// Tool: memory.rules.count
server.tool(
  "memory.rules.count",
  "Count total taught rules in memory — active and inactive. Use for status display or to check if any rules exist before matching.",
  {},
  async () => {
    try {
      const total = countByType.get({ type: "rule" }).total;

      // Count active vs inactive by parsing content
      const allRules = listAllRules.all();
      let active = 0, inactive = 0;
      for (const row of allRules) {
        try {
          const rule = JSON.parse(row.content);
          if (rule.active !== false) active++;
          else inactive++;
        } catch {
          inactive++;
        }
      }

      return {
        content: [{ type: "text", text: JSON.stringify({
          ok: true,
          total,
          active,
          inactive,
        }) }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: e.message }) }] };
    }
  }
);

// ═══════════════════════════════════════════════════
// EPHEMERAL CONTEXT TOOLS (short-lived operational state)
// ═══════════════════════════════════════════════════

// Tool: context.store
server.tool(
  "context.store",
  "Store an ephemeral context object — a situation or plan. " +
  "Situations are short-lived: 'running_late', 'meeting_starting', 'family_priority'. " +
  "Plans are active execution plans: steps, status, owning skill. " +
  "Ephemeral context is automatically garbage-collected after expiry or resolution.",
  {
    type: z.enum(["situation", "plan"]).describe("Context type: situation or plan"),
    data: z.string().describe("JSON string of the context object (e.g., situation with type, confidence, priority, context fields)"),
    ttl_minutes: z.number().optional().describe("Time-to-live in minutes (default 30 for situations, 120 for plans). Context expires after this."),
  },
  async ({ type, data, ttl_minutes }) => {
    try {
      // Validate JSON
      const parsed = JSON.parse(data);

      // Default TTL
      const ttl = ttl_minutes || (type === "situation" ? 30 : 120);
      const expiresAt = new Date(Date.now() + ttl * 60 * 1000).toISOString().replace("T", " ").slice(0, 19);

      // GC expired entries first
      gcExpired();

      const result = insertContext.run({
        type,
        data,
        expires_at: expiresAt,
      });

      const stored = getContextById.get({ id: result.lastInsertRowid });
      return {
        content: [{ type: "text", text: JSON.stringify({
          ok: true,
          message: `Context stored (expires in ${ttl} minutes)`,
          context: formatContext(stored),
        }) }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: e.message }) }] };
    }
  }
);

// Tool: context.read
server.tool(
  "context.read",
  "Read active ephemeral context — current situations and plans. " +
  "Use this to check what's happening RIGHT NOW: active situations, running plans. " +
  "Only returns active (non-expired, non-resolved) entries.",
  {
    type: z.enum(["situation", "plan"]).optional().describe("Filter by type (optional — omit to read all active context)"),
    limit: z.number().optional().describe("Max results (default 10)"),
  },
  async ({ type, limit }) => {
    try {
      // GC expired entries first
      gcExpired();

      const maxResults = Math.min(limit || 10, 50);
      let rows;
      if (type) {
        rows = listActiveByType.all({ type, limit: maxResults });
      } else {
        rows = listActiveContext.all({ limit: maxResults });
      }
      return {
        content: [{ type: "text", text: JSON.stringify({
          ok: true,
          type_filter: type || "all",
          count: rows.length,
          contexts: rows.map(formatContext),
        }) }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: e.message }) }] };
    }
  }
);

// Tool: context.resolve
server.tool(
  "context.resolve",
  "Mark an ephemeral context as resolved or abandoned. " +
  "Use after a situation has been handled or a plan completed/abandoned.",
  {
    id: z.number().describe("Context ID to resolve"),
    status: z.enum(["resolved", "abandoned"]).optional().describe("Resolution status (default 'resolved')"),
  },
  async ({ id, status }) => {
    try {
      const existing = getContextById.get({ id });
      if (!existing) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: `Context #${id} not found` }) }] };
      }
      if (existing.status !== "active") {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: `Context #${id} is already ${existing.status}` }) }] };
      }
      resolveContext.run({ id, status: status || "resolved" });
      const updated = getContextById.get({ id });
      return {
        content: [{ type: "text", text: JSON.stringify({
          ok: true,
          message: `Context #${id} marked as ${status || "resolved"}`,
          context: formatContext(updated),
        }) }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: e.message }) }] };
    }
  }
);

// Tool: context.clear
server.tool(
  "context.clear",
  "Clear all active ephemeral context, optionally filtered by type. " +
  "Use for 'reset my day', or when starting a fresh situation assessment.",
  {
    type: z.enum(["situation", "plan"]).optional().describe("Clear only this type (optional — omit to clear all)"),
  },
  async ({ type }) => {
    try {
      gcExpired();
      let result;
      if (type) {
        result = clearActiveByType.run({ type });
      } else {
        result = clearAllActiveContext.run();
      }
      return {
        content: [{ type: "text", text: JSON.stringify({
          ok: true,
          message: `Cleared ${result.changes} active context entries`,
          type_filter: type || "all",
        }) }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: e.message }) }] };
    }
  }
);


// ─── Start ───

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[memory-mcp] v3.3.0 — Dual-store + rule engine — SQLite at", DB_PATH);
