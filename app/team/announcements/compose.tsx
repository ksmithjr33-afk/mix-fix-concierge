"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AttachControls, useAttachment } from "../attach-picker";
import { AUTOSAVE_MS, OPEN_DRAFT_KEY, draftTitle, draftToResume, firstLine } from "@/lib/team/announcement-drafts-view";
import type { DraftConflict, DraftItem } from "@/lib/team/announcement-drafts-db";

type Who = "everyone" | "markets";

const DRAFTS_API = "/api/team/admin/announcements/drafts";

function clock(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" }).format(new Date(iso)).replace(/[  ]/g, " ");
}
function when(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso)).replace(/[  ]/g, " ");
}

// Browser storage can be blocked (private windows); the form works without it.
const remember = (id: string | null) => {
  try {
    if (id) localStorage.setItem(OPEN_DRAFT_KEY, id);
    else localStorage.removeItem(OPEN_DRAFT_KEY);
  } catch {
    /* storage blocked */
  }
};
const remembered = (): string | null => {
  try {
    return localStorage.getItem(OPEN_DRAFT_KEY);
  } catch {
    return null;
  }
};

interface Snapshot {
  title: string;
  body: string;
  audience: Who;
  markets: string[];
  bartendersOnly: boolean;
  sendNow: boolean;
  attachmentId: string | null;
}
const key = (s: Snapshot) => JSON.stringify(s);
const isEmpty = (s: Snapshot) => !s.title.trim() && !s.body.trim() && !s.attachmentId;

