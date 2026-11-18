// The hidden booking context the client's chat page builds from its link's
// query params (app/chat/page.tsx), built here from the session row for a
// planner starting the planning chat in the partner portal. Pure.

const PREFIX = "CONTEXT - Pre-filled from booking system:";

interface SessionFields {
  name?: string | null;
  email?: string | null;
  event_date?: string | null;
  package_type?: string | null;
  guest_count?: string | null;
  event_name?: string | null;
  hours_booked?: string | null;
  event_type?: string | null;
  bar_service_start?: string | null;
  bartender_count?: number | null;
}

export function bookingContextMessage(s: SessionFields): string | null {
  const v = (x: unknown) => (x === null || x === undefined ? "" : String(x).trim());
  const parts: string[] = [];
  if (v(s.name)) parts.push(`Client name: ${v(s.name)}`);
  if (v(s.email)) parts.push(`Email: ${v(s.email)}`);
  if (v(s.event_date)) parts.push(`Event date: ${v(s.event_date)}`);
  if (v(s.package_type)) parts.push(`Package: ${v(s.package_type)}`);
  if (v(s.guest_count)) parts.push(`Guest count: ${v(s.guest_count)}`);
  if (v(s.event_type)) parts.push(`Event type: ${v(s.event_type)}`);
  if (v(s.event_name)) parts.push(v(s.event_type) ? `Event name: ${v(s.event_name)}` : `Event type: ${v(s.event_name)}`);
  if (v(s.hours_booked)) parts.push(`Hours of bar service booked: ${v(s.hours_booked)}`);
  if (v(s.bar_service_start)) parts.push(`Bar service start time booked: ${v(s.bar_service_start)}`);
  if (v(s.bartender_count)) parts.push(`Bartenders booked: ${v(s.bartender_count)}`);
  return parts.length > 0 ? `${PREFIX} ${parts.join(", ")}. Use this info and do not re-ask for it.` : null;
}
