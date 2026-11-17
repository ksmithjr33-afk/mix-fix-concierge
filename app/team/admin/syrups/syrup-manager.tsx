"use client";

import { useState } from "react";
import { ingredientText, type SyrupRecipe } from "@/lib/syrups";

const card = "bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 sm:px-5 sm:py-4";
const input =
  "mt-1 w-full rounded-xl border border-[#DDD5CC] bg-white px-3 py-2.5 text-[16px] text-[#2C2420] placeholder:text-[#A39585] focus:outline-none focus:ring-2 focus:ring-[#B5845A]/30";
const label = "block text-xs text-[#A39585] uppercase tracking-wide";

interface Draft {
  id: string | null;
  name: string;
  aliases: string;
  ingredients: string;
  ratio: string;
  method: string;
  yieldAmount: string;
  yieldUnit: string;
  shelfLife: string;
  bought: boolean;
}

const empty = (name = ""): Draft => ({
  id: null,
  name,
  aliases: "",
  ingredients: "",
  ratio: "",
  method: "",
  yieldAmount: "",
  yieldUnit: "cups",
  shelfLife: "",
  bought: false,
});

const toDraft = (r: SyrupRecipe): Draft => ({
  id: r.id,
  name: r.name,
  aliases: r.aliases.join(", "),
  ingredients: r.ingredients.map((i) => ingredientText(i)).join("\n"),
  ratio: r.ratio,
  method: r.method,
  yieldAmount: r.yieldAmount === null ? "" : String(r.yieldAmount),
  yieldUnit: r.yieldUnit,
  shelfLife: r.shelfLife,
  bought: r.bought,
});

