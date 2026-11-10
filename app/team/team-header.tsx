import Link from "next/link";

/** Header shared by the team pages: logo, and a sign out button when signed in. */
export default function TeamHeader({ signedIn, back }: { signedIn: boolean; back?: { href: string; label: string } }) {
  return (
    <header className="flex items-center justify-between gap-3 px-3 sm:px-4 py-2 sm:py-3 bg-[#F5F0EB] border-b border-[#DDD5CC]">
      <div className="flex items-center gap-3 min-w-0">
        <img src="/logo.png" alt="The Mix Fix" className="h-8 sm:h-10 shrink-0" />
        {back && (
          <Link href={back.href} className="text-sm text-[#6B5D52] hover:text-[#B5845A] truncate">
            {back.label}
          </Link>
        )}
      </div>
      {signedIn && (
        <form action="/api/team/logout" method="post">
          <button type="submit" className="text-xs text-[#6B5D52] hover:text-[#B5845A]">
            Sign out
          </button>
        </form>
      )}
    </header>
  );
}
