// GoHighLevel API helper
// Uses Private Integration token to search contacts and create notes
// Required env vars: GHL_API_TOKEN, GHL_LOCATION_ID

const GHL_BASE_URL = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";

function getAuthHeaders(): Record<string, string> {
  const token = process.env.GHL_API_TOKEN;
  if (!token) {
    throw new Error("GHL_API_TOKEN is not configured");
  }
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Version: GHL_API_VERSION,
  };
}

function getLocationId(): string {
  const locationId = process.env.GHL_LOCATION_ID;
  if (!locationId) {
    throw new Error("GHL_LOCATION_ID is not configured");
  }
  return locationId;
}

/**
 * Find a GHL contact by email address.
 * Returns the contact ID if found, otherwise null.
 */
export async function findContactByEmail(email: string): Promise<string | null> {
  if (!email) return null;

  const locationId = getLocationId();
  const url = `${GHL_BASE_URL}/contacts/search`;

  const body = {
    locationId,
    pageLimit: 1,
    filters: [
      {
        field: "email",
        operator: "eq",
        value: email,
      },
    ],
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("GHL contact search failed:", res.status, text);
      return null;
    }

    const data = await res.json();
    const contacts = data?.contacts || [];
    if (contacts.length === 0) return null;

    return contacts[0].id || null;
  } catch (err) {
    console.error("GHL contact search error:", err);
    return null;
  }
}

/**
 * Create a note on a contact in GHL.
 * Returns true on success, false on failure.
 */
export async function createNote(
  contactId: string,
  body: string
): Promise<boolean> {
  if (!contactId || !body) return false;

  const url = `${GHL_BASE_URL}/contacts/${contactId}/notes`;

  const payload = {
    body,
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("GHL create note failed:", res.status, text);
      return false;
    }

    return true;
  } catch (err) {
    console.error("GHL create note error:", err);
    return false;
  }
}

/**
 * Convenience: find contact by email and create a note in one call.
 */
export async function createNoteByEmail(
  email: string,
  body: string
): Promise<{ success: boolean; contactId: string | null; reason?: string }> {
  if (!email) {
    return { success: false, contactId: null, reason: "no email provided" };
  }
  if (!body) {
    return { success: false, contactId: null, reason: "no body provided" };
  }

  const contactId = await findContactByEmail(email);
  if (!contactId) {
    return { success: false, contactId: null, reason: "contact not found" };
  }

  const ok = await createNote(contactId, body);
  if (!ok) {
    return { success: false, contactId, reason: "note creation failed" };
  }

  return { success: true, contactId };
}
