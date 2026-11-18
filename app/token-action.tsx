"use client";

import { useState } from "react";

/** One button (or two) that posts a link's token. Used by the client's remove and approve links. */
export default function TokenAction({
  url,
  token,
  actions,
}: {
  url: string;
  token: string;
  actions: { label: string; body: Record<string, unknown>; done: string; tone: "go" | "stop" }[];
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  if (result) return <p className="text-[16px] text-[#2C2420]">{result}</p>;
  const run = async (a: (typeof actions)[number]) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, ...a.body }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error ?? "That did not work. Text us at 469 754 8512.");
      else setResult(a.done);
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            disabled={busy}
            onClick={() => run(a)}
            className={`rounded-xl px-5 py-3 font-medium disabled:opacity-40 ${a.tone === "go" ? "bg-[#B5845A] text-white" : "border border-[#A0412D] text-[#A0412D]"}`}
          >
            {a.label}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
    </div>
  );
}
