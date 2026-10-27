import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { callWithRetry, type DropshipDb, type UserRestrictionLoader } from '../db.js';

// In-process PostgreSQL (PGlite) with the real Dropship migration applied, for tests and
// the local demo server only. Never used by server.ts.

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATION_PATH = path.resolve(here, '../../../supabase/migrations/20261026120000_dropship_supplier_catalogue.sql');

// Supabase's roles and the legacy columns the gate reads. The live users table has many
// more columns; only these are needed here.
const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  create table public.users (
    id text primary key,
    username text not null,
    "isSuspended" boolean default false,
    "securityHold" boolean default false,
    "isDeleted" boolean default false,
    status text default 'active'
  );
  grant select on public.users to service_role;
`;

export interface PgliteDropship {
  pg: PGlite;
  db: DropshipDb;
  loadUserRestriction: UserRestrictionLoader;
  addUser(id: string, flags?: { isSuspended?: boolean; securityHold?: boolean; isDeleted?: boolean }): Promise<void>;
  close(): Promise<void>;
}

export async function createPgliteDropship(): Promise<PgliteDropship> {
  const pg = new PGlite();
  await pg.exec(SUPABASE_STUB);
  await pg.exec(fs.readFileSync(MIGRATION_PATH, 'utf8'));

  const db: DropshipDb = {
    call: (fn, args) => callWithRetry(async () => {
      if (!/^dropship_[a-z_]+$/.test(fn)) throw new Error(`bad function name ${fn}`);
      const names = Object.keys(args);
      for (const n of names) if (!/^p_[a-z_]+$/.test(n)) throw new Error(`bad argument name ${n}`);
      const params = names.map(n => {
        const v = args[n];
        return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
      });
      const sql = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as result`;
      try {
        // One transaction per call, as the service role (like PostgREST does).
        const rows = await pg.transaction(async tx => {
          await tx.exec('set local role service_role');
          return (await tx.query<{ result: unknown }>(sql, params)).rows;
        });
        return { data: rows[0]?.result as any, error: null };
      } catch (err: any) {
        return { data: null, error: { code: err.code, message: err.message, detail: err.detail } };
      }
    }),
  };

  return {
    pg,
    db,
    loadUserRestriction: async uid => {
      const { rows } = await pg.query<any>('select "isSuspended", "securityHold", "isDeleted", status from public.users where id = $1', [uid]);
      if (!rows[0]) return { exists: false, restricted: false };
      const r = rows[0];
      return { exists: true, restricted: r.isSuspended || r.securityHold || r.isDeleted || r.status === 'suspended' || r.status === 'deleted' };
    },
    addUser: async (id, flags = {}) => {
      await pg.query('insert into public.users (id, username, "isSuspended", "securityHold", "isDeleted") values ($1, $1, $2, $3, $4)',
        [id, !!flags.isSuspended, !!flags.securityHold, !!flags.isDeleted]);
    },
    close: () => pg.close(),
  };
}
