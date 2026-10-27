import type express from 'express';
import { createDropshipDbFromConfig, resolveDropshipConfig, type UserRestrictionLoader } from './db.js';
import { createDropshipRouter, type DropshipDeps } from './routes.js';

export interface RegisterDropshipOptions {
  verifyUser: DropshipDeps['verifyUser'];
  // Legacy server client, used only to read the users row for account restrictions.
  getLegacySupabase: () => any;
  rateLimit?: DropshipDeps['rateLimit'];
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

export function registerDropship(app: express.Express, options: RegisterDropshipOptions): void {
  const env = options.env ?? process.env;
  const config = resolveDropshipConfig(env);
  try {
    const db = createDropshipDbFromConfig(config);
    app.use(createDropshipRouter({
      enabled: config.enabled,
      cause: config.cause,
      db,
      verifyUser: options.verifyUser,
      loadUserRestriction: createLegacyUserRestrictionLoader(options.getLegacySupabase),
      cloudinaryCloudName: env.VITE_CLOUDINARY_CLOUD_NAME || env.CLOUDINARY_CLOUD_NAME || 'dfm3g2qvg',
      rateLimit: options.rateLimit,
    }));
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
}
