import Link from "next/link";

/** The Running low icon in the header for admins and managers, with the count of reports nobody has taken yet. */
export default function RunningLowAlert({ open }: { open: number }) {
  return (
    <Link
      href="/team/admin/running-low"
      className="relative flex items-center text-[#9A7049] hover:text-[#B5845A] p-1"
      aria-label={open ? `Running low, ${open} open` : "Running low"}
      title="Running low"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 8l8 -4 8 4v8l-8 4 -8 -4z" />
        <path d="M4 8l8 4 8 -4M12 12v8" />
      </svg>
      {open > 0 && (
        <span className="absolute -right-1.5 -top-1 min-w-[1.25rem] rounded-full bg-[#A0412D] px-1 text-center text-[11px] font-bold leading-[1.25rem] text-white">{open > 99 ? "99+" : open}</span>
      )}
    </Link>
  );
}
