"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { resizePhoto } from "../e/[id]/bar-ready";

const field = "w-full rounded-xl border border-[#DDD5CC] bg-[#E8DDD5] px-3.5 py-2.5 text-[16px] text-[#2C2420] focus:outline-none focus:ring-2 focus:ring-[#B5845A]/30";

/** Upload a certificate: a photo or PDF and its expiry date. Admins pass staffId to enter one for someone. */
export default function CertUpload({ certTypes, defaultType, today, staffId, button = "Upload certification" }: { certTypes: string[]; defaultType: string; today: string; staffId?: string; button?: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [certType, setCertType] = useState(defaultType);
  const [expiresOn, setExpiresOn] = useState("");
  const [file, setFile] = useState<Blob | null>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setFileName(f.name);
    setFile(f.type.startsWith("image/") ? await resizePhoto(f) : f);
  };

  const send = async () => {
    setError("");
    setDone("");
    if (!expiresOn) return setError("Enter the expiry date.");
    if (!file) return setError("Add a photo or PDF of the certificate.");
    setBusy(true);
    try {
      const form = new FormData();
      form.set("certType", certType);
      form.set("expiresOn", expiresOn);
      if (staffId) form.set("staffId", staffId);
      form.set("file", file, file.type === "application/pdf" ? "certificate.pdf" : "certificate.jpg");
      const res = await fetch("/api/team/certs", { method: "POST", body: form });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "The file did not upload. Tap Retry.");
      setDone(d.status === "approved" ? "Saved and approved." : "Uploaded. An admin will review it.");
      setFile(null);
      setFileName("");
      setExpiresOn("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error && !(err instanceof TypeError) ? err.message : "The file did not upload. Check your signal and tap Retry.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {certTypes.length > 1 && (
        <label className="block">
          <span className="text-sm font-medium text-[#2C2420]">Certification</span>
          <select value={certType} onChange={(e) => setCertType(e.target.value)} className={`${field} mt-1`}>
            {certTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block">
        <span className="text-sm font-medium text-[#2C2420]">Expiry date</span>
        <input type="date" min={today} value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} className={`${field} mt-1`} />
      </label>
      <input ref={fileRef} type="file" accept="image/*,application/pdf" onChange={pick} className="hidden" />
      <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="w-full rounded-xl border border-[#B5845A] text-[#9A7049] py-2.5 text-sm font-medium disabled:opacity-40">
        {fileName ? `Chosen: ${fileName}` : "Choose a photo or PDF"}
      </button>
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
      {done && <p className="text-sm text-[#55684A]">{done}</p>}
      <button type="button" onClick={send} disabled={busy} className="w-full rounded-xl bg-[#B5845A] text-white py-3 font-medium disabled:opacity-40 hover:bg-[#9A7049] transition-colors">
        {busy ? "Uploading..." : button}
      </button>
    </div>
  );
}
