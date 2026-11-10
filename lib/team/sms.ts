// Staff texts go out through a GHL inbound webhook: POST {phone, name, message}
// to env GHL_STAFF_SMS_WEBHOOK. Never throws: a missing env or a failed send is
// logged and skipped so it never blocks what triggered it.

export async function sendStaffText(phone: string, name: string, message: string): Promise<boolean> {
  const url = process.env.GHL_STAFF_SMS_WEBHOOK;
  if (!url) {
    console.warn(`[staff-sms] GHL_STAFF_SMS_WEBHOOK is not set, text to ${phone} skipped`);
    return false;
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, name, message }),
    });
    if (!res.ok) {
      console.error(`[staff-sms] webhook responded ${res.status} for ${phone}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[staff-sms] send to ${phone} failed:`, err instanceof Error ? err.message : String(err));
    return false;
  }
}
