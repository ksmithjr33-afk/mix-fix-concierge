"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Who = "everyone" | "markets";

/** Admins write an announcement: title, message, who gets it, and whether to skip quiet hours. */
export default function Compose({ markets }: { markets: { id: string; label: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [who, setWho] = useState<Who>("everyone");
  const [picked, setPicked] = useState<string[]>([]);
  const [bartendersOnly, setBartendersOnly] = useState(false);
  const [sendNow, setSendNow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const ready = title.trim() && body.trim() && (who === "everyone" || picked.length > 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    setDone("");
    try {
      const res = await fetch("/api/team/admin/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body, markets: who === "markets" ? picked : [], bartendersOnly, sendNow }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Could not send.");
      setDone(
        `Sent to ${d.recipients} ${d.recipients === 1 ? "person" : "people"}. ${d.texted} ${d.texted === 1 ? "text" : "texts"} sent` +
          (d.held ? `, ${d.held} held for quiet hours and sent at 8:00 AM their time.` : ".")
      );
      setTitle("");
      setBody("");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send.");
    } finally {
      setBusy(false);
    }
  };

  const field = "w-full rounded-xl border border-[#DDD5CC] bg-white px-3 py-2 text-[16px] text-[#2C2420] focus:outline-none focus:ring-2 focus:ring-[#B5845A]/30 focus:border-[#B5845A]";
  if (!open) {
    return (
      <div className="px-1 space-y-2">
        <button type="button" onClick={() => setOpen(true)} className="rounded-lg bg-[#2C2420] text-white px-4 py-2 text-sm font-medium">
          New announcement
        </button>
        {done && <p className="text-sm text-[#55684A]">{done}</p>}
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-4 space-y-3">
      <h2 className="font-heading text-lg font-bold text-[#2C2420]">New announcement</h2>
      <label className="block space-y-1">
        <span className="text-sm font-medium text-[#2C2420]">Title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className={field} />
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-medium text-[#2C2420]">Message</span>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={2000} className={field} />
      </label>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-[#2C2420]">Send to</legend>
        <label className="flex items-center gap-2 text-[15px] text-[#2C2420]">
          <input type="radio" name="who" checked={who === "everyone"} onChange={() => setWho("everyone")} /> Every market
        </label>
        <label className="flex items-center gap-2 text-[15px] text-[#2C2420]">
          <input type="radio" name="who" checked={who === "markets"} onChange={() => setWho("markets")} /> Some markets
        </label>
        {who === "markets" && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 pl-6">
            {markets.map((m) => (
              <label key={m.id} className="flex items-center gap-1.5 text-[15px] text-[#2C2420]">
                <input type="checkbox" checked={picked.includes(m.id)} onChange={() => toggle(m.id)} /> {m.label}
              </label>
            ))}
          </div>
        )}
        <label className="flex items-center gap-2 text-[15px] text-[#2C2420]">
          <input type="checkbox" checked={bartendersOnly} onChange={(e) => setBartendersOnly(e.target.checked)} /> Bartenders only
        </label>
      </fieldset>
      <label className="flex items-start gap-2 text-[15px] text-[#2C2420]">
        <input type="checkbox" className="mt-1" checked={sendNow} onChange={(e) => setSendNow(e.target.checked)} />
        <span>
          Send now
          <span className="block text-xs text-[#6B5D52]">Off: texts wait until 8:00 AM for anyone in quiet hours (9:00 PM to 8:00 AM their time).</span>
        </span>
      </label>
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={!ready || busy} className="rounded-lg bg-[#2C2420] text-white px-4 py-2 text-sm font-medium disabled:opacity-40">
          {busy ? "Sending..." : "Send announcement"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-[#6B5D52] underline">
          Cancel
        </button>
      </div>
    </form>
  );
}
