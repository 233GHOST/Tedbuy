// Read-only preflight for a staging/test TedBuy instance. Reads the environment the same
// way the server does (.env via dotenv, or the file given as the first argument) and
// reports hosts, project ids and key types only, never secret values.
//
//   npx tsx scripts/check-staging-config.ts            # uses .env + process environment
//   npx tsx scripts/check-staging-config.ts .env.staging
//
// Exit code 1 if anything would reach production or fail unsafely.
import dotenv from 'dotenv';
import firebaseConfig from '../firebase-applet-config.json';
import { formatFindings, runStagingPreflight } from '../server/dropship/stagingPreflight.js';

dotenv.config({ path: process.argv[2] || '.env', quiet: true });
const findings = runStagingPreflight(process.env, firebaseConfig.projectId);
console.log(formatFindings(findings));
const errors = findings.filter(f => f.severity === 'error').length;
console.log(errors ? `\n${errors} blocking problem(s). Do not start this instance.` : '\nNo blocking problems found.');
process.exit(errors ? 1 : 0);
