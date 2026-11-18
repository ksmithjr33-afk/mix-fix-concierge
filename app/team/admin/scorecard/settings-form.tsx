"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { TierSettings } from "@/lib/team/scorecard";
import { scorecardSave } from "./save";

const FIELDS: { key: keyof TierSettings; label: string; step: string }[] = [
  { key: "window", label: "Rated events the tier looks at", step: "1" },
  { key: "aceAvg", label: "Ace: average at least", step: "0.01" },
  { key: "aceMin", label: "Ace: no mark below", step: "1" },
  { key: "solidAvg", label: "Solid: average at least", step: "0.01" },
  { key: "coachLow", label: "Coach: a mark at or below", step: "1" },
  { key: "coachRecent", label: "Coach: in the last rated events", step: "1" },
  { key: "newUnder", label: "New: fewer rated events than", step: "1" },
];

/** Tier thresholds and the window. Admins only (the server checks again). */
export default function SettingsForm({ initial }: { initial: TierSettings }) {
  const router = useRouter();
  const [v, setV] = useState<Record<string, string>>(Object.fromEntries(FIELDS.map((f) => [f.key, String(initial[f.key])])));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const save = async () => {
    setBusy(true);
    setMsg("");
    const r = await scorecardSave({ action: "settings", ...Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x === "" ? "" : Number(x)])) });
    setBusy(false);
    setMsg(r.ok ? "Saved." : r.error);
    if (r.ok) router.refresh();
  };
  return (
    <div className="mt-3 space-y-2">
      <div className="grid sm:grid-cols-2 gap-2">
        {FIELDS.map((f) => (
          <label key={f.key} className="flex items-center justify-between gap-2 text-sm text-[#2C2420]">
            {f.label}
            <input type="number" inputMode="decimal" step={f.step} value={v[f.key]} onChange={(e) => setV((o) => ({ ...o, [f.key]: e.target.value }))} className="w-20 rounded-lg border border-[#DDD5CC] px-2 py-1.5 text-[16px]" />
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={busy} className="rounded-lg bg-[#B5845A] text-white px-4 py-2 text-sm font-medium disabled:opacity-40">
          {busy ? "Saving..." : "Save settings"}
        </button>
        {msg && <span className="text-sm text-[#6B5D52]">{msg}</span>}
      </div>
    </div>
  );
}