async function post(body: Record<string, unknown>) {
  const res = await fetch(DRAFTS_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  return { res, d };
}

function sentMessage(d: { recipients: number; texted: number; held: number }): string {
  return (
    `Sent to ${d.recipients} ${d.recipients === 1 ? "person" : "people"}. ${d.texted} ${d.texted === 1 ? "text" : "texts"} sent` +
    (d.held ? `, ${d.held} held for quiet hours and sent at 8:00 AM their time.` : ".")
  );
}

/**
 * Admins and managers write an announcement: title, message, who gets it, and
 * whether to skip quiet hours. It saves itself as a draft a few seconds after
 * they stop typing. Drafts are listed below the form, for admins and managers
 * only, and any of them can edit, send or delete any draft.
 */
export default function Compose({
  markets,
  gifSearch = false,
  drafts,
  me,
}: {
  markets: { id: string; label: string }[];
  gifSearch?: boolean;
  drafts: DraftItem[];
  me: string;
}) {
  const router = useRouter();
  const att = useAttachment("announcement");
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [who, setWho] = useState<Who>("everyone");
  const [picked, setPicked] = useState<string[]>([]);
  const [bartendersOnly, setBartendersOnly] = useState(false);
  const [sendNow, setSendNow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [notice, setNotice] = useState<{ text: string; href?: string } | null>(null);

  // The draft behind the form.
  const [draftId, setDraftId] = useState<string | null>(null);
  const [author, setAuthor] = useState<{ id: string | null; name: string } | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<DraftConflict | null>(null);
  const [draftsOff, setDraftsOff] = useState(false); // before the migration runs
  const base = useRef<string | null>(null); // the version this writer last loaded or saved
  const stored = useRef(false); // a draft row exists for draftId
  const lastSaved = useRef<string>("");
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  const snap: Snapshot = { title, body, audience: who, markets: who === "markets" ? picked : [], bartendersOnly, sendNow, attachmentId: att.pending?.id ?? null };
  const snapKey = key(snap);
  const latest = useRef({ snap, draftId, conflict, draftsOff });
  latest.current = { snap, draftId, conflict, draftsOff };

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const ready = title.trim() && body.trim() && (who === "everyone" || picked.length > 0);

  type SaveResult = "saved" | "skipped" | "conflict" | "off" | "error";

  /** Save the form as a draft. One save at a time, in order. */
  const save = useCallback((o: { auto?: boolean; force?: boolean } = {}): Promise<SaveResult> => {
    const run = async (): Promise<SaveResult> => {
      const { snap: s, draftId: id, conflict: c, draftsOff: off } = latest.current;
      if (!id) return "skipped";
      if (off && o.auto) return "off";
      if (c && !o.force) return "conflict";
      if (!stored.current && isEmpty(s)) {
        if (!o.auto) setError("Write something first.");
        return "skipped";
      }
      if (stored.current && key(s) === lastSaved.current && !o.force) return "saved";
      setSaving(true);
      try {
        const { res, d } = await post({ action: "save", id, ...s, baseUpdatedAt: base.current, force: o.force === true });
        if (res.ok) {
          base.current = d.updatedAt;
          stored.current = true;
          lastSaved.current = key(s);
          setSavedAt(d.updatedAt);
          setConflict(null);
          remember(id);
          if (!o.auto) setError("");
          return "saved";
        }
        if (res.status === 409 && d.conflict) {
          setConflict(d.conflict);
          return "conflict";
        }
        if (res.status === 503) {
          setDraftsOff(true);
          if (!o.auto) setError(d.error ?? "Drafts are not set up yet.");
          return "off";
        }
        if (res.status === 410) remember(null);
        if (!o.auto || res.status === 410) setError(d.error ?? "Could not save the draft.");
        return "error";
      } catch {
        if (!o.auto) setError("Could not save the draft. Check your connection.");
        return "error";
      } finally {
        setSaving(false);
      }
    };
    const p = chain.current.then(run, run);
    chain.current = p;
    return p;
  }, []);

  // Autosave a few seconds after the last change.
  useEffect(() => {
    if (!open || !draftId || conflict || draftsOff) return;
    if (snapKey === lastSaved.current) return;
    const t = setTimeout(() => void save({ auto: true }), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [open, draftId, conflict, draftsOff, snapKey, save]);

  // Leaving the page: save what is not saved yet. Same id and same newer edit check on the server.
  useEffect(() => {
    if (!open) return;
    const flush = () => {
      const { snap: s, draftId: id, conflict: c, draftsOff: off } = latest.current;
      if (!id || c || off || key(s) === lastSaved.current || (!stored.current && isEmpty(s))) return;
      const blob = new Blob([JSON.stringify({ action: "save", id, ...s, baseUpdatedAt: base.current })], { type: "application/json" });
      if (navigator.sendBeacon?.(DRAFTS_API, blob)) remember(id);
    };
    const onHide = () => document.visibilityState === "hidden" && flush();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [open]);

  const fill = useCallback(
    (d: DraftItem | null) => {
      const s: Snapshot = d
        ? { title: d.title, body: d.body, audience: d.audience, markets: d.audience === "markets" ? d.markets : [], bartendersOnly: d.bartendersOnly, sendNow: d.sendNow, attachmentId: d.attachment?.id ?? null }
        : { title: "", body: "", audience: "everyone", markets: [], bartendersOnly: false, sendNow: false, attachmentId: null };
      setTitle(s.title);
      setBody(s.body);
      setWho(s.audience);
      setPicked(s.markets);
      setBartendersOnly(s.bartendersOnly);
      setSendNow(s.sendNow);
      att.restore(d?.attachment ? { id: d.attachment.id, kind: d.attachment.kind, preview: d.attachment.url } : null);
      lastSaved.current = key(s);
      base.current = d?.updatedAt ?? null;
      stored.current = !!d;
      setSavedAt(d?.updatedAt ?? null);
      setDraftId(d?.id ?? crypto.randomUUID());
      setAuthor(d ? { id: d.createdBy, name: d.authorName } : { id: me, name: "you" });
      setConflict(null);
      setError("");
      setNotice(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [me]
  );

  const startNew = () => {
    fill(null);
    setDone("");
    setOpen(true);
  };

  const edit = async (d: DraftItem) => {
    if (open) await save({ auto: true });
    fill(d);
    setDone("");
    setOpen(true);
    remember(d.id);
  };

  // Coming back to the page reopens the draft that was open.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    const id = remembered();
    const d = draftToResume(id, drafts);
    if (d) {
      fill(d);
      setOpen(true);
    } else if (id) remember(null);
  }, [drafts, fill]);

  const close = (message = "") => {
    remember(null);
    setOpen(false);
    setDraftId(null);
    setConflict(null);
    setDone(message);
    att.clear();
  };

  const othersDraft = (createdBy: string | null) => !!createdBy && createdBy !== me;

  const sendDraft = async (id: string, baseUpdatedAt: string | null, createdBy: string | null, authorName: string) => {
    const confirmOthers = othersDraft(createdBy);
    if (confirmOthers && !window.confirm(`${authorName} wrote this draft. Send it to staff now?`)) return null;
    const { res, d } = await post({ action: "send", id, baseUpdatedAt, confirmOthers });
    if (!res.ok) {
      if (res.status === 409 && d.conflict && open && id === draftId) setConflict(d.conflict);
      throw new Error(d.error ?? "Could not send.");
    }
    return d as { recipients: number; texted: number; held: number };
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || busy || att.busy || conflict) return;
    setBusy(true);
    setError("");
    setDone("");
    setNotice(null);
    try {
      const saved = await save();
      if (saved === "conflict") return;
      if (saved === "saved") {
        const d = await sendDraft(draftId!, base.current, author?.id ?? me, author?.name ?? "Someone else");
        if (!d) return;
        setTitle("");
        setBody("");
        close(sentMessage(d));
        router.refresh();
        return;
      }
      if (saved !== "off") return; // the save error is already shown
      // Drafts are not set up yet: send the way it always worked.
      setError("");
      const res = await fetch("/api/team/admin/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body, markets: who === "markets" ? picked : [], bartendersOnly, sendNow, ...(att.pending ? { attachmentId: att.pending.id } : {}) }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Could not send.");
      setTitle("");
      setBody("");
      close(sentMessage(d));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send.");
    } finally {
      setBusy(false);
    }
  };

  const saveNow = async () => {
    setNotice(null);
    const r = await save();
    if (r === "saved") router.refresh();
  };

  const testToMe = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice(null);
    try {
      const saved = await save();
      if (saved === "off") return;
      if (saved !== "saved") return;
      const { res, d } = await post({ action: "test", id: draftId });
      if (!res.ok) throw new Error(d.error ?? "Could not send the test.");
      setNotice({ text: "Test sent to your phone only. Nobody else got it, and it is still a draft.", href: `/team/announcements/drafts/${draftId}` });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the test.");
    } finally {
      setBusy(false);
    }
  };

  const loadTheirs = () => {
    if (!conflict) return;
    fill(conflict.draft);
  };
  const keepMine = async () => {
    if (!conflict) return;
    if (!window.confirm(`Replace the version ${conflict.by} saved at ${clock(conflict.at)} with yours?`)) return;
    const r = await save({ force: true });
    if (r === "saved") router.refresh();
  };

  const field = "w-full rounded-xl border border-[#DDD5CC] bg-white px-3 py-2 text-[16px] text-[#2C2420] focus:outline-none focus:ring-2 focus:ring-[#B5845A]/30 focus:border-[#B5845A]";
  const editingDraft = open && !!savedAt;
  const listed = drafts.filter((d) => !(open && d.id === draftId));

  return (
    <>
      {!open ? (
        <div className="px-1 space-y-2">
          <button type="button" onClick={startNew} className="rounded-lg bg-[#2C2420] text-white px-4 py-2 text-sm font-medium">
            New announcement
          </button>
          {done && <p className="text-sm text-[#55684A]">{done}</p>}
        </div>
      ) : (
        <form onSubmit={submit} className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-4 space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-heading text-lg font-bold text-[#2C2420]">{editingDraft ? "Edit draft" : "New announcement"}</h2>
            <span className="text-xs text-[#A39585]" aria-live="polite">
              {saving ? "Saving..." : savedAt ? `Saved ${clock(savedAt)}` : draftsOff ? "Autosave is off until drafts are set up" : ""}
            </span>
          </div>
          {author && author.id && author.id !== me && (
            <p className="text-sm text-[#6B5D52]">
              Written by <span className="font-medium text-[#2C2420]">{author.name}</span>
            </p>
          )}
          {conflict && (
            <div role="alert" className="rounded-xl border border-[#E3B9AC] bg-[#F6E3DC] px-3 py-2 space-y-2">
              <p className="text-sm text-[#A0412D]">
                {conflict.by} saved this draft at {clock(conflict.at)}, after you opened it. Autosave is paused so their changes are not lost.
              </p>
              <div className="flex flex-wrap gap-3">
                <button type="button" onClick={loadTheirs} className="rounded-lg bg-[#2C2420] text-white px-3 py-1.5 text-sm font-medium">
                  Load their version
                </button>
                <button type="button" onClick={keepMine} className="text-sm text-[#A0412D] underline">
                  Keep mine instead
                </button>
              </div>
            </div>
          )}
          <label className="block space-y-1">
            <span className="text-sm font-medium text-[#2C2420]">Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className={field} />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-[#2C2420]">Message</span>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} onPaste={att.onPaste} rows={5} maxLength={2000} className={field} />
          </label>
          <div className="space-y-1">
            <span className="text-sm font-medium text-[#2C2420]">Picture or GIF (optional, one)</span>
            <AttachControls att={att} gifSearch={gifSearch} />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-[#2C2420]">Send to</legend>
            <label className="flex items-center gap-2 text-[15px] text-[#2C2420]">
              <input type="radio" name="who" checked={who === "everyone"} onChange={() => setWho("everyone")} /> Every market
            </label>
            <label className="flex items-center gap-2 text-[15px] text-[#2C2420]">
              <input type="radio" name="who" checked={who === "markets"} onChange={() => setWho("markets")} /> Some markets
            </label>
            {who === "markets" && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 pl-6">
                {markets.map((m) => (
                  <label key={m.id} className="flex items-center gap-1.5 text-[15px] text-[#2C2420]">
                    <input type="checkbox" checked={picked.includes(m.id)} onChange={() => toggle(m.id)} /> {m.label}
                  </label>
                ))}
              </div>
            )}
            <label className="flex items-center gap-2 text-[15px] text-[#2C2420]">
              <input type="checkbox" checked={bartendersOnly} onChange={(e) => setBartendersOnly(e.target.checked)} /> Bartenders only
            </label>
          </fieldset>
          <label className="flex items-start gap-2 text-[15px] text-[#2C2420]">
            <input type="checkbox" className="mt-1" checked={sendNow} onChange={(e) => setSendNow(e.target.checked)} />
            <span>
              Send now
              <span className="block text-xs text-[#6B5D52]">Off: texts wait until 8:00 AM for anyone in quiet hours (9:00 PM to 8:00 AM their time).</span>
            </span>
          </label>
          {error && <p className="text-sm text-[#A0412D]">{error}</p>}
          {notice && (
            <p className="text-sm text-[#55684A]">
              {notice.text}{" "}
              {notice.href && (
                <Link href={notice.href} className="underline">
                  See what staff will see
                </Link>
              )}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={!ready || busy || att.busy || !!conflict} className="rounded-lg bg-[#2C2420] text-white px-4 py-2 text-sm font-medium disabled:opacity-40">
              {busy ? "Working..." : "Send announcement"}
            </button>
            <button
              type="button"
              onClick={saveNow}
              disabled={busy || att.busy || saving || !!conflict}
              className="rounded-lg border border-[#2C2420] text-[#2C2420] px-4 py-2 text-sm font-medium disabled:opacity-40"
            >
              Save draft
            </button>
            <button type="button" onClick={testToMe} disabled={!title.trim() || !body.trim() || busy || att.busy || !!conflict} className="text-sm text-[#2C2420] underline disabled:opacity-40">
              Send a test to me
            </button>
            <button type="button" onClick={() => close()} className="text-sm text-[#6B5D52] underline">
              Cancel
            </button>
          </div>
        </form>
      )}
      <Drafts drafts={listed} me={me} onEdit={edit} sendDraft={sendDraft} onDone={(m) => setDone(m)} />
    </>
  );
}

/** Open drafts, admins and managers only. */
function Drafts({
  drafts,
  me,
  onEdit,
  sendDraft,
  onDone,
}: {
  drafts: DraftItem[];
  me: string;
  onEdit: (d: DraftItem) => void;
  sendDraft: (id: string, base: string | null, createdBy: string | null, authorName: string) => Promise<{ recipients: number; texted: number; held: number } | null>;
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; text: string } | null>(null);
  if (drafts.length === 0) return null;

  const send = async (d: DraftItem) => {
    setBusyId(d.id);
    setError(null);
    try {
      const r = await sendDraft(d.id, d.updatedAt, d.createdBy, d.authorName);
      if (!r) return;
      onDone(sentMessage(r));
      router.refresh();
    } catch (err) {
      setError({ id: d.id, text: err instanceof Error ? err.message : "Could not send." });
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (d: DraftItem) => {
    if (!window.confirm(`Delete the draft "${draftTitle(d.title)}"? This cannot be undone.`)) return;
    setBusyId(d.id);
    setError(null);
    try {
      const { res, d: out } = await post({ action: "delete", id: d.id });
      if (!res.ok) throw new Error(out.error ?? "Could not delete.");
      router.refresh();
    } catch (err) {
      setError({ id: d.id, text: err instanceof Error ? err.message : "Could not delete." });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="space-y-2">
      <h2 className="px-1 text-xs font-bold uppercase tracking-wider text-[#B5845A]">Drafts</h2>
      <ul className="bg-[#FBF7F3] rounded-2xl border border-dashed border-[#DDD5CC] divide-y divide-[#DDD5CC] overflow-hidden">
        {drafts.map((d) => (
          <li key={d.id} className="px-4 py-3 space-y-1">
            <span className={`block truncate font-heading ${d.title.trim() ? "text-[#2C2420] font-medium" : "text-[#6B5D52] italic"}`}>{draftTitle(d.title)}</span>
            {firstLine(d.body) && <span className="block text-sm text-[#6B5D52] truncate">{firstLine(d.body)}</span>}
            <span className="block text-xs text-[#A39585]">
              By {d.createdBy === me ? "you" : d.authorName}
              {d.updatedBy && d.updatedBy !== d.createdBy ? ` · last edited by ${d.updatedBy === me ? "you" : d.updatedByName}` : ""} · saved {when(d.updatedAt)}
            </span>
            <span className="flex flex-wrap gap-4 pt-1">
              <button type="button" onClick={() => onEdit(d)} disabled={busyId === d.id} className="text-sm text-[#2C2420] underline disabled:opacity-40">
                Edit
              </button>
              <button type="button" onClick={() => send(d)} disabled={busyId === d.id} className="text-sm text-[#2C2420] underline disabled:opacity-40">
                Send
              </button>
              <button type="button" onClick={() => remove(d)} disabled={busyId === d.id} className="text-sm text-[#A0412D] underline disabled:opacity-40">
                Delete
              </button>
            </span>
            {error?.id === d.id && <p className="text-sm text-[#A0412D]">{error.text}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
