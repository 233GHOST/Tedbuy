// Checks a schema-only SQL dump before it is committed as the staging baseline
// (supabase/migrations/<timestamp>_legacy_baseline.sql). Pure text analysis: it never
// connects to a database. Findings name objects and line numbers, never matched values.

export interface BaselineFinding { severity: 'error' | 'warn' | 'ok'; message: string }

// Tables the existing application reads or writes (server.ts, src/dbAdapter.ts, sitemap).
export const REQUIRED_TABLES = ['users', 'products', 'chats', 'messages', 'reviews', 'reports', 'notifications',
  'store_names', 'boost_purchases', 'account_deletion_audits'];
// Referenced by server.ts but recorded as never created (.ai/handoffs/ADMIN_AUDIT_LOGS_SCHEMA_PROPOSAL.md).
export const KNOWN_ABSENT_TABLES = ['admin_audit_logs'];
// Columns the Dropship migration and gate rely on.
export const REQUIRED_USERS_COLUMNS = ['id', 'isSuspended', 'securityHold', 'isDeleted', 'status'];

const tableRe = (t: string) => new RegExp(`create table (?:if not exists )?(?:"?public"?\\.)?"?${t}"?\\s*\\(`, 'i');

function tableBody(sql: string, table: string): string | null {
  const m = tableRe(table).exec(sql);
  if (!m) return null;
  let depth = 0;
  for (let i = m.index + m[0].length - 1; i < sql.length; i++) {
    if (sql[i] === '(') depth++;
    else if (sql[i] === ')' && --depth === 0) return sql.slice(m.index, i + 1);
  }
  return null;
}

export function checkBaselineDump(sql: string): BaselineFinding[] {
  const out: BaselineFinding[] = [];
  const add = (severity: BaselineFinding['severity'], message: string) => out.push({ severity, message });
  const lines = sql.split('\n');
  const lineNos = (re: RegExp) => lines.flatMap((l, i) => (re.test(l) ? [i + 1] : []));
  const list = (ns: number[]) => (ns.length > 8 ? `${ns.slice(0, 8).join(', ')}, …` : ns.join(', '));

  // Must be schema only.
  const data = lineNos(/^\s*(COPY\s+\S+.*FROM stdin|INSERT INTO)/i);
  if (data.length) add('error', `Contains row data (COPY/INSERT) at lines ${list(data)}. Dump with schema only.`);

  // Must contain no credentials.
  const secrets = lineNos(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.|sk_(live|test)_[A-Za-z0-9]|sb_secret_|-----BEGIN [A-Z ]*PRIVATE KEY|\bPASSWORD\s+'/i);
  if (secrets.length) add('error', `Possible credential at lines ${list(secrets)}. Remove it; never commit keys or passwords.`);

  // Must precede the Dropship migration.
  const dropship = lineNos(/\bdropship_[a-z_]+/i);
  if (dropship.length) add('error', `Contains Dropship objects (lines ${list(dropship)}). The baseline must be taken before the Dropship migration and must not include it.`);

  // Required tables and columns.
  for (const t of REQUIRED_TABLES) if (!tableRe(t).test(sql)) add('error', `Missing table public.${t}, which the application uses.`);
  const users = tableBody(sql, 'users');
  if (users) {
    // Columns may be declared in CREATE TABLE (pg_dump) or added later with ALTER TABLE.
    const addedColumns = [...sql.matchAll(/alter table (?:if exists )?(?:only )?(?:"?public"?\.)?"?users"?\s+add column (?:if not exists )?"?([A-Za-z_]+)"?/gi)].map(m => m[1]);
    for (const c of REQUIRED_USERS_COLUMNS) {
      if (!new RegExp(`(^|[(,\\s])"?${c}"?\\s+[a-z]`, 'i').test(users) && !addedColumns.includes(c)) {
        add('error', `public.users has no "${c}" column (needed by Dropship's account-restriction check).`);
      }
    }
    if (!/"?id"?\s+text\b/i.test(users)) add('warn', 'public.users.id is not declared as text; the Dropship foreign keys reference it as text.');
  }
  for (const t of KNOWN_ABSENT_TABLES) {
    if (!tableRe(t).test(sql)) add('warn', `public.${t} is absent (expected: never created). server.ts writes to it and ignores the failure.`);
  }

  // Security model: report, the owner decides.
  for (const t of REQUIRED_TABLES) {
    if (tableRe(t).test(sql) && !new RegExp(`alter table (?:only )?(?:"?public"?\\.)?"?${t}"?\\s+enable row level security`, 'i').test(sql)) {
      add('warn', `RLS is not enabled on public.${t} (production "Phase 4" enabled it on every legacy table).`);
    }
  }
  const anonAll = lineNos(/GRANT ALL ON (TABLE )?.*TO "?(anon|authenticated)"?/i);
  if (anonAll.length) add('warn', `Blanket GRANT ALL to anon/authenticated at lines ${list(anonAll)}. Decide whether staging keeps them (matches production, RLS is the barrier) or removes them.`);
  if (!/publication/i.test(sql)) add('warn', 'No publication statements: Realtime membership is not captured. Record it separately (pg_publication_tables) and add it to the baseline.');

  if (!out.some(f => f.severity === 'error')) add('ok', 'No data, credentials or Dropship objects; required tables and users columns are present.');
  return out;
}
