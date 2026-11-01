// One store-name rule for sign-up and Settings (web; mobile/src/utils/storeName.ts is a copy).
// Matches how shops really name themselves ("ISBON STORE | Laptops, Gaming & More",
// "Ama's Boutique"), and refuses markup, emoji and other symbols.

const ALLOWED = /^[\p{L}\p{M}\p{N} .,&'’\-_|()/+]+$/u;

export function validateStoreName(name: string): { isValid: boolean; error?: string } {
  const clean = typeof name === 'string' ? name.trim() : '';
  if (!clean) return { isValid: false, error: 'Please enter a store name.' };
  if (clean.length < 3) return { isValid: false, error: 'Store name must be at least 3 characters.' };
  if (clean.length > 50) return { isValid: false, error: 'Store name must be 50 characters or less.' };
  if (!ALLOWED.test(clean)) {
    return { isValid: false, error: "Store name can use letters, numbers, spaces and . , & ' - _ | ( ) / + only." };
  }
  return { isValid: true };
}
