// The manager view's Details cards with an Edit next to each field: what each
// row shows, the value its input starts from, and which input it gets. Read
// only rows (client, arrive by, also working, The Mix Fix line) have no field.
// Pure, no database.

import { FIELD_SPECS, formValue, type AdminEditField, type EditCard, type FieldKind } from "@/lib/team/admin-edit";
import type { StaffEventView } from "@/lib/team/event-view";

export interface EditRow {
  label: string;
  display: string; // "" shows as "Not set"
  href?: string; // a map or tel link on the shown value
  field?: AdminEditField; // set when the row is editable
  kind?: FieldKind;
  value?: string; // the input's starting value (formValue)
  confirm?: boolean; // priced or the date: confirm with the price before saving
  priced?: boolean;
}

export interface EditCardData {
  id: EditCard;
  title: string;
  rows: EditRow[];
}

const TITLES: Record<EditCard, string> = { event: "Event", location: "Location", contact: "Day of contact", style: "Style and notes" };

const yesNo = (v: unknown) => (v === true ? "Yes" : v === false ? "No" : "");
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

/** What a field shows on its card, the way the bartender view words it where it has the field. */
function displayOf(field: AdminEditField, v: StaffEventView, ed: Record<string, unknown>): { display: string; href?: string } {
  switch (field) {
    case "event_name":
      return { display: v.eventName };
    case "event_date":
      return { display: v.date };
    case "bar_service_start":
      return { display: v.serviceStart };
    case "bar_service_end":
      return { display: v.serviceEnd };
    case "guest_count":
      return { display: v.guestCount };
    case "package":
      return { display: v.package };
    case "bartenders":
      return { display: v.bartenders !== null ? String(v.bartenders) : "" };
    case "event_address":
      return { display: v.address, href: v.mapsUrl ?? undefined };
    case "venue_type":
      return { display: v.venueType };
    case "indoor_outdoor":
      return { display: v.barSetting };
    case "bar_on_site":
      return { display: v.barOnSite };
    case "bar_floor_access":
      return { display: v.barFloorAccess };
    case "bar_details":
      return { display: v.barDetails };
    case "parking_info":
      return { display: v.parking };
    case "day_of_contact_name":
      return { display: str(ed.day_of_contact_name) };
    case "day_of_contact_phone": {
      // Admins see the number any time; bartenders only from 48 hours before.
      const phone = str(ed.day_of_contact_phone);
      return { display: phone, href: phone ? telHref(phone) : undefined };
    }
    case "theme":
      return { display: v.theme };
    case "event_colors":
      return { display: v.colors };
    case "allergies":
      return { display: v.allergies.join(", ") || "None" };
    case "special_requests":
      return { display: v.specialRequests || "None" };
    case "beer":
    case "wine":
    case "client_providing_beer_wine":
    case "dual_bar_setup":
      return { display: yesNo(ed[field]) };
    default:
      return { display: str(ed[field]) };
  }
}

export function editCards(
  v: StaffEventView,
  ed: Record<string, unknown>,
  session: { event_date?: string | null; guest_count?: unknown; package_type?: unknown } = {}
): EditCardData[] {
  const fieldRow = (field: AdminEditField): EditRow => {
    const s = FIELD_SPECS.find((f) => f.field === field)!;
    return { label: s.label, ...displayOf(field, v, ed), field, kind: s.kind, value: formValue(field, ed, session, v.bartenders), confirm: s.confirm, priced: s.priced };
  };
  const fields = (card: EditCard) => FIELD_SPECS.filter((f) => f.card === card).map((f) => fieldRow(f.field));
  const readOnly = (label: string, display: string, href?: string): EditRow => ({ label, display, href });

  const event = fields("event");
  // Read only rows sit where the bartender view has them.
  event.splice(1, 0, readOnly("Event type", v.eventType), readOnly("Client", v.clientFirstName));
  const at = event.findIndex((r) => r.field === "bar_service_start");
  event.splice(at, 0, readOnly("Arrive by", v.arrival));
  if (v.teammates.length) event.push(readOnly("Also working", v.teammates.join(", ")));

  return [
    { id: "event", title: TITLES.event, rows: event },
    { id: "location", title: TITLES.location, rows: fields("location") },
    { id: "contact", title: TITLES.contact, rows: [...fields("contact"), readOnly("The Mix Fix", v.mixFixLine, telHref(v.mixFixLine))] },
    { id: "style", title: TITLES.style, rows: fields("style") },
  ];
}
