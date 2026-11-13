// Server timing for pages and routes. Wrap a page or route body in timed():
// one log line per request with the total time, how many database calls it
// made, and the summed database time (more than the total means calls ran
// together). Logging only: nothing here changes what a page shows or returns.
//
//   [timing] manager:details 412ms db=9 calls/655ms
//
// Set TIMING_LOG=0 to silence the lines.

import { AsyncLocalStorage } from "node:async_hooks";

type Run = { calls: number; dbMs: number; start: number; trace?: string[] };

const runs = new AsyncLocalStorage<Run>();

/** Called by the database client for every request it makes. */
export function noteDbCall(ms: number, what = ""): void {
  const run = runs.getStore();
  if (!run) return;
  run.calls++;
  run.dbMs += ms;
  // TIMING_TRACE=1: also list each call with when it started and ended, to see which waited on which.
  if (run.trace) {
    const end = performance.now() - run.start;
    run.trace.push(`${Math.round(end - ms)}-${Math.round(end)} ${what}`);
  }
}

export async function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const run: Run = { calls: 0, dbMs: 0, start, ...(process.env.TIMING_TRACE === "1" ? { trace: [] } : {}) };
  try {
    return await runs.run(run, fn);
  } finally {
    const result = { name, ms: Math.round(performance.now() - start), calls: run.calls, dbMs: Math.round(run.dbMs) };
    if (process.env.TIMING_LOG !== "0") console.log(`[timing] ${name} ${result.ms}ms db=${result.calls} calls/${result.dbMs}ms`);
    if (run.trace) console.log(run.trace.map((t) => `  ${t}`).join("\n"));
  }
}

/** A fetch that reports its time to the current timed() run. */
export const timedFetch: typeof fetch = async (input, init) => {
  const start = performance.now();
  try {
    return await fetch(input, init);
  } finally {
    noteDbCall(performance.now() - start, process.env.TIMING_TRACE === "1" ? callLabel(input, init) : "");
  }
};

function callLabel(input: Parameters<typeof fetch>[0], init?: RequestInit): string {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  return `${init?.method ?? "GET"} ${url.pathname.replace(/^\/(rest|storage)\/v1\//, "")}${url.search.slice(0, 90)}`;
}
