import type express from 'express';
import { createDropshipDbFromConfig, resolveDropshipConfig, type UserRestrictionLoader } from './db.js';
import { createLegacyGuards, type LegacyGuards } from './legacyGuards.js';
import { createDropshipRouter, type DropshipDeps } from './routes.js';
import { runOrderExpiry, type OrderDeps } from './orderRoutes.js';

export interface RegisterDropshipOptions {
  verifyUser: DropshipDeps['verifyUser'];
  // Legacy server client, used only to read the users row for account restrictions.
  getLegacySupabase: () => any;
  rateLimit?: DropshipDeps['rateLimit'];
  // Clears legacy product caches (raw list, homepage/search/category/seller responses, product
  // detail) after Dropship changes mirror rows; undefined ids = clear broadly.
  onProductsChanged?: (productIds?: string[]) => void;
  // COD orders: Firebase emailVerified lookup, in-app notifications, transactional email.
  isEmailVerified?: OrderDeps['isEmailVerified'];
  notify?: OrderDeps['notify'];
  sendMail?: OrderDeps['sendMail'];
  env?: Record<string, string | undefined>;
}

// Reads the legacy users row (ARCHITECTURE §3 gate step 2). Fails closed: if the row
// can't be read, the request fails instead of being treated as unrestricted.
export function createLegacyUserRestrictionLoader(getLegacySupabase: () => any): UserRestrictionLoader {
  return async (uid: string) => {
    const client = getLegacySupabase();
    if (!client) throw new Error('legacy Supabase client unavailable');
    const { data, error } = await client
      .from('users')
      .select('id, "isSuspended", "securityHold", "isDeleted", status')
      .eq('id', uid)
      .maybeSingle();
    if (error) throw new Error(`users lookup failed: ${error.message}`);
    if (!data) return { exists: false, restricted: false };
    const restricted = data.isSuspended === true || data.securityHold === true || data.isDeleted === true
      || data.status === 'suspended' || data.status === 'deleted';
    return { exists: true, restricted };
  };
}

export function registerDropship(app: express.Express, options: RegisterDropshipOptions): LegacyGuards {
  const env = options.env ?? process.env;
  const config = resolveDropshipConfig(env);
  const ordersEnabled = env.DROPSHIP_ORDERS_ENABLED === 'true';
  // Fail closed by default: with no db every dsl_ row is hidden and all media is protected.
  let guards = createLegacyGuards({ db: null, enabled: false });
  try {
    const db = createDropshipDbFromConfig(config);
    guards = createLegacyGuards({ db, enabled: config.enabled, onProductsChanged: options.onProductsChanged });
    app.use(createDropshipRouter({
      enabled: config.enabled,
      cause: config.cause,
      db,
      guards,
      verifyUser: options.verifyUser,
      loadUserRestriction: createLegacyUserRestrictionLoader(options.getLegacySupabase),
      cloudinaryCloudName: env.VITE_CLOUDINARY_CLOUD_NAME || env.CLOUDINARY_CLOUD_NAME || 'dfm3g2qvg',
      rateLimit: options.rateLimit,
      onProductsChanged: options.onProductsChanged,
      orders: { ordersEnabled, isEmailVerified: options.isEmailVerified, notify: options.notify, sendMail: options.sendMail },
    }));
    // Order time limits: one sweep a minute (cancels overdue steps; nobody is blamed).
    if (db && config.enabled && ordersEnabled) {
      const timer = setInterval(() => {
        runOrderExpiry(db, options.notify, () => { guards.invalidate(); options.onProductsChanged?.(); }).catch(err => console.error('[Dropship orders] expiry sweep failed', (err as Error)?.message));
      }, 60_000);
      timer.unref?.();
      console.log('[Dropship] COD orders enabled.');
    }
    if (config.enabled) {
      console.log('[Dropship] Enabled (service-role client, identity checks passed).');
    } else if (config.cause === 'disabled') {
      console.log('[Dropship] Inactive (DROPSHIP_ENABLED is not "true").');
    } else {
      console.error(`[Dropship] CRITICAL: unavailable (${config.cause}). Dropship routes return 503; the rest of TedBuy is unaffected.`);
    }
  } catch (err) {
    // Dropship must never stop TedBuy from starting (ARCHITECTURE §12.3).
    console.error('[Dropship] initialisation failed; Dropship disabled.', err);
  }
  return guards;
}
