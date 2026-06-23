export function sanitizeText(text: string): string {
  if (!text) return '';
  // Force clean string and strip basic HTML tags to block embedded tags
  return text
    .replace(/<[^>]*>/g, '') 
    .replace(/javascript:/gi, '') // prevent script hrefs
    .trim();
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
  // Allow letters, numbers, spaces, hyphens, and underscores
  const pattern = /^[a-zA-Z0-9\s_-]+$/;
  if (!pattern.test(clean)) {
    return { isValid: false, error: 'Store name can only contain letters, numbers, spaces, hyphens (-), and underscores (_).' };
  }
  return { isValid: true };
}
