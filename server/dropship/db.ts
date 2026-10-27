import { createClient } from '@supabase/supabase-js';
import { DropshipError, mapDbError, type DbErrorLike } from './errors.js';

// Every Dropship read and write is one call to a dropship_* SQL function, which is one
// transaction (DATABASE_DESIGN §5). The adapter is an interface so tests can run the same
// SQL on an in-process Postgres.
export interface DropshipDb {
  call<T = any>(fn: string, args: Record<string, unknown>): Promise<T>;
}

// Rows that legacy code owns; read with the legacy server client.
export interface UserRestriction {
  exists: boolean;
  restricted: boolean;
}
export type UserRestrictionLoader = (uid: string) => Promise<UserRestriction>;

// Runs a function call, retrying once on a deadlock or lock timeout (DB §5.1 "Timeouts");
// every function here is idempotent or protected by a compare-and-set.
export async function callWithRetry<T>(run: () => Promise<{ data: T | null; error: DbErrorLike | null }>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const { data, error } = await run();
    if (!error) return data as T;
    const mapped = mapDbError(error);
    if (mapped.retryable && attempt === 1) continue;
    if (mapped.code === 'SERVER') console.error('[Dropship] database error', error.code, error.message);
    throw mapped;
  }
}

export function createSupabaseDropshipDb(client: { rpc: (fn: string, args: Record<string, unknown>) => any }): DropshipDb {
  return {
    call: (fn, args) => callWithRetry(async () => {
      const { data, error } = await client.rpc(fn, args);
      return { data, error };
    }),
  };
}

// ---------------------------------------------------------------------------------------
// Configuration and environment identity (ARCHITECTURE §12, RN-02, RN-03). Dropship is
// off unless explicitly enabled and the privileged configuration is consistent. It never
// falls back to the anon key (M-17).
// ---------------------------------------------------------------------------------------
export type DropshipCause = 'disabled' | 'config_missing' | 'config_invalid' | 'identity_mismatch';

export interface DropshipConfig {
  enabled: boolean;
  cause?: DropshipCause;
  url?: string;
  serviceRoleKey?: string;
}

function hostOf(url: string): string | null {
  try { return new URL(url).host.toLowerCase(); } catch { return null; }
}

function decodeJwtClaims(key: string): Record<string, unknown> | null {
  try {
    const payload = key.split('.')[1];
    if (!payload) return null;
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export function resolveDropshipConfig(env: Record<string, string | undefined>): DropshipConfig {
  if (env.DROPSHIP_ENABLED !== 'true') return { enabled: false, cause: 'disabled' };

  const key = env.SUPABASE_SERVICE_ROLE_KEY || '';
  const expectedRef = (env.DROPSHIP_EXPECTED_SUPABASE_REF || '').trim().toLowerCase();
  const urls = [env.SUPABASE_URL, env.VITE_SUPABASE_URL].filter((u): u is string => !!u);
  if (!key || !expectedRef || urls.length === 0) return { enabled: false, cause: 'config_missing' };

  // I-1: both URL variables, when set, must name the same host.
  const hosts = urls.map(hostOf);
  if (hosts.some(h => !h) || new Set(hosts).size > 1) return { enabled: false, cause: 'config_invalid' };

  // I-2: the host must be the expected project.
  if (hosts[0] !== `${expectedRef}.supabase.co`) return { enabled: false, cause: 'identity_mismatch' };

  // I-3: a JWT key must be a service_role key for the same project. sb_secret_ keys can't
  // be decoded; I-2 then carries the check.
  const claims = decodeJwtClaims(key);
  if (claims) {
    if (claims.role !== 'service_role') return { enabled: false, cause: 'config_invalid' };
    if (typeof claims.ref === 'string' && claims.ref.toLowerCase() !== expectedRef) {
      return { enabled: false, cause: 'identity_mismatch' };
    }
  } else if (!key.startsWith('sb_secret_')) {
    return { enabled: false, cause: 'config_invalid' };
  }

  return { enabled: true, url: urls[0], serviceRoleKey: key };
}

// Builds Dropship's own client from the service-role key only.
export function createDropshipDbFromConfig(config: DropshipConfig): DropshipDb | null {
  if (!config.enabled || !config.url || !config.serviceRoleKey) return null;
  const client = createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return createSupabaseDropshipDb(client);
}

export function unavailable(): DropshipError {
  return new DropshipError('DROPSHIP_UNAVAILABLE', 'Dropship is not available right now.');
}
