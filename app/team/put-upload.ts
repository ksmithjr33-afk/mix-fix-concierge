// Sends a file straight to a private storage bucket through a one time signed
// upload link from our server, so large files never pass through it.

export async function putToSignedUrl(uploadUrl: string, file: Blob): Promise<void> {
  const body = new FormData();
  body.append("cacheControl", "3600");
  body.append("", file);
  const res = await fetch(uploadUrl, { method: "PUT", body, headers: { "x-upsert": "false" } });
  if (!res.ok) throw new Error("The file did not upload. Try again.");
}

export const MB = 1024 * 1024;
