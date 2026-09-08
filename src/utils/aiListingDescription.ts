/**
 * AI Listing Description Generator (Web)
 * Thin client for POST /api/ai/generate-listing-description. All prompt
 * building and provider logic lives server-side (server.ts) so web and
 * mobile get identical generation behavior — this file only ever forwards
 * the seller's already-entered listing fields and returns the plain text.
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
}

export interface ListingDescriptionResult {
  success: boolean;
  description?: string;
  error?: string;
}

export async function generateListingDescription(input: ListingDescriptionInput): Promise<ListingDescriptionResult> {
  try {
    const authHeader = await getAuthHeader();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

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

    return { success: true, description: data.description as string };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return { success: false, error: 'That took too long. Please try again.' };
    }
    return { success: false, error: 'Connection problem. Please try again.' };
  }
}
