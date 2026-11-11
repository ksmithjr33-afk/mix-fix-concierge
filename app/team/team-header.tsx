import Link from "next/link";
import { getCurrentStaff, getSignedInStaff } from "@/lib/team/auth";
import { unreadAnnouncements } from "@/lib/team/announcements-db";

/**
 * Header shared by the team pages: logo, admin links for admins, the
 * Announcements link with an unread count, the Bartender view switch for
 * admins, and a sign out button when signed in. In Bartender view the admin
 * links are gone and a banner offers the way back.
 */
export default async function TeamHeader({
  signedIn,
  back,
  admin = false,
}: {
  signedIn: boolean;
  back?: { href: string; label: string };
  admin?: boolean;
}) {
  const [viewed, real] = signedIn ? await Promise.all([getCurrentStaff().catch(() => null), getSignedInStaff().catch(() => null)]) : [null, null];
  const bartenderView = !!viewed?.bartenderView;
  const showAdmin = admin && !bartenderView && viewed?.role === "admin";
  const canSwitch = real?.role === "admin" && !bartenderView;
  const unread = viewed ? await unreadAnnouncements(viewed.id).catch(() => 0) : 0;
  return (
    <>
      {bartenderView && (
        <div className="flex items-center justify-between gap-3 px-3 sm:px-4 py-2 bg-[#2C2420] text-white">
          <p className="text-sm">
            <span className="font-bold">Bartender view.</span> <span className="text-white/80">You see the portal as a bartender does.</span>
          </p>
          <form action="/api/team/view" method="post" className="shrink-0">
            <input type="hidden" name="mode" value="admin" />
            <button type="submit" className="rounded-lg bg-[#F5F0EB] text-[#2C2420] px-3 py-1 text-sm font-medium">
              Switch back
            </button>
          </form>
        </div>
      )}
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
          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 sm:gap-x-4 shrink-0">
            {showAdmin && (
              <>
                <Link href="/team/admin/events" className="text-xs sm:text-sm font-medium text-[#9A7049] hover:text-[#B5845A]">
                  Staffing
                </Link>
                <Link href="/team/admin/staff" className="text-xs sm:text-sm font-medium text-[#9A7049] hover:text-[#B5845A]">
                  Staff
                </Link>
                <Link href="/team/admin/timesheets" className="text-xs sm:text-sm font-medium text-[#9A7049] hover:text-[#B5845A]">
                  Time
                </Link>
              </>
            )}
            <Link href="/team/me" className="text-xs sm:text-sm font-medium text-[#9A7049] hover:text-[#B5845A]">
              Me
            </Link>
            <Link href="/team/announcements" className="text-xs sm:text-sm font-medium text-[#9A7049] hover:text-[#B5845A]">
              <span className="hidden sm:inline">Announcements</span>
              <span className="sm:hidden">News</span>
              {unread > 0 && (
                <span className="ml-1 inline-block min-w-[1.25rem] rounded-full bg-[#A0412D] px-1.5 text-center text-[11px] font-bold text-white" aria-label={`${unread} unread`}>
                  {unread}
                </span>
              )}
            </Link>
            {canSwitch && (
              <form action="/api/team/view" method="post">
                <input type="hidden" name="mode" value="bartender" />
                <button type="submit" className="text-xs sm:text-sm text-[#6B5D52] hover:text-[#B5845A] underline">
                  Bartender view
                </button>
              </form>
            )}
            <form action="/api/team/logout" method="post">
              <button type="submit" className="text-xs text-[#6B5D52] hover:text-[#B5845A]">
                Sign out
              </button>
            </form>
          </div>
        )}
      </header>
    </>
  );
}
