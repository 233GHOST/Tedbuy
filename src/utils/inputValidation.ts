/**
 * Input sanitization and validation utilities for TedBuy.
 * Provides defense-in-depth against XSS, injection, and malformed input.
 */

/**
 * HTML-entity encodes dangerous characters to prevent XSS when rendering
 * user-supplied text in React (even though React auto-escapes, this adds
 * a defense-in-depth layer for contexts like dangerouslySetInnerHTML,
 * meta tags, or non-React consumers of this data).
 */
function htmlEncode(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Strips null bytes and control characters (except common whitespace)
 * that could be used for injection attacks.
 */
function stripControlChars(str: string): string {
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Sanitizes text input for safe storage and display.
 * - Strips HTML/XML tags
 * - Encodes dangerous entities
 * - Removes control characters
 * - Blocks javascript: / data: / vbscript: URI schemes
 * - Normalizes unicode whitespace
 */
export function sanitizeText(text: string): string {
  if (!text) return '';
  let clean = stripControlChars(text);
  // Remove HTML/XML tags
  clean = clean.replace(/<[^>]*>/g, '');
  // Block dangerous URI schemes (case-insensitive)
  clean = clean.replace(/(javascript|vbscript|data|blob)\s*:/gi, '');
  // Remove CSS expression attempts
  clean = clean.replace(/expression\s*\(/gi, '');
  // Normalize whitespace but preserve intentional spaces
  clean = clean.replace(/\s+/g, ' ');
  return clean.trim();
}

/**
 * Sanitizes text for use in HTML contexts (e.g. meta descriptions, OG tags).
 * Applies HTML entity encoding for safe embedding.
 */
export function sanitizeTextForHtml(text: string): string {
  if (!text) return '';
  return htmlEncode(sanitizeText(text));
}

/**
 * Sanitizes a URL for safe use in href/src attributes.
 * Allows only http:, https:, and relative paths.
 * Returns empty string if the URL uses a dangerous protocol.
 */
export function sanitizeUrl(url: string): string {
  if (!url) return '';
  const trimmed = url.trim();
  // Allow relative URLs
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;
  // Allow data: for images only (base64 encoded)
  if (trimmed.startsWith('data:image/')) return trimmed;
  // Allow http and https only
  const match = trimmed.match(/^https?:\/\/[^\s<>"']+$/i);
  return match ? trimmed : '';
}

/**
 * Validates input length constraints.
 */
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

/**
 * Validates a store name format.
 */
export function validateStoreName(name: string): { isValid: boolean; error?: string } {
  if (!name || name.trim().length === 0) {
    return { isValid: false, error: 'Store name cannot be empty.' };
  }
  const clean = name.trim();
  if (clean.length > 30) {
    return { isValid: false, error: 'Store name must be 30 characters or less.' };
  }
  if (clean.length < 3) {
    return { isValid: false, error: 'Store name must be at least 3 characters.' };
  }
  const pattern = /^[a-zA-Z0-9\s_-]+$/;
  if (!pattern.test(clean)) {
    return { isValid: false, error: 'Store name can only contain letters, numbers, spaces, hyphens (-), and underscores (_).' };
  }
  return { isValid: true };
}
