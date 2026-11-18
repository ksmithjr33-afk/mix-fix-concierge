// The Scorecard's one save call, for the client components.
export async function scorecardSave(body: Record<string, unknown>): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/team/admin/scorecard", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    return res.ok ? { ok: true } : { ok: false, error: data.error ?? "Could not save." };
  } catch {
    return { ok: false, error: "Could not save. Check your connection." };
  }
}
