// Uploads that go straight from the phone to a private storage bucket. Server only.
//
// Hosting caps a request body at a few MB, so large files (a 15 MB menu PDF,
// an 8 MB GIF) never pass through our server: the server checks the type and
// size the browser declares, hands back a one time signed upload link for one
// path it chose, and once the browser says it is done, reads the stored
// file's real size and type back and deletes it when they break the rules.
// The buckets enforce the same limits on their own.

import { supabase } from "@/lib/supabase";

/** A signed link the browser can upload one file to, at a path the server chose. */
export async function signedUploadUrl(bucket: string, path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(path);
  if (error || !data) {
    console.error("[upload] signed upload link failed:", error?.message);
    return null;
  }
  return (data as { signedUrl: string }).signedUrl;
}

/**
 * The uploaded file, checked: it exists, its type is allowed, and it is not
 * over the limit. A file that breaks the rules is deleted.
 */
export async function confirmUpload(
  bucket: string,
  path: string,
  rules: { types: string[]; maxBytes: number }
): Promise<{ ok: true; size: number; type: string } | { ok: false; error: string }> {
  type Info = { size?: number; contentType?: string; metadata?: { size?: number; mimetype?: string } };
  let info: Info | null = null;
  const { data, error } = await supabase.storage.from(bucket).info(path);
  if (!error && data) info = data as unknown as Info;
  else {
    // Older storage servers have no info call: find the file in its folder instead.
    const slash = path.lastIndexOf("/");
    const listed = await supabase.storage
      .from(bucket)
      .list(path.slice(0, slash), { search: path.slice(slash + 1), limit: 5 })
      .catch(() => ({ data: null }));
    const hit = ((listed?.data as { name: string; metadata?: { size?: number; mimetype?: string } }[] | null) ?? []).find((f) => f.name === path.slice(slash + 1));
    if (hit) info = { metadata: hit.metadata };
  }
  if (!info) return { ok: false, error: "The file did not upload. Try again." };
  const size = Number(info.size ?? info.metadata?.size ?? 0);
  const type = String(info.contentType ?? info.metadata?.mimetype ?? "").toLowerCase();
  if (!rules.types.includes(type) || size <= 0 || size > rules.maxBytes) {
    await supabase.storage.from(bucket).remove([path]);
    return { ok: false, error: size > rules.maxBytes ? `That file is too large. The limit is ${Math.round(rules.maxBytes / 1024 / 1024)} MB.` : "That kind of file is not allowed." };
  }
  return { ok: true, size, type };
}

/** A short lived link to a private file. With a file name, the browser downloads it. */
export async function shortLink(bucket: string, path: string, seconds: number, download?: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, seconds, download ? { download } : {});
  if (error || !data) return null;
  return (data as { signedUrl: string }).signedUrl;
}
