"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ALL_PACKAGES, ALL_PACKAGES_TITLE, LEGACY_LABEL, LEGACY_NOTE, trainingAnchor, type PackageGuide } from "@/lib/packages-info";
import { MARK_READ, packageAckId } from "@/lib/team/training";

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className="text-xs text-[#A39585] uppercase tracking-wide">{title}</h4>
      <ul className="mt-0.5 space-y-0.5">
        {items.map((i) => (
          <li key={i} className="text-[15px] text-[#2C2420]">
            {i}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Entry({ g, read, onRead }: { g: PackageGuide; read: boolean; onRead: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mark = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/team/training", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ackId: packageAckId(g.key) }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Could not save.");
      onRead();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <details id={trainingAnchor(g.key)} className="group bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] scroll-mt-20">
      <summary className="flex items-center gap-3 px-4 py-3 cursor-pointer list-none">
        <span
          aria-label={read ? "Read" : "Not read"}
          className={`shrink-0 h-6 w-6 rounded-full border-2 flex items-center justify-center text-xs font-bold ${read ? "bg-[#8B9E7E] border-[#8B9E7E] text-white" : "border-[#DDD5CC]"}`}
        >
          {read ? "✓" : ""}
        </span>
        <span className="flex-1 font-medium text-[#2C2420]">
          {g.name}
          {g.note && <span className="ml-2 text-sm font-normal text-[#6B5D52]">{g.note}</span>}
        </span>
        {g.legacy && <span className="text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#FFF8EC] text-[#8A4B12] border border-[#E3C9A0]">{LEGACY_LABEL}</span>}
        <span className="text-[#A39585] group-open:rotate-180 transition-transform" aria-hidden>
          ▾
        </span>
      </summary>
      <div className="px-4 pb-4 space-y-3 border-t border-[#DDD5CC] pt-3">
        {g.legacy && <p className="text-[15px] font-medium text-[#8A4B12]">{LEGACY_NOTE}</p>}
        <p className="text-[15px] text-[#2C2420]">{g.summary}</p>
        <List title="We bring" items={g.weBring} />
        <List title="Client provides" items={g.clientProvides} />
        <List title="Not included" items={g.notIncluded} />
        <List title="How service runs" items={g.service} />
        <div>
          <h4 className="text-xs text-[#A39585] uppercase tracking-wide">When a guest asks for something not included</h4>
          <ul className="mt-0.5 space-y-1.5">
            {g.guestAsks.map((a) => (
              <li key={a.ask} className="text-[15px] text-[#2C2420]">
                <span className="font-medium">{a.ask}:</span> &ldquo;{a.say}&rdquo;
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="text-xs text-[#A39585] uppercase tracking-wide">Setup</h4>
          <dl className="text-[15px] text-[#2C2420] space-y-0.5">
            <div>
              <dt className="inline text-[#6B5D52]">Bar: </dt>
              <dd className="inline">{g.setup.bar}</dd>
            </div>
            <div>
              <dt className="inline text-[#6B5D52]">Menu: </dt>
              <dd className="inline">{g.setup.menu}</dd>
            </div>
            <div>
              <dt className="inline text-[#6B5D52]">Barback: </dt>
              <dd className="inline">{g.setup.barback}</dd>
            </div>
          </dl>
        </div>
        <List title={ALL_PACKAGES_TITLE} items={ALL_PACKAGES} />
        {read ? (
          <p className="rounded-xl bg-[#E4EBDF] text-[#55684A] px-4 py-2.5 text-[15px] font-medium">Read. Thanks.</p>
        ) : (
          <button type="button" onClick={mark} disabled={busy} className="w-full rounded-xl bg-[#B5845A] text-white py-2.5 font-medium disabled:opacity-40">
            {busy ? "Saving..." : MARK_READ}
          </button>
        )}
        {error && <p className="text-sm text-[#A0412D]">{error}</p>}
      </div>
    </details>
  );
}

/**
 * Packages on the Training page: one expandable entry per package, current
 * first and Legacy in its own group at the bottom. A link from an event's
 * Package card (/team/training#package-full) opens that entry.
 */
export default function PackageEntries({ guides, read: initial }: { guides: PackageGuide[]; read: string[] }) {
  const router = useRouter();
  const [read, setRead] = useState(new Set(initial));
  // Open the entry a "Full package guide" link points at (a DOM change, no state).
  useEffect(() => {
    const open = () => {
      const el = window.location.hash ? document.getElementById(decodeURIComponent(window.location.hash.slice(1))) : null;
      if (el instanceof HTMLDetailsElement) {
        el.open = true;
        el.scrollIntoView({ block: "start" });
      }
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);
  const markRead = (key: string) => {
    setRead((r) => new Set([...r, packageAckId(key)]));
    router.refresh(); // the section count and the header badge
  };
  const current = guides.filter((g) => !g.legacy);
  const legacy = guides.filter((g) => g.legacy);
  return (
    <div className="space-y-2">
      {current.map((g) => (
        <Entry key={g.key} g={g} read={read.has(packageAckId(g.key))} onRead={() => markRead(g.key)} />
      ))}
      {legacy.length > 0 && (
        <>
          <h3 className="font-heading text-base font-bold text-[#2C2420] px-1 pt-2">Legacy packages</h3>
          <p className="text-sm text-[#6B5D52] px-1">Still on some active bookings. {LEGACY_NOTE}.</p>
          {legacy.map((g) => (
            <Entry key={g.key} g={g} read={read.has(packageAckId(g.key))} onRead={() => markRead(g.key)} />
          ))}
        </>
      )}
    </div>
  );
}
