// The tier as a small badge. Admins and managers only (never rendered on staff pages).
const TONE: Record<string, string> = {
  Ace: "bg-[#E4EBDF] text-[#3F5A33]",
  Solid: "bg-[#E3E8EE] text-[#3F5468]",
  Coach: "bg-[#F6E3DC] text-[#A0412D]",
  New: "bg-[#E8DDD5] text-[#6B5D52]",
};

export default function TierBadge({ tier, title }: { tier: string; title?: string }) {
  return (
    <span title={title} className={`inline-block shrink-0 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded align-middle ${TONE[tier] ?? TONE.New}`}>
      {tier}
    </span>
  );
}
