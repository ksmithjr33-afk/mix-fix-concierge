import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";

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

  let data: Record<string, unknown> | null = null;
  let failed = false;

  try {
    const { data: row, error } = await supabase
      .from("sessions")
      .select(
        "name, email, event_date, package_type, guest_count, event_name, hours_booked"
      )
      .eq("id", sessionId)
      .single();

    if (error || !row) {
      failed = true;
    } else {
      data = row;
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

  // Build redirect URL with all session parameters
  const chatParams = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) {
    if (value != null && value !== "") {
      chatParams.set(key, String(value));
    }
  }

  redirect(`/chat?${chatParams.toString()}`);
}
