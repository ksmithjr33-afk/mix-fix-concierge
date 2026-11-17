import Link from "next/link";
import { ALL_PACKAGES, LEGACY_LABEL, LEGACY_NOTE, NO_GUIDE, packageGuide, trainingHref } from "@/lib/packages-info";

const card = "rounded-2xl border border-[#DDD5CC] bg-[#F5F0EB] px-4 py-3 sm:px-5 sm:py-4";

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="text-xs text-[#A39585] uppercase tracking-wide">{title}</h3>
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

/**
 * The Package card on the event's Details tab, manager and bartender views,
 * built from lib/packages-info.ts. No prices: the guide has none, and the
 * manager view's price lives in its own header. A legacy package says so and
 * asks staff to confirm with a manager; an unknown one shows its name and
 * "No package guide yet".
 */
export default function PackageCard({ packageName }: { packageName: string }) {
  const g = packageGuide(packageName);
  if (!g) {
    return (
      <section className={card} aria-label="Package">
        <h2 className="font-heading text-lg font-bold text-[#2C2420]">Package{packageName ? `: ${packageName}` : ""}</h2>
        <p className="text-[15px] text-[#6B5D52]">{NO_GUIDE}</p>
      </section>
    );
  }
  return (
    <section className={`${card} space-y-2.5`} aria-label="Package" data-package={g.key}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="font-heading text-lg font-bold text-[#2C2420]">Package: {packageName || g.name}</h2>
        {g.legacy && <span className="text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#FFF8EC] text-[#8A4B12] border border-[#E3C9A0]">{LEGACY_LABEL}</span>}
        {g.note && <span className="text-sm text-[#6B5D52]">{g.note}</span>}
      </div>
      {g.legacy && <p className="text-[15px] font-medium text-[#8A4B12]">{LEGACY_NOTE}</p>}
      <p className="text-[15px] text-[#2C2420]">{g.summary}</p>
      <List title="We bring" items={g.weBring} />
      <List title="Client provides" items={g.clientProvides} />
      <List title="Not included" items={g.notIncluded} />
      <List title="Every package" items={ALL_PACKAGES} />
      <Link href={trainingHref(g.key)} className="inline-block text-sm font-medium text-[#B5845A] underline">
        Full package guide
      </Link>
    </section>
  );
}
