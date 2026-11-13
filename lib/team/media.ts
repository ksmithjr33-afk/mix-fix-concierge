// Images and GIFs in event chat and announcements: the rules. Pure, no database.
//
// One image or GIF per chat message or announcement: GIF, PNG, JPG or WEBP up
// to 8 MB, from the photo library, the camera, the keyboard's GIF picker, or
// (when GIPHY_API_KEY is set) a GIPHY search rated G. Files live in a private
// bucket and only people who can see that chat or announcement get a link.
// Texts about them say "sent a GIF" or "sent a photo" and never carry the file.

export const MEDIA_TYPES = ["image/gif", "image/png", "image/jpeg", "image/webp"];
export const MEDIA_MAX_BYTES = 8 * 1024 * 1024;
export const MEDIA_LINK_SECONDS = 10 * 60;
export type MediaScope = "chat" | "announcement";
export type MediaKind = "gif" | "photo";

export interface AttachmentRow {
  id: string;
  scope: MediaScope;
  session_id: string | null;
  announcement_id: string | null;
  message_id: string | null;
  file_path: string;
  file_type: string;
  size_bytes: number | null;
  kind: MediaKind;
  source: "upload" | "giphy";
  status: "pending" | "attached" | "removed";
  uploaded_by: string | null;
  removed_by: string | null;
  removed_at: string | null;
  created_at: string;
}

/** Why this file cannot be attached, or null when it is fine. */
export function mediaError(file: { type: string; size: number } | null): string | null {
  if (!file || !(file.size > 0)) return "Choose a picture first.";
  if (!MEDIA_TYPES.includes(String(file.type).toLowerCase())) return "Attach a GIF, PNG, JPG or WEBP.";
  if (file.size > MEDIA_MAX_BYTES) return "That picture is too large. The limit is 8 MB.";
  return null;
}

export const mediaKind = (type: string): MediaKind => (type.toLowerCase() === "image/gif" ? "gif" : "photo");

export function mediaExtension(type: string): string {
  const t = type.toLowerCase();
  return t === "image/gif" ? "gif" : t === "image/png" ? "png" : t === "image/webp" ? "webp" : "jpg";
}

export function mediaPath(scope: MediaScope, owner: string, staffId: string, at: Date, ext: string): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "") || "x";
  return `${scope}/${safe(owner)}/${safe(staffId)}-${at.getTime()}.${ext}`;
}

/** "sent a GIF" or "sent a photo". */
export const sentLabel = (kind: MediaKind | null | undefined) => (kind === "gif" ? "sent a GIF" : "sent a photo");

/** The GIF button shows only when the GIPHY key is set. */
export function giphyEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return !!env.GIPHY_API_KEY?.trim();
}

// ----- GIPHY -----

export const GIPHY_RATING = "g";

export function giphySearchUrl(key: string, q: string, limit = 24): string {
  const p = new URLSearchParams({ api_key: key, q: q.slice(0, 50), limit: String(limit), rating: GIPHY_RATING, lang: "en", bundle: "messaging_non_clips" });
  return `https://api.giphy.com/v1/gifs/search?${p}`;
}

export function giphyByIdUrl(key: string, id: string): string {
  return `https://api.giphy.com/v1/gifs/${encodeURIComponent(id)}?${new URLSearchParams({ api_key: key, rating: GIPHY_RATING })}`;
}

export const isGiphyId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9]{4,40}$/.test(v);

interface GiphyImage {
  url?: string;
  width?: string;
  height?: string;
  size?: string;
}
export interface GiphyGif {
  id?: string;
  rating?: string;
  title?: string;
  images?: Record<string, GiphyImage | undefined>;
}

/** Only https links on GIPHY's own media hosts are fetched. */
export function isGiphyMediaUrl(u: string | undefined): u is string {
  if (!u) return false;
  try {
    const url = new URL(u);
    return url.protocol === "https:" && /(^|\.)giphy\.com$/.test(url.hostname);
  } catch {
    return false;
  }
}

/** A search result for the picker: rated G only, with a small preview. */
export function giphyResult(g: GiphyGif): { id: string; preview: string; title: string; width: number; height: number } | null {
  if (!g.id || !isGiphyId(g.id) || (g.rating ?? "").toLowerCase() !== GIPHY_RATING) return null;
  const img = g.images?.fixed_width_small ?? g.images?.fixed_width ?? g.images?.preview_gif;
  if (!isGiphyMediaUrl(img?.url)) return null;
  return { id: g.id, preview: img!.url!, title: String(g.title ?? "").slice(0, 80), width: Number(img!.width) || 100, height: Number(img!.height) || 100 };
}

/** The file to store for a chosen GIF: a mid size rendition under the limit. Null when it is not rated G. */
export function giphyFileUrl(g: GiphyGif): string | null {
  if ((g.rating ?? "").toLowerCase() !== GIPHY_RATING) return null;
  for (const k of ["downsized", "fixed_height", "downsized_medium", "original"]) {
    const img = g.images?.[k];
    if (isGiphyMediaUrl(img?.url) && (!img!.size || Number(img!.size) <= MEDIA_MAX_BYTES)) return img!.url!;
  }
  return null;
}
