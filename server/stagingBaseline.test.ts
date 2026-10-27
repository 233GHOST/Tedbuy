import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REQUIRED_TABLES, checkBaselineDump } from './stagingBaseline.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = (sql: string) => checkBaselineDump(sql).filter(f => f.severity === 'error').map(f => f.message).join('\n');
const warns = (sql: string) => checkBaselineDump(sql).filter(f => f.severity === 'warn').map(f => f.message).join('\n');

// A minimal synthetic "good" dump in pg_dump style.
const good = [
  'CREATE TABLE IF NOT EXISTS "public"."users" ("id" text NOT NULL, "username" text, "isSuspended" boolean, "securityHold" boolean, "isDeleted" boolean, "status" text);',
  ...REQUIRED_TABLES.filter(t => t !== 'users').map(t => `CREATE TABLE IF NOT EXISTS "public"."${t}" ("id" text NOT NULL);`),
  ...REQUIRED_TABLES.map(t => `ALTER TABLE "public"."${t}" ENABLE ROW LEVEL SECURITY;`),
  'ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."messages";',
].join('\n');

test('a clean schema-only dump passes', () => {
  assert.equal(errors(good), '');
  assert.match(warns(good), /admin_audit_logs is absent/);
});

test('row data, credentials and Dropship objects are blocking', () => {
  assert.match(errors(`${good}\nCOPY "public"."users" ("id") FROM stdin;`), /row data/);
  assert.match(errors(`${good}\nINSERT INTO public.users VALUES ('u1');`), /row data/);
  assert.match(errors(`${good}\n-- key eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.abc`), /Possible credential/);
  assert.match(errors(`${good}\nALTER ROLE x WITH PASSWORD 'hunter2';`), /Possible credential/);
  assert.match(errors(`${good}\nCREATE TABLE public.dropship_participants (id uuid);`), /Dropship objects/);
});

test('missing tables and Dropship-required users columns are blocking', () => {
  assert.match(errors(good.replace(/.*"reports".*\n/g, '')), /Missing table public\.reports/);
  assert.match(errors(good.replace('"securityHold" boolean, ', '')), /no "securityHold" column/);
  assert.equal(errors(`${good.replace('"securityHold" boolean, ', '')}\nALTER TABLE public.users ADD COLUMN IF NOT EXISTS "securityHold" BOOLEAN;`), '',
    'a column added by ALTER TABLE counts');
});

test('blanket anon grants, tables without RLS and missing Realtime setup are reported', () => {
  const w = warns(`${good.replace(/ALTER TABLE "public"."chats" ENABLE ROW LEVEL SECURITY;\n/, '').replace(/ALTER PUBLICATION.*/, '')}\nGRANT ALL ON TABLE "public"."users" TO "anon";`);
  assert.match(w, /Blanket GRANT ALL/);
  assert.match(w, /RLS is not enabled on public\.chats/);
  assert.match(w, /Realtime membership is not captured/);
});

test("the repository's own supabase_schema.sql is not a valid baseline", () => {
  const repoSchema = fs.readFileSync(path.join(root, 'supabase_schema.sql'), 'utf8');
  assert.equal(errors(repoSchema), 'Missing table public.reports, which the application uses.');
  const w = warns(repoSchema);
  assert.match(w, /Blanket GRANT ALL/);
  assert.match(w, /RLS is not enabled on public\.users/);
});
