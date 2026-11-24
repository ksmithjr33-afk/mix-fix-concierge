// The offer order's one save call, for the client components.
export async function offersSave(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch("/api/team/admin/scorecard/offers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof d.error === "string" ? d.error : "Could not save.");
  return d;
}
