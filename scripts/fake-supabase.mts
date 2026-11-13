// In-memory stand-in for the Supabase client, for tests that run the real
// update path without a database. Supports the query shapes the app uses:
// select (with "alias:fk (cols)" joins), eq, neq, in, is, gt, gte, lte, lt, order, limit,
// maybeSingle, single, insert, update, upsert, delete, head counts, and rpc.

import { randomUUID } from "node:crypto";

export const db: Record<string, Record<string, unknown>[]> = {};

type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;

/** Unique keys the real tables have, so duplicate handling in the app is exercised. */
const UNIQUE: Record<string, string[][]> = {
  team_notices: [["key"]],
  time_punches: [["assignment_id", "type"], ["client_id"]],
  event_assignments: [["session_id", "staff_id"]],
  time_approvals: [["assignment_id"]],
  announcement_recipients: [["announcement_id", "staff_id"]],
  event_message_reads: [["session_id", "staff_id"]],
  event_chat_notices: [["session_id", "staff_id"]],
  order_sheet_stores: [["color"]],
};

/** Tests can stand in for database constraints and triggers: return an error message to refuse a write. */
export const guards: ((table: string, op: string, rows: Record<string, unknown>[]) => string | null)[] = [];

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
  lte(c: string, v: string) {
    this.filters.push((r) => String(r[c]) <= v);
    return this;
  }
  gt(c: string, v: unknown) {
    this.filters.push((r) => (typeof v === "number" ? Number(r[c]) > v : String(r[c]) > String(v)));
    return this;
  }
  lt(c: string, v: string) {
    this.filters.push((r) => String(r[c]) < v);
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
    if (this.op !== "select") {
      const touched = this.op === "insert" || this.op === "upsert" ? (Array.isArray(this.payload) ? this.payload : [this.payload!]) : rows.filter((r) => this.filters.every((f) => f(r)));
      for (const g of guards) {
        const refused = g(this.table, this.op, touched);
        if (refused) return { data: null, error: { message: refused } };
      }
    }
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

/** Database functions for supabase.rpc(), set by the tests. */
export const rpcs: Record<string, (args: Record<string, unknown>) => { data: unknown; error: { message: string } | null }> = {};

export const supabase = {
  from: (table: string) => new Query(table),
  rpc: async (name: string, args: Record<string, unknown> = {}) => (rpcs[name] ? rpcs[name](args) : { data: null, error: { message: `function ${name} does not exist` } }),
  storage: {
    from: (bucket: string) => ({
      upload: async (p: string, body: Blob | null, opts: { contentType?: string } = {}) => {
        objects.set(`${bucket}/${p}`, { size: body?.size ?? 0, contentType: opts.contentType ?? body?.type ?? "" });
        return { error: null };
      },
      remove: async (paths: string[]) => {
        for (const p of paths) {
          objects.delete(`${bucket}/${p}`);
          removed.push(`${bucket}/${p}`);
        }
        return { error: null };
      },
      createSignedUrls: async () => ({ data: [], error: null }),
      createSignedUrl: async (p: string, secs: number, opts: { download?: string | boolean } = {}) => {
        signed.push({ bucket, path: p, seconds: secs, download: opts.download ?? null });
        return { data: { signedUrl: `https://signed.test/${p}${opts.download ? "?download" : ""}` }, error: null };
      },
      list: async () => ({ data: [], error: null }),
      createSignedUploadUrl: async (p: string) => ({ data: { signedUrl: `https://upload.test/${bucket}/${p}?token=t`, path: p, token: "t" }, error: null }),
      info: async (p: string) => {
        const o = objects.get(`${bucket}/${p}`);
        return o ? { data: { size: o.size, contentType: o.contentType }, error: null } : { data: null, error: { message: "Object not found" } };
      },
    }),
  },
};

/** Files in the fake storage, by "bucket/path". Tests stand in for a browser upload with putObject. */
export const objects = new Map<string, { size: number; contentType: string }>();
export const removed: string[] = [];
export const signed: { bucket: string; path: string; seconds: number; download: string | boolean | null }[] = [];
export function putObject(bucket: string, path: string, size: number, contentType: string) {
  objects.set(`${bucket}/${path}`, { size, contentType });
}
