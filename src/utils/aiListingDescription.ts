/**
 * AI Listing Description Generator (Web)
 * Thin client for POST /api/ai/generate-listing-description. All prompt
 * building and provider logic lives server-side (server.ts) so web and
 * mobile get identical generation behavior — this file only ever forwards
 * the seller's already-entered listing fields (plus, optionally, up to 3
 * already-compressed image data URLs) and returns the plain text.
 */

import { getAuthHeader } from '../firebase';

export interface ListingDescriptionInput {
  category: string;
  title: string;
  condition?: string;
  price?: string | number;
  location?: string;
  brand?: string;
  negotiable?: boolean;
  isExchangeable?: boolean;
  existingDescription?: string;
  /** Up to 3 `data:image/jpeg;base64,...` strings — a small AI-only copy, never the original listing image data. */
  images?: string[];
}

export interface ListingDescriptionResult {
  success: boolean;
  description?: string;
  /** Non-blocking notice — e.g. the photo didn't seem to match a stated field. Never prevents using the description. */
  warning?: string;
  error?: string;
}

export async function generateListingDescription(input: ListingDescriptionInput): Promise<ListingDescriptionResult> {
  try {
    const authHeader = await getAuthHeader();
    const controller = new AbortController();
    // Multimodal (image) generation genuinely takes longer than pure text —
    // comfortably above the server's own internal timeout so its specific
    // friendly message wins the race over this generic client-side one.
    const timeoutId = setTimeout(() => controller.abort(), 35000);

    let res: Response;
    try {
      res = await fetch('/api/ai/generate-listing-description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    let data: any = null;
    try { data = await res.json(); } catch { /* fall through to generic error below */ }

    if (!res.ok || !data?.success) {
      return { success: false, error: data?.error || "Couldn't generate a description right now. You can write your description manually." };
    }

    return { success: true, description: data.description as string, warning: typeof data.warning === 'string' ? data.warning : undefined };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return { success: false, error: 'That took too long. Please try again.' };
    }
    return { success: false, error: 'Connection problem. Please try again.' };
  }
}
