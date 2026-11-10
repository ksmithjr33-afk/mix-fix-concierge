"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export async function setHidden(sessionId: string, hidden: boolean): Promise<void> {
  const res = await fetch("/api/team/admin/hide", {
    method: hidden ? "POST" : "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Could not save.");
}

export default function HiddenList({ items }: { items: { id: string; title: string; detail: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  if (items.length === 0) {
    return <p className="text-[15px] text-[#6B5D52] bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-4">No hidden events.</p>;
  }
  return (
    <div className="space-y-2">
      <ul className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] divide-y divide-[#DDD5CC]">
        {items.map((i) => (
          <li key={i.id} className="flex items-center gap-3 px-3 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-heading font-bold text-[#2C2420]">{i.title}</span>
              <span className="block text-sm text-[#6B5D52] break-words">{i.detail}</span>
            </span>
            <button
              type="button"
              disabled={!!busy}
              onClick={async () => {
                setBusy(i.id);
                setError("");
                try {
                  await setHidden(i.id, false);
                  router.refresh();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Could not save.");
                } finally {
                  setBusy("");
                }
              }}
              className="shrink-0 rounded-lg border border-[#B5845A] text-[#9A7049] px-3 py-1.5 text-sm font-medium disabled:opacity-40"
            >
              {busy === i.id ? "Unhiding..." : "Unhide"}
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="text-sm text-[#A0412D] px-1">{error}</p>}
    </div>
  );
}
