/**
 * TedBuy Account Deletion, Data Retention & Security Hold Policy Configuration
 * Defines configurable platform retention windows, username quarantine rules, and data lifecycle stages.
 * Retention periods are operational parameters and can be configured via environment variables.
 */

export type UserAccountStatus =
  | 'active'
  | 'deletion_pending'
  | 'deleted'
  | 'suspended'
  | 'under_investigation';

export type ProductLifecycleStatus =
  | 'active'
  | 'sold'
  | 'hidden'
  | 'archived'
  | 'deleted';

export interface RetentionPolicyConfig {
  /** Number of days username / store name remains quarantined before being claimable (Default: 90) */
  usernameQuarantineDays: number;
  /** Number of days soft-deleted user account remains before cold-purge evaluation (Default: 90) */
  accountRetentionDays: number;
  /** Number of days archived listing media remains in quarantine before cold-purge (Default: 90) */
  mediaRetentionDays: number;
  /** Number of days chat history & dispute logs are preserved (Default: 365) */
  chatRetentionDays: number;
  /** Number of days payment / boost transaction records are retained for financial audit (Default: 2555 days / configurable) */
  paymentRetentionDays: number;
  /** Whether automated purge worker is enabled */
  autoPurgeEnabled: boolean;
}

// Safely parse environment variables in Node or browser contexts
const parseEnvNumber = (val: any, fallback: number): number => {
  if (typeof val === 'string' && val.trim()) {
    const parsed = parseInt(val, 10);
    return isNaN(parsed) ? fallback : parsed;
  }
  if (typeof val === 'number' && !isNaN(val)) return val;
  return fallback;
};

const envObj: Record<string, any> = typeof process !== 'undefined' && process.env ? process.env : {};

export const RETENTION_CONFIG: RetentionPolicyConfig = {
  usernameQuarantineDays: parseEnvNumber(envObj.RETENTION_USERNAME_QUARANTINE_DAYS, 90),
  accountRetentionDays: parseEnvNumber(envObj.RETENTION_ACCOUNT_DAYS, 90),
  mediaRetentionDays: parseEnvNumber(envObj.RETENTION_MEDIA_DAYS, 90),
  chatRetentionDays: parseEnvNumber(envObj.RETENTION_CHAT_DAYS, 365),
  paymentRetentionDays: parseEnvNumber(envObj.RETENTION_PAYMENT_DAYS, 2555),
  autoPurgeEnabled: envObj.AUTO_PURGE_ENABLED !== 'false'
};

/**
 * Calculates the quarantine expiration timestamp for a given duration in days.
 */
export function calculateQuarantineExpiry(days = RETENTION_CONFIG.usernameQuarantineDays): string {
  const expiryDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return expiryDate.toISOString();
}

/**
 * Checks if a store name / username is currently quarantined and unavailable.
 */
export function isStoreNameQuarantined(storeDoc?: { status?: string; availableAfter?: string } | null): boolean {
  if (!storeDoc) return false;
  if (storeDoc.status === 'quarantined') {
    if (storeDoc.availableAfter) {
      const expiry = new Date(storeDoc.availableAfter).getTime();
      return Date.now() < expiry;
    }
    return true;
  }
  return false;
}
