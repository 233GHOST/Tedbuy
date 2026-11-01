import DOMPurify from 'dompurify';

export function sanitizeText(text: string): string {
  if (!text) return '';
  return DOMPurify.sanitize(text).trim();
}

export function validateInputLength(text: string, maxLen: number, minLen = 0): { isValid: boolean; error?: string } {
  const len = text ? text.length : 0;
  if (len < minLen) {
    return { isValid: false, error: `Must be at least ${minLen} characters long.` };
  }
  if (len > maxLen) {
    return { isValid: false, error: `Cannot exceed ${maxLen} characters.` };
  }
  return { isValid: true };
}

// The store-name rule lives in storeName.ts (shared by sign-up and Settings).
export { validateStoreName } from './storeName';