function Form({
  draft,
  setDraft,
  busy,
  onSave,
  onCancel,
  error,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  busy: boolean;
  onSave: () => void;
  onCancel: () => void;
  error: string;
}) {
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft({ ...draft, [k]: e.target.value });
  return (
    <div className="space-y-3">
      <label className={label}>
        Name
        <input className={input} value={draft.name} onChange={set("name")} placeholder="Simple syrup" autoFocus />
      </label>
      <label className={label}>
        Other names drinks use, separated by commas
        <input className={input} value={draft.aliases} onChange={set("aliases")} placeholder="simple, 1:1 simple syrup" />
      </label>
      <label className="flex items-start gap-2 min-h-[44px] text-[15px] text-[#2C2420]">
        <input
          type="checkbox"
          className="mt-1 h-5 w-5 accent-[#B5845A]"
          checked={draft.bought}
          onChange={(e) => setDraft({ ...draft, bought: e.target.checked })}
        />
        <span>
          Bought, never made
          <span className="block text-sm text-[#6B5D52]">
            Every event shows it as Store bought with no recipe, whether or not a store is set on its Shopping list line.
          </span>
        </span>
      </label>
      {!draft.bought && (
        <>
          <label className={label}>
            Ingredients, one per line
            <textarea
              className={`${input} resize-y`}
              rows={Math.max(3, draft.ingredients.split("\n").length + 1)}
              value={draft.ingredients}
              onChange={set("ingredients")}
              placeholder={"1 cup sugar\n1 cup water"}
            />
          </label>
          <label className={label}>
            Ratio
            <input className={input} value={draft.ratio} onChange={set("ratio")} placeholder="1:1 sugar to water" />
          </label>
          <label className={label}>
            Method
            <textarea className={`${input} resize-y`} rows={3} value={draft.method} onChange={set("method")} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className={label}>
              Yield
              <input className={input} inputMode="decimal" value={draft.yieldAmount} onChange={set("yieldAmount")} placeholder="1.5" />
            </label>
            <label className={label}>
              Yield unit
              <input className={input} list="syrup-yield-units" value={draft.yieldUnit} onChange={set("yieldUnit")} />
              <datalist id="syrup-yield-units">
                <option value="cups" />
                <option value="oz" />
                <option value="ml" />
                <option value="liters" />
                <option value="quarts" />
              </datalist>
            </label>
          </div>
          <p className="text-xs text-[#6B5D52] -mt-1">
            A yield in cups, oz, ml, liters, quarts or gallons lets each event scale a batch to its Shopping list amount.
          </p>
          <label className={label}>
            Shelf life note
            <input className={input} value={draft.shelfLife} onChange={set("shelfLife")} placeholder="Keeps 2 weeks in the fridge" />
          </label>
        </>
      )}
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} onClick={onSave} className="min-h-[44px] rounded-xl bg-[#B5845A] px-5 text-white font-medium disabled:opacity-40">
          {busy ? "Saving..." : draft.bought ? "Save" : "Save recipe"}
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className="min-h-[44px] px-3 text-sm text-[#6B5D52] underline">
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function SyrupManager({ initial, addName }: { initial: SyrupRecipe[]; addName: string }) {
  const [syrups, setSyrups] = useState(initial);
  const [draft, setDraft] = useState<Draft | null>(addName ? empty(addName) : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const send = async (body: Record<string, unknown>): Promise<boolean> => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/team/admin/syrups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Could not save.");
      setSyrups(d.syrups);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    if (await send({ action: "save", ...draft, id: draft.id ?? undefined })) {
      setMessage(`${draft.name.trim()} saved.`);
      setDraft(null);
    }
  };

  // One tap from a Recipe needed link: the name is filled in, nothing to type.
  const markBought = async () => {
    if (!draft || !draft.name.trim()) return;
    if (await send({ action: "save", name: draft.name, aliases: draft.aliases, bought: true })) {
      setMessage(`${draft.name.trim()} marked bought, never made. Every event shows it as Store bought.`);
      setDraft(null);
    }
  };

  return (
    <div className="space-y-3">
      {message && <p className="rounded-2xl bg-[#E4EBDF] text-[#55684A] px-4 py-3 text-sm">{message}</p>}
      {draft && !draft.id ? (
        <section className={card}>
          <h2 className="font-heading text-base font-bold text-[#2C2420] mb-2">Add a recipe</h2>
          {addName && draft.name.trim() && (
            <div className="mb-3 rounded-xl border border-[#DDD5CC] bg-white px-3 py-3">
              <p className="text-sm text-[#6B5D52]">Never made in house? Clear Recipe needed without typing a recipe.</p>
              <button
                type="button"
                disabled={busy}
                onClick={markBought}
                className="mt-2 w-full min-h-[44px] rounded-xl border-2 border-[#B5845A] text-[#9A7049] font-medium hover:bg-[#F5F0EB] disabled:opacity-40"
              >
                Mark as bought, never made
              </button>
            </div>
          )}
          <Form draft={draft} setDraft={setDraft} busy={busy} onSave={save} onCancel={() => setDraft(null)} error={error} />
        </section>
      ) : (
        <button
          type="button"
          onClick={() => {
            setMessage("");
            setError("");
            setDraft(empty());
          }}
          className="w-full min-h-[44px] rounded-xl border-2 border-[#B5845A] text-[#9A7049] font-medium hover:bg-[#F5F0EB]"
        >
          Add a recipe
        </button>
      )}
      {syrups.length === 0 ? (
        <p className="px-1 text-[15px] text-[#6B5D52]">No recipes yet. Every syrup on an event shows Recipe needed until it is added here.</p>
      ) : (
        <ul className="space-y-3">
          {syrups.map((r) => (
            <li key={r.id} className={card}>
              {draft?.id === r.id ? (
                <Form draft={draft} setDraft={setDraft} busy={busy} onSave={save} onCancel={() => setDraft(null)} error={error} />
              ) : (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="font-heading text-base font-bold text-[#2C2420]">{r.name}</h2>
                      {r.aliases.length > 0 && <p className="text-sm text-[#6B5D52]">Also: {r.aliases.join(", ")}</p>}
                      {r.bought && <p className="text-sm font-medium text-[#55684A]">Bought, never made: Store bought on every event</p>}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setMessage("");
                          setError("");
                          setDraft(toDraft(r));
                        }}
                        className="min-h-[44px] min-w-[44px] rounded-lg px-2 text-sm font-medium text-[#9A7049] hover:bg-[#EDE6DF]"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={async () => {
                          if (!window.confirm(`Remove ${r.name}? Events that use it will show Recipe needed.`)) return;
                          if (await send({ action: "delete", id: r.id })) setMessage(`${r.name} removed.`);
                        }}
                        className="min-h-[44px] rounded-lg px-2 text-sm text-[#A0412D] hover:bg-[#EDE6DF] disabled:opacity-40"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  {!r.bought && (
                    <>
                      <ul className="mt-1 list-disc pl-5 text-sm text-[#2C2420]">
                        {r.ingredients.map((i, j) => (
                          <li key={j}>{ingredientText(i)}</li>
                        ))}
                      </ul>
                      <p className="mt-1 text-sm text-[#2C2420]">
                        {[r.ratio && `Ratio ${r.ratio}`, r.yieldAmount ? `Yield ${r.yieldAmount} ${r.yieldUnit}` : "No yield", r.shelfLife]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      {r.method && <p className="mt-1 text-sm text-[#6B5D52] whitespace-pre-wrap">{r.method}</p>}
                    </>
                  )}
                  {r.updatedBy && <p className="mt-1 text-xs text-[#A39585]">Last saved by {r.updatedBy}</p>}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
