"use client";

import { useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense } from "react";

const PARAM_MAP: Record<string, string> = {
  n: "name",
  e: "email",
  d: "event_date",
  p: "package_type",
  g: "guest_count",
  ev: "event_name",
  h: "hours_booked",
};

function RedirectHandler() {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const sessionId = searchParams.get("id");

    if (sessionId) {
      // Session-based lookup
      fetch(`/api/get-session?id=${encodeURIComponent(sessionId)}`)
        .then((res) => {
          if (!res.ok) throw new Error("Session not found");
          return res.json();
        })
        .then((data) => {
          const chatParams = new URLSearchParams();
          for (const [key, value] of Object.entries(data)) {
            if (value) {
              chatParams.set(key, String(value));
            }
          }
          router.replace(`/chat?${chatParams.toString()}`);
        })
        .catch(() => {
          // Session not found, redirect to chat without params
          router.replace("/chat");
        });
      return;
    }

    // Fallback: short parameter keys in URL
    const chatParams = new URLSearchParams();
    for (const [shortKey, longKey] of Object.entries(PARAM_MAP)) {
      const raw = searchParams.get(shortKey);
      if (raw) {
        try {
          chatParams.set(longKey, decodeURIComponent(raw));
        } catch {
          chatParams.set(longKey, raw);
        }
      }
    }

    router.replace(`/chat?${chatParams.toString()}`);
  }, [searchParams, router]);

  return null;
}

export default function ShortRedirectPage() {
  return (
    <div className="min-h-dvh bg-[#E8DDD5] flex items-center justify-center px-4">
      <div className="text-center">
        <div className="animate-pulse">
          <img
            src="/logo.png"
            alt="The Mix Fix"
            className="h-10 mx-auto mb-4"
          />
          <p className="text-[#6B5D52] text-[15px]">
            Loading your concierge...
          </p>
        </div>
      </div>
      <Suspense>
        <RedirectHandler />
      </Suspense>
    </div>
  );
}
