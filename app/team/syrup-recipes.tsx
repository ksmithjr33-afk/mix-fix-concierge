// The Syrup recipes section: every house made syrup or prep item this event's
// drinks use, with its recipe and a batch scaled to the Shopping list amount,
// "Store bought" when its line has a store or the library marks it bought,
// never made, or "Recipe needed" when the
// library has none. Shown on the admin Shopping list (after the cocktail
// recipes, and on the printed page) and on the bartender Supplies tab (after
// the drinks). Never on the client's list. No state, so both server and client
// components can render it. lib/syrups.ts builds what it shows.

import type { SyrupView } from "@/lib/syrups";
import { addRecipeHref } from "@/lib/syrups";

export const SYRUP_TITLE = "Syrup recipes";

/** One syrup's recipe, Store bought, or Recipe needed (with a link to add it for admins). */
export function SyrupBody({ s, variant, isAdmin }: { s: SyrupView; variant: "sheet" | "card"; isAdmin: boolean }) {
  const muted = variant === "sheet" ? "text-[#555]" : "text-[#6B5D52]";
  const list = variant === "sheet" ? "list-disc pl-[1.75em]" : "list-disc pl-5 text-sm text-[#2C2420] space-y-0.5";
  const para = variant === "sheet" ? "pl-[1.75em]" : "text-sm text-[#2C2420]";
  if (s.status === "store") return <p className={`${para} ${muted}`}>Store bought{s.storeName ? ` (${s.storeName})` : ""}. No recipe needed.</p>;
  if (s.status === "needed")
    return (
      <p className={`${para} font-medium text-[#A0412D]`}>
        Recipe needed.{" "}
        {isAdmin ? (
          <a href={addRecipeHref(s.name)} className="underline print:no-underline">
            Add a recipe or mark it bought
          </a>
        ) : (
          <span className={`font-normal ${muted}`}>Ask a manager.</span>
        )}
      </p>
    );
  const r = s.recipe!;
  return (
    <>
      <ul className={list}>
        {r.ingredients.map((x, j) => (
          <li key={j}>{x}</li>
        ))}
      </ul>
      {r.ratio && (
        <p className={para}>
          <b>Ratio:</b> {r.ratio}
        </p>
      )}
      {r.method && (
        <p className={`${para} whitespace-pre-wrap`}>
          <b>Method:</b> {r.method}
        </p>
      )}
      {r.yield && (
        <p className={para}>
          <b>Yield:</b> {r.yield}
        </p>
      )}
      {r.shelfLife && (
        <p className={para}>
          <b>Shelf life:</b> {r.shelfLife}
        </p>
      )}
      {s.batch ? (
        <div className={para}>
          <p>
            <b>Batch for this event:</b> makes about {s.batch.makes}, for {s.batch.from}
          </p>
          <ul className={list}>
            {s.batch.ingredients.map((x, j) => (
              <li key={j}>{x}</li>
            ))}
          </ul>
        </div>
      ) : (
        s.batchNote && <p className={`${para} ${muted}`}>{s.batchNote}</p>
      )}
    </>
  );
}

/** The bartender Supplies tab's card. */
export function SyrupCard({ syrups }: { syrups: SyrupView[] }) {
  if (syrups.length === 0) return null;
  return (
    <section className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 sm:px-5 sm:py-4" aria-label={SYRUP_TITLE}>
      <h3 className="font-heading text-base font-bold text-[#2C2420] mb-1">{SYRUP_TITLE}</h3>
      <ul className="divide-y divide-[#DDD5CC]">
        {syrups.map((s) => (
          <li key={s.key} className="py-2 space-y-1">
            <p className="font-medium text-[#2C2420]">
              {s.name}
              {s.drinks.length > 0 && <span className="text-sm font-normal text-[#6B5D52]"> · for {s.drinks.join(", ")}</span>}
            </p>
            <SyrupBody s={s} variant="card" isAdmin={false} />
          </li>
        ))}
      </ul>
    </section>
  );
}
