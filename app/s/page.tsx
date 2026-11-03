import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { SESSION_COLUMNS, type SessionRow } from "@/lib/event-updates";
import UpdateMode from "./update-mode";

// The booking fields /chat takes as query params for intake.
const INTAKE_PARAMS = [
  "name",
  "email",
  "event_date",
  "package_type",
  "guest_count",
  "event_name",
  "hours_booked",
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
      .select(SESSION_COLUMNS)
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

  // Submitted sessions open in update mode: chat on top, event summary below.
  if (data.status === "submitted" && data.event_data) {
    const { data: log } = await supabase
      .from("conversation_logs")
      .select("update_messages")
      .eq("session_id", sessionId)
      .maybeSingle();
    return (
      <UpdateMode
        sessionId={sessionId}
        clientName={(data.event_data.client_name as string) || data.name}
        initialEventData={data.event_data}
        initialVersion={data.version}
        initialUpdatedAt={data.updated_at ?? data.submitted_at}
        initialMessages={Array.isArray(log?.update_messages) ? log.update_messages : []}
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
