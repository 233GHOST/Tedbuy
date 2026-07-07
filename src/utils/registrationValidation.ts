/**
 * Secure Validation Utility for TedBuy Registration Flow
 */

// Comprehensive list of common disposable email domains
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com',
  'yopmail.com',
  'tempmail.com',
  'temp-mail.org',
  'temp-mail.ru',
  'temp-mail.com',
  'dispostable.com',
  '10minutemail.com',
  'guerrillamail.com',
  'sharklasers.com',
  'getairmail.com',
  'trashmail.com',
  'boun.cr',
  'generator.email',
  'throwawaymail.com',
  'tempmailaddress.com',
  'fakeinbox.com',
  'tempmail.net',
  'tempmail.co',
  'maildrop.cc',
  'mailnesia.com',
  'mailcatch.com',
  'mytrashmail.com',
  'inboxkitten.com',
  'getnada.com',
  'disposable.com',
  'throwaway.com'
]);

/**
 * Validates email format and screens for disposable email addresses.
 */
export function validateEmailSecure(email: string): { isValid: boolean; error?: string } {
  if (!email || typeof email !== 'string') {
    return { isValid: false, error: 'Email address is required.' };
  }
  
  const cleanEmail = email.trim().toLowerCase();
  
  // Standard strict email validation regex
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(cleanEmail)) {
    return { isValid: false, error: 'Please enter a valid email address.' };
  }
  
  // Extract domain
  const domain = cleanEmail.split('@')[1];
  if (!domain) {
    return { isValid: false, error: 'Invalid email domain.' };
  }
  
  // Check if domain is a known disposable email domain
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return { isValid: false, error: 'Registration with disposable or temporary email addresses is prohibited.' };
  }
  
  // Extra layer: check if domain contains suspicious keywords
  const suspiciousKeywords = ['tempmail', 'disposable', 'throwaway', 'temp-mail', 'fakeinbox', 'generator-email'];
  if (suspiciousKeywords.some(keyword => domain.includes(keyword))) {
    return { isValid: false, error: 'Registration with disposable or temporary email addresses is prohibited.' };
  }
  
  return { isValid: true };
}

/**
 * Validates password strength:
 * - Minimum 8 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one number
 * - At least one special character
 */
export function validatePasswordStrength(password: string): { isValid: boolean; error?: string } {
  if (!password || typeof password !== 'string') {
    return { isValid: false, error: 'Password is required.' };
  }
  
  if (password.length < 8) {
    return { isValid: false, error: 'Password must be at least 8 characters long.' };
  }
  
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);
  
  if (!hasUppercase) {
    return { isValid: false, error: 'Password must contain at least one uppercase letter.' };
  }
  if (!hasLowercase) {
    return { isValid: false, error: 'Password must contain at least one lowercase letter.' };
  }
  if (!hasNumber) {
    return { isValid: false, error: 'Password must contain at least one number.' };
  }
  if (!hasSpecial) {
    return { isValid: false, error: 'Password must contain at least one special character (e.g. !@#$%^&*).' };
  }
  
  return { isValid: true };
}

/**
 * Validates username:
 * - Alphanumeric characters, underscores, or hyphens
 * - Length 3-30 characters
 */
export function validateUsernameSecure(username: string): { isValid: boolean; error?: string } {
  if (!username || typeof username !== 'string') {
    return { isValid: false, error: 'Username is required.' };
  }
  
  const clean = username.trim();
  if (clean.length < 3 || clean.length > 30) {
    return { isValid: false, error: 'Username must be between 3 and 30 characters.' };
  }
  
  const usernameRegex = /^[a-zA-Z0-9_-]+$/;
  if (!usernameRegex.test(clean)) {
    return { isValid: false, error: 'Username can only contain alphanumeric characters, underscores (_), and hyphens (-).' };
  }
  
  return { isValid: true };
}

/**
 * Validates mobile phone number format (specifically optimized for Ghana and international formats):
 * - Accepts local format (e.g., 0241234567, 0551234567)
 * - Accepts international format (e.g., +233241234567)
 * - Digits only (after optional leading '+'), length 9-15 characters.
 */
export function validatePhoneSecure(phone: string): { isValid: boolean; error?: string } {
  if (!phone || typeof phone !== 'string') {
    return { isValid: false, error: 'Phone number is required.' };
  }
  
  const clean = phone.trim();
  
  // Basic numeric pattern (allowing leading +)
  const phoneRegex = /^\+?[0-9]{9,15}$/;
  if (!phoneRegex.test(clean)) {
    return { isValid: false, error: 'Please enter a valid phone number (9-15 digits, optional leading +).' };
  }
  
  // Specific Ghana mobile check: if starting with 0, must have 10 digits
  if (clean.startsWith('0') && clean.length !== 10) {
    return { isValid: false, error: 'Ghana local mobile numbers must be exactly 10 digits (e.g., 0241234567).' };
  }
  
  // Specific Ghana mobile check: if starting with +233, must have 13 characters
  if (clean.startsWith('+233') && clean.length !== 13) {
    return { isValid: false, error: 'Ghana international mobile numbers must be 13 characters (e.g., +233241234567).' };
  }
  
  return { isValid: true };
}
