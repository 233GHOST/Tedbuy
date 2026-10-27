// Checks a schema-only dump before it becomes the staging baseline. Reads one local file;
// connects to nothing; prints object names and line numbers only.
//
//   npx tsx scripts/check-schema-baseline.ts path/to/baseline.sql
import fs from 'node:fs';
import { checkBaselineDump } from '../server/stagingBaseline.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage: npx tsx scripts/check-schema-baseline.ts <schema-dump.sql>');
  process.exit(2);
}
const findings = checkBaselineDump(fs.readFileSync(file, 'utf8'));
const tag = { error: 'ERROR', warn: 'WARN ', ok: 'OK   ' } as const;
for (const f of findings) console.log(`${tag[f.severity]} ${f.message}`);
const errors = findings.filter(f => f.severity === 'error').length;
console.log(errors ? `\n${errors} blocking problem(s): do not commit this file.` : '\nNo blocking problems. Review the warnings with the owner before committing.');
process.exit(errors ? 1 : 0);
