// In-memory stand-in for the Supabase client, for tests that run the real
// update path without a database. Supports the query shapes the app uses:
// select (with "alias:fk (cols)" joins), eq, neq, in, is, gte, order, limit,
// maybeSingle, single, insert, update, upsert, delete, and head counts.

import { randomUUID } from "node:crypto";

export const db: Record<string, Record<string, unknown>[]> = {};

type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;

/** Unique keys the real tables have, so duplicate handling in the app is exercised. */
const UNIQUE: Record<string, string[][]> = {
  team_notices: [["key"]],
  time_punches: [["assignment_id", "type"], ["client_id"]],
  event_assignments: [["session_id", "staff_id"]],
};

const JOIN_TABLES: Record<string, string> = { staff: "staff", session: "sessions" };

type Result = { data: unknown; error: { message: string } | null; count?: number };

class Query implements PromiseLike<Result> {
  private op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private filters: Filter[] = [];
  private payload: Row | Row[] | null = null;
  private cols = "*";
  private mode: "many" | "single" | "maybe" = "many";
  private head = false;
  private orders: { col: string; asc: boolean }[] = [];
  private limitN: number | null = null;
  private conflict: string[] = [];
  private ignoreDuplicates = false;

  private table: string;

  constructor(table: string) {
    this.table = table;
    db[table] ??= [];
  }

  select(cols = "*", opts: { count?: string; head?: boolean } = {}) {
    if (this.op === "select") this.cols = cols;
    this.head = !!opts.head;
    return this;
  }
  eq(c: string, v: unknown) {
    this.filters.push((r) => r[c] === v);
    return this;
  }
  neq(c: string, v: unknown) {
    this.filters.push((r) => r[c] !== v);
    return this;
  }
  in(c: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[c]));
    return this;
  }
  is(c: string, v: unknown) {
    this.filters.push((r) => (r[c] ?? null) === v);
    return this;
  }
  gte(c: string, v: string) {
    this.filters.push((r) => String(r[c]) >= v);
    return this;
  }
  not() {
    return this;
  }
  order(col: string, opts: { ascending?: boolean } = {}) {
    this.orders.push({ col, asc: opts.ascending !== false });
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  maybeSingle() {
    this.mode = "maybe";
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }
  insert(rows: Row | Row[]) {
    this.op = "insert";
    this.payload = rows;
    return this;
  }
  update(p: Row) {
    this.op = "update";
    this.payload = p;
    return this;
  }
  upsert(rows: Row | Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    this.op = "upsert";
    this.payload = rows;
    this.conflict = (opts.onConflict ?? "id").split(",");
    this.ignoreDuplicates = !!opts.ignoreDuplicates;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }

  private withJoins(r: Row): Row {
    const out = { ...r };
    for (const m of this.cols.matchAll(/(\w+):(\w+)\s*\(/g)) {
      const target = db[JOIN_TABLES[m[1]] ?? m[1]] ?? [];
      out[m[1]] = target.find((t) => t.id === r[m[2]]) ?? null;
    }
    return out;
  }

  private run(): Result {
    const rows = db[this.table];
    if (this.op === "insert") {
      for (const p of Array.isArray(this.payload) ? this.payload : [this.payload!]) {
        for (const key of UNIQUE[this.table] ?? []) {
          if (key.every((c) => p[c] !== null && p[c] !== undefined) && rows.some((r) => key.every((c) => r[c] === p[c]))) {
            return { data: null, error: { message: `duplicate key value violates unique constraint on ${key.join(", ")}` } };
          }
        }
      }
    }
    const match = (r: Row) => this.filters.every((f) => f(r));
    let result: Row[] = [];
    if (this.op === "insert" || this.op === "upsert") {
      for (const p of Array.isArray(this.payload) ? this.payload : [this.payload!]) {
        const existing = this.op === "upsert" ? rows.find((r) => this.conflict.every((c) => r[c] === p[c])) : undefined;
        if (existing) {
          if (!this.ignoreDuplicates) Object.assign(existing, p);
          result.push(existing);
        } else {
          const row = { id: randomUUID(), created_at: new Date().toISOString(), ...p };
          rows.push(row);
          result.push(row);
        }
      }
    } else if (this.op === "update") {
      result = rows.filter(match);
      for (const r of result) Object.assign(r, this.payload);
    } else if (this.op === "delete") {
      result = rows.filter(match);
      db[this.table] = rows.filter((r) => !match(r));
    } else {
      result = rows.filter(match);
      for (const o of [...this.orders].reverse()) {
        result.sort((a, b) => (String(a[o.col]) < String(b[o.col]) ? -1 : String(a[o.col]) > String(b[o.col]) ? 1 : 0) * (o.asc ? 1 : -1));
      }
      if (this.limitN !== null) result = result.slice(0, this.limitN);
    }
    const data = result.map((r) => this.withJoins(r));
    if (this.head) return { data: null, error: null, count: data.length };
    if (this.mode === "many") return { data, error: null };
    return { data: data[0] ?? null, error: null };
  }

  then<A, B>(ok?: ((v: Result) => A) | null, bad?: ((e: unknown) => B) | null) {
    return Promise.resolve().then(() => this.run()).then(ok, bad);
  }
}

export const supabase = {
  from: (table: string) => new Query(table),
  storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }), createSignedUrls: async () => ({ data: [], error: null }) }) },
};
