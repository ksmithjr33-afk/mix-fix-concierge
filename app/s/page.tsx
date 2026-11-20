import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { SessionRow } from "@/lib/event-updates";
import UpdateMode from "./update-mode";
import { barbackStatus, extrasOf } from "@/lib/package-extras";
import { clientCanSeeList, holdsFor } from "@/lib/client-list-db";
import { recordClientOpen } from "@/lib/client-links";
import { clientMenu } from "@/lib/team/approved-menu-db";
import PlannersCard from "./planners-card";
import { clientPlannersCard, clientLinkBlocked } from "@/lib/partners/client-view";
import { surpriseOn, type EventSession } from "@/lib/partners/db";
import { SURPRISE_LABEL } from "@/lib/partners/surprise";

// The booking fields /chat takes as query params for intake.
const INTAKE_PARAMS = [
  "name",
  "email",
  "event_date",
  "package_type",
  "guest_count",
  "event_name",
  "hours_booked",
  "event_type",
  "bar_service_start",
  "bartender_count",
] as const;

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ShortRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const sessionId = typeof params.id === "string" ? params.id : undefined;

  if (!sessionId) {
    return (
      <div className="min-h-dvh bg-[#E8DDD5] flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-[#6B5D52] text-[15px]">
            Something went wrong. Please text us at{" "}
            <a href="sms:4697548512" className="underline">
              469 754 8512
            </a>{" "}
            and we will get you started.
          </p>
        </div>
      </div>
    );
  }

  let data: SessionRow | null = null;
  let failed = false;

  try {
    const { data: row, error } = await supabase
      .from("sessions")
      // "*": the booking columns from 20261215 may not exist yet, and naming them would fail the read.
      .select("*")
      .eq("id", sessionId)
      .single();

    if (error || !row) {
      failed = true;
    } else {
      data = row as SessionRow;
    }
  } catch {
    failed = true;
  }

  if (failed || !data) {
    return (
      <div className="min-h-dvh bg-[#E8DDD5] flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-[#6B5D52] text-[15px]">
            Something went wrong. Please text us at{" "}
            <a href="sms:4697548512" className="underline">
              469 754 8512
            </a>{" "}
            and we will get you started.
          </p>
        </div>
      </div>
    );
  }

  // A planner held event whose booking contact (a planner) was removed or deactivated: their old link no longer opens it.
  if (await clientLinkBlocked(data).catch(() => false)) {
    return (
      <div className="min-h-dvh bg-[#E8DDD5] flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <p className="text-[#6B5D52] text-[15px]">
            This link is no longer active. Questions? Text us at{" "}
            <a href="sms:4697548512" className="underline">
              469 754 8512
            </a>
            .
          </p>
        </div>
      </div>
    );
  }

  // When the client last opened their link, for the manager view. An admin's Open button adds admin=1.
  if (params.admin !== "1") await recordClientOpen(sessionId).catch(() => {});

  // Submitted sessions open in update mode: chat on top, event summary below.
  if (data.status === "submitted" && data.event_data) {
    const [{ data: log }, showList, pending, menu, planners] = await Promise.all([
      supabase.from("conversation_logs").select("update_messages").eq("session_id", sessionId).maybeSingle(),
      clientCanSeeList(sessionId).catch(() => false),
      holdsFor(sessionId, "pending").catch(() => []),
      clientMenu(sessionId).catch(() => null),
      // Client held events only; null before the partners migration, so nothing shows.
      clientPlannersCard(data).catch(() => null),
    ]);
    return (
      <UpdateMode
        sessionId={sessionId}
        clientName={(data.event_data.client_name as string) || data.name}
        initialEventData={data.event_data}
        initialVersion={data.version}
        initialUpdatedAt={data.updated_at ?? data.submitted_at}
        initialMessages={Array.isArray(log?.update_messages) ? log.update_messages : []}
        showList={showList}
        listPending={pending.some((h) => h.kind === "change")}
        menu={menu}
        cups={extrasOf(data).cups_included === true}
        noBarback={barbackStatus(data).notBooked}
        extra={
          <>
            {/* The booking holder sees that it is a surprise. */}
            {surpriseOn(data as EventSession) && (
              <p className="inline-block text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#EDE3F5] text-[#5B3F7A]">{SURPRISE_LABEL}</p>
            )}
            {planners ? <PlannersCard sessionId={sessionId} planners={planners.planners} pricingOn={planners.pricingOn} activity={planners.activity} /> : null}
          </>
        }
      />
    );
  }

  // Build redirect URL with all session parameters
  const chatParams = new URLSearchParams();
  chatParams.set("session_id", sessionId);
  for (const key of INTAKE_PARAMS) {
    const value = data[key];
    if (value != null && value !== "") {
      chatParams.set(key, String(value));
    }
  }

  redirect(`/chat?${chatParams.toString()}`);
}
