import { getCurrentStaff, getSignedInStaff } from "@/lib/team/auth";
import { unreadAnnouncements } from "@/lib/team/announcements-db";
import { trainingUnreadFor } from "@/lib/team/certs-db";
import { firstName } from "@/lib/team/event-view";
import { headerLinks } from "@/lib/team/header-nav";
import HeaderNav from "./header-nav";
import { isAdminRole } from "@/lib/team/roles";

/**
 * Header shared by the team pages: logo, admin links for admins, the
 * Announcements link with an unread count, the Bartender view switch for
 * admins, and a sign out button when signed in. In Bartender view the admin
 * links are gone and a banner offers the way back. The chat icon shows
 * unread team chat messages on every page, with a pop up for new ones.
 *
 * This part reads who is signed in and the counts; the layout (one row with a
 * Menu panel on phones, inline links and a name dropdown from 768px) is in
 * ./header-nav.tsx and the links themselves in lib/team/header-nav.ts.
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
  const showAdmin = admin && !bartenderView && isAdminRole(viewed?.role);
  const canSwitch = isAdminRole(real?.role) && !bartenderView;
  const canSwitchBack = isAdminRole(real?.role) && bartenderView;
  const [unread, training] = viewed ? await Promise.all([unreadAnnouncements(viewed.id).catch(() => 0), trainingUnreadFor(viewed.id).catch(() => 0)]) : [0, 0];
  const links = headerLinks(showAdmin, { unreadNews: unread, training });
  const name = real?.name ?? viewed?.name ?? "";
  return (
    <>
      {bartenderView && (
        <div className="flex items-center justify-between gap-3 px-3 sm:px-4 py-2 bg-[#2C2420] text-white print:hidden">
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
      <HeaderNav
        signedIn={signedIn}
        firstName={firstName(name) || name}
        links={links}
        back={back}
        canSwitch={canSwitch}
        canSwitchBack={canSwitchBack}
        showChat={!!viewed}
        // alert={<RunningLowAlert />} goes here next: the open slot beside the chat icon.
      />
    </>
  );
}
