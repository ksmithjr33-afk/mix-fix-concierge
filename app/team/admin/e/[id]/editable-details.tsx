"use client";

// The manager view's Details cards, with a small Edit next to each field.
// Tapping Edit turns that one field into its input in place, with Save and
// Cancel. Only one field is open at a time. Each save posts that one field to
// /api/team/admin/event-edit, the same server path as "Edit everything": the
// same validation, the version check, the event_updates row, the GHL payload
// with updated_by admin, and the staff notices (calendar only events send
// nothing to GHL there). Priced fields and the date show the price and ask for
// a confirm first; a change the engine cannot price can be left price pending.
// Admins and managers only: the page runs requireAdmin, and so does the route.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { EditCardData, EditRow } from "@/lib/team/edit-cards";
import type { AdminEditField } from "@/lib/team/admin-edit";
import { editInput, fetchPreview, ListFieldset, money, priceChosen, PriceFieldset, type Mode, type Preview } from "./edit-price";

const card = "bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 sm:px-5 sm:py-4";
const editBtn = "shrink-0 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg px-2 text-sm font-medium text-[#9A7049] hover:bg-[#EDE6DF] disabled:opacity-40";

export const LEAVE_MESSAGE = "You have an unsaved change. Leave without saving it?";

function FieldInput({ row, value, onChange, packages }: { row: EditRow; value: string; onChange: (v: string) => void; packages: string[] }) {
  const id = `edit-${row.field}`;
  const common = { id, className: editInput, value, autoFocus: true, "aria-label": row.label };
  switch (row.kind) {
    case "longtext":
    case "list":
      return (
        <>
          <textarea {...common} rows={3} className={`${editInput} resize-y`} onChange={(e) => onChange(e.target.value)} />
          {row.kind === "list" && <p className="text-xs text-[#6B5D52] mt-1">Separate each with a comma. Leave empty for none.</p>}
        </>
      );
    case "date":
      return <input {...common} type="date" onChange={(e) => onChange(e.target.value)} />;
    case "time":
      return <input {...common} type="time" onChange={(e) => onChange(e.target.value)} />;
    case "number":
      return <input {...common} type="number" inputMode="numeric" min={1} onChange={(e) => onChange(e.target.value)} />;
    case "package": {
      const list = packages.includes(value) || !value ? packages : [value, ...packages];
      return (
        <select {...common} onChange={(e) => onChange(e.target.value)}>
          {list.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      );
    }
    case "venue":
      return (
        <select {...common} onChange={(e) => onChange(e.target.value)}>
          {!value && <option value="">Pick one</option>}
          <option value="venue">Venue</option>
          <option value="private_residence">Private residence</option>
        </select>
      );
    case "yesno":
      return (
        <div className="flex gap-2" role="radiogroup" aria-label={row.label}>
          {(["yes", "no"] as const).map((o) => (
            <button
              key={o}
              type="button"
              role="radio"
              aria-checked={value === o}
              onClick={() => onChange(o)}
              className={`min-h-[44px] flex-1 rounded-xl border text-[15px] font-medium ${value === o ? "border-[#2C2420] bg-[#2C2420] text-white" : "border-[#DDD5CC] bg-white text-[#2C2420]"}`}
            >
              {o === "yes" ? "Yes" : "No"}
            </button>
          ))}
        </div>
      );
    default:
      return <input {...common} type={row.field === "day_of_contact_phone" ? "tel" : "text"} onChange={(e) => onChange(e.target.value)} />;
  }
}

export default function EditableDetails({ sessionId, version, cards, packages }: { sessionId: string; version: number; cards: EditCardData[]; packages: string[] }) {
  const router = useRouter();
  const [ver, setVer] = useState(version);
  const [open, setOpen] = useState<AdminEditField | null>(null);
  const [draft, setDraft] = useState("");
  const [stage, setStage] = useState<"edit" | "confirm">("edit");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [mode, setMode] = useState<Mode>("");
  const [manual, setManual] = useState("");
  const [sendList, setSendList] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<{ field: AdminEditField; text: string } | null>(null);

  // A newer version from the server (a refresh after a save, or someone else's change) wins.
  const [seen, setSeen] = useState(version);
  if (version !== seen) {
    setSeen(version);
    setVer(version);
  }

  const rows = cards.flatMap((c) => c.rows);
  const openRow = rows.find((r) => r.field === open) ?? null;
  const dirty = !!openRow && draft.trim() !== (openRow.value ?? "").trim();
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // Leaving the page with an unsaved field asks first: closing or reloading
  // the tab, and any link on the page.
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    const click = (e: MouseEvent) => {
      if (!dirtyRef.current || e.defaultPrevented) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.getAttribute("href")?.startsWith("tel:") || a.getAttribute("href")?.startsWith("#")) return;
      if (!window.confirm(LEAVE_MESSAGE)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", click, true);
    };
  }, []);

  const reset = () => {
    setOpen(null);
    setDraft("");
    setStage("edit");
    setPreview(null);
    setPreviewError("");
    setMode("");
    setManual("");
    setSendList(true);
    setError("");
  };

  const start = (row: EditRow) => {
    // Only one field open at a time: an unsaved one asks before it is dropped.
    if (dirty && open !== row.field && !window.confirm(LEAVE_MESSAGE)) return;
    reset();
    setSaved(null);
    setOpen(row.field!);
    setDraft(row.value ?? "");
  };

  const cancel = () => reset();

  const post = useCallback(
    async (field: AdminEditField, value: string, price: { mode: Mode; total?: string }) => {
      setBusy(true);
      setError("");
      try {
        const res = await fetch("/api/team/admin/event-edit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, version: ver, changes: { [field]: value }, price, sendList }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "Could not save.");
        setVer(data.version);
        const label = rows.find((r) => r.field === field)?.label ?? "Change";
        reset();
        setSaved({ field, text: `${label} saved.${data.pricePending ? " The price is pending." : ""}` });
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save.");
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rows and reset read the latest render
    [sessionId, ver, sendList, router]
  );

  const save = async () => {
    if (!openRow || !open) return;
    if (!dirty) {
      reset();
      return;
    }
    setBusy(true);
    setError("");
    let p: Preview | null = null;
    try {
      p = await fetchPreview(sessionId, { [open]: draft });
      setPreview(p);
      setPreviewError("");
    } catch (err) {
      // A field that fails its check (an empty date, a bad number) says why here.
      setBusy(false);
      setError(err instanceof Error ? err.message : "Could not save.");
      return;
    }
    setBusy(false);
    // Priced fields and the date confirm with the price; a change to the
    // client's shopping list asks about sending it. Anything else saves now.
    if (openRow.confirm || p.priced || p.listChanges) {
      if (p.engineNewTotal === null && p.priced) setMode("pending");
      setStage("confirm");
      return;
    }
    await post(open, draft, { mode: "keep" });
  };

  const priced = !!openRow?.priced || !!preview?.priced;
  const canConfirm = !busy && (!priced || priceChosen(mode, manual, preview));

  return (
    <div className="space-y-3">
      {cards.map((c) => (
        <section key={c.id} className={card} aria-label={c.title}>
          <h3 className="font-heading text-base font-bold text-[#2C2420] mb-1">{c.title}</h3>
          <dl>
            {c.rows.map((r, i) => {
              const isOpen = !!r.field && r.field === open;
              if (!r.field && !r.display) return null;
              return (
                <div key={r.field ?? `${r.label}-${i}`} className="py-1.5 border-b border-[#DDD5CC] last:border-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1 py-1">
                      <dt className="text-xs text-[#A39585] uppercase tracking-wide mb-0.5">{r.label}</dt>
                      {!isOpen && (
                        <dd className="text-[15px] text-[#2C2420] whitespace-pre-wrap break-words">
                          {r.display ? (
                            r.href ? (
                              <a href={r.href} target={r.href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer" className="text-[#B5845A] underline">
                                {r.display}
                              </a>
                            ) : (
                              r.display
                            )
                          ) : (
                            <span className="text-[#A39585]">Not set</span>
                          )}
                          {saved && saved.field === r.field && <span className="block text-sm text-[#55684A]">{saved.text}</span>}
                        </dd>
                      )}
                    </div>
                    {r.field && !isOpen && (
                      <button type="button" className={editBtn} onClick={() => start(r)} aria-label={`Edit ${r.label}`}>
                        Edit
                      </button>
                    )}
                  </div>
                  {isOpen && (
                    <dd className="space-y-2 pb-2">
                      {stage === "edit" ? (
                        <FieldInput row={r} value={draft} onChange={setDraft} packages={packages} />
                      ) : (
                        <p className="text-[15px] text-[#2C2420] break-words">
                          <span className="text-[#6B5D52]">{r.display || "Not set"}</span> to <span className="font-medium">{shownValue(r, draft)}</span>
                        </p>
                      )}
                      {stage === "confirm" && r.field === "event_date" && !preview?.priced && (
                        <p className="rounded-xl border border-[#E3C9A0] bg-[#FFF8EC] px-3 py-2 text-sm text-[#2C2420]">
                          The pricing engine does not price a date change, so the total stays {money(preview?.bookedTotal ?? null)}. Confirm to save.
                        </p>
                      )}
                      {stage === "confirm" && priced && <PriceFieldset mode={mode} setMode={setMode} manual={manual} setManual={setManual} preview={preview} previewError={previewError} />}
                      {stage === "confirm" && preview?.listChanges && <ListFieldset preview={preview} sendList={sendList} setSendList={setSendList} />}
                      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
                      <div className="flex flex-wrap items-center gap-2">
                        {stage === "edit" ? (
                          <button type="button" onClick={save} disabled={busy} className="min-h-[44px] rounded-xl bg-[#B5845A] px-5 text-white font-medium disabled:opacity-40">
                            {busy ? "Checking..." : "Save"}
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => post(r.field!, draft, priced ? { mode, total: mode === "manual" ? manual : undefined } : { mode: "keep" })}
                              disabled={!canConfirm}
                              className="min-h-[44px] rounded-xl bg-[#B5845A] px-5 text-white font-medium disabled:opacity-40"
                            >
                              {busy ? "Saving..." : "Confirm and save"}
                            </button>
                            <button type="button" onClick={() => setStage("edit")} disabled={busy} className="min-h-[44px] px-3 text-sm text-[#6B5D52] underline">
                              Back
                            </button>
                          </>
                        )}
                        <button type="button" onClick={cancel} disabled={busy} className="min-h-[44px] px-3 text-sm text-[#6B5D52] underline">
                          Cancel
                        </button>
                      </div>
                    </dd>
                  )}
                </div>
              );
            })}
          </dl>
        </section>
      ))}
    </div>
  );
}

/** The new value as the confirm line shows it. */
function shownValue(r: EditRow, v: string): string {
  if (r.kind === "yesno") return v === "yes" ? "Yes" : v === "no" ? "No" : "Not set";
  if (r.kind === "venue") return v === "private_residence" ? "Private residence" : v === "venue" ? "Venue" : v;
  if (r.kind === "date" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }
  if (r.kind === "time" && /^\d{2}:\d{2}$/.test(v)) {
    const [h, m] = v.split(":").map(Number);
    return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  }
  return v.trim() || "Not set";
}
