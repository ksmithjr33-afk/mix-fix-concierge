"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const input =
  "w-full rounded-xl border border-[#DDD5CC] bg-[#F5F0EB] px-4 py-3 text-[16px] text-[#2C2420] placeholder:text-[#A39585] focus:outline-none focus:ring-2 focus:ring-[#B5845A]/30 focus:border-[#B5845A]";
const button =
  "w-full rounded-xl bg-[#B5845A] text-white py-3 font-medium disabled:opacity-40 hover:bg-[#9A7049] transition-colors";

export default function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const requestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/team/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      setMessage(data.message ?? "");
      setStep("code");
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/team/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code, next }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "That code did not work.");
        return;
      }
      router.replace(typeof data.redirect === "string" && data.redirect.startsWith("/team/") ? data.redirect : next);
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (step === "phone") {
    return (
      <form onSubmit={requestCode} className="space-y-3">
        <input
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="Phone number"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className={input}
          required
        />
        {error && <p className="text-sm text-[#A0412D]">{error}</p>}
        <button type="submit" disabled={busy || phone.replace(/\D/g, "").length < 10} className={button}>
          {busy ? "Sending..." : "Text me a code"}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={verify} className="space-y-3">
      {message && <p className="text-[15px] text-[#2C2420] bg-[#F5F0EB] border border-[#DDD5CC] rounded-xl px-4 py-3">{message}</p>}
      <input
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="6 digit code"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        className={`${input} tracking-[0.3em] text-center`}
        autoFocus
        required
      />
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
      <button type="submit" disabled={busy || code.length !== 6} className={button}>
        {busy ? "Checking..." : "Sign in"}
      </button>
      <button
        type="button"
        onClick={() => {
          setStep("phone");
          setCode("");
          setError("");
        }}
        className="w-full text-sm text-[#6B5D52] hover:text-[#B5845A] py-2"
      >
        Use a different number or send a new code
      </button>
    </form>
  );
}
