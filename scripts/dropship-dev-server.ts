// Local demo of the Dropship supplier catalogue: the real router and the real migration on
// an in-memory PostgreSQL (PGlite). Development only. It replaces Firebase sign-in with
// three fixed dev identities chosen in the page, so it must never run in production and
// listens on 127.0.0.1 only. Nothing here touches Supabase, Firebase or Cloudinary.
//
//   npm run dev:dropship   ->  http://127.0.0.1:3311
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createDropshipRouter, type DropshipVerifiedUser } from '../server/dropship/routes.js';
import { createPgliteDropship } from '../server/dropship/testing/pgliteDb.js';

if (process.env.NODE_ENV === 'production' || process.env.RENDER || process.env.VERCEL) {
  console.error('dropship-dev-server refuses to run in a production or hosted environment.');
  process.exit(1);
}

const PORT = Number(process.env.DROPSHIP_DEV_PORT || 3311);
const CLOUD = 'dfm3g2qvg';
const here = path.dirname(fileURLToPath(import.meta.url));

const DEV_USERS: Record<string, DropshipVerifiedUser> = {
  'dev-admin': { uid: 'dev-admin', email: 'admin@dev.local', isAdmin: true, emailVerified: true },
  'dev-supplier': { uid: 'dev-supplier', email: 'supplier@dev.local', emailVerified: true },
  'dev-buyer': { uid: 'dev-buyer', email: 'buyer@dev.local', emailVerified: true },
};

const h = await createPgliteDropship();
for (const uid of Object.keys(DEV_USERS)) await h.addUser(uid);

const app = express();
app.use(express.json({ limit: '100kb' }));
app.get('/', (_req, res) => {
  res.type('html').send(fs.readFileSync(path.resolve(here, '../server/dropship/dev/console.html'), 'utf8').replaceAll('__CLOUD__', CLOUD));
});
app.use(createDropshipRouter({
  enabled: true,
  db: h.db,
  loadUserRestriction: h.loadUserRestriction,
  cloudinaryCloudName: CLOUD,
  verifyUser: async auth => (auth?.startsWith('Bearer ') ? DEV_USERS[auth.slice(7)] ?? null : null),
}));

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Dropship dev console: http://127.0.0.1:${PORT}  (in-memory database; data resets on restart)`);
});
