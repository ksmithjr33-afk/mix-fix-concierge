import Link from "next/link";

/** Header shared by the team pages: logo, admin links for admins, and a sign out button when signed in. */
export default function TeamHeader({
  signedIn,
  back,
  admin = false,
}: {
  signedIn: boolean;
  back?: { href: string; label: string };
  admin?: boolean;
}) {
  return (
    <header className="flex items-center justify-between gap-3 px-3 sm:px-4 py-2 sm:py-3 bg-[#F5F0EB] border-b border-[#DDD5CC]">
      <div className="flex items-center gap-3 min-w-0">
        <Link href="/team/events" className="shrink-0">
          <img src="/logo.png" alt="The Mix Fix" className="h-8 sm:h-10" />
        </Link>
        {back && (
          <Link href={back.href} className="text-sm text-[#6B5D52] hover:text-[#B5845A] truncate">
            {back.label}
          </Link>
        )}
      </div>
      {signedIn && (
        <div className="flex items-center gap-3 sm:gap-4 shrink-0">
          {admin && (
            <>
              <Link href="/team/admin/events" className="text-xs sm:text-sm font-medium text-[#9A7049] hover:text-[#B5845A]">
                Staffing
              </Link>
              <Link href="/team/admin/staff" className="text-xs sm:text-sm font-medium text-[#9A7049] hover:text-[#B5845A]">
                Staff
              </Link>
            </>
          )}
          <form action="/api/team/logout" method="post">
            <button type="submit" className="text-xs text-[#6B5D52] hover:text-[#B5845A]">
              Sign out
            </button>
          </form>
        </div>
      )}
    </header>
  );
}
