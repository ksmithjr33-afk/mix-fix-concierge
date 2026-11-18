import Link from "next/link";

/** The partner portal header. Nothing here links into the team portal. */
export default function PartnerHeader({ signedIn, name }: { signedIn: boolean; name?: string }) {
  return (
    <header className="flex items-center justify-between gap-3 px-3 sm:px-4 py-2 sm:py-3 bg-[#F5F0EB] border-b border-[#DDD5CC]">
      <Link href="/partners" className="flex items-center gap-2 min-w-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="The Mix Fix" className="h-8 sm:h-10" />
        <span className="text-sm text-[#6B5D52] truncate">Partner portal</span>
      </Link>
      {signedIn && (
        <div className="flex items-center gap-3 text-sm shrink-0">
          {name !== undefined && (
            <Link href="/partners/profile" className="text-[#6B5D52] hover:text-[#B5845A]">
              {name || "Profile"}
            </Link>
          )}
          <form action="/api/partners/logout" method="post">
            <button type="submit" className="text-[#6B5D52] hover:text-[#B5845A] underline">
              Sign out
            </button>
          </form>
        </div>
      )}
    </header>
  );
}
