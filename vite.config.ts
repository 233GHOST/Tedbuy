import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import {findSecretsInFrontendVars, resolveTedbuyEnvironment, validateStagingEnvironment} from './server/environmentGuard';

export default defineConfig(({ mode }) => {
  // Explicit environment check (server/environmentGuard.ts). TEDBUY_ENV unset keeps the
  // existing build unchanged; TEDBUY_ENV=staging refuses to build a bundle that could fall
  // back to production Firestore, use a production Supabase project, or embed a secret.
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env } as Record<string, string | undefined>;
  const { environment, error } = resolveTedbuyEnvironment(env);
  if (error) throw new Error(`[Environment] ${error}`);
  if (environment === 'staging') {
    const problems = validateStagingEnvironment(env);
    if (problems.length) throw new Error(`[Environment] Refusing to build for staging:\n  - ${problems.join('\n  - ')}`);
  } else {
    const exposed = findSecretsInFrontendVars(env);
    if (exposed.length) console.warn(`[Environment] WARNING: ${exposed.join(', ')} contain(s) a server secret and will be embedded in the public bundle.`);
  }

  return {
    plugins: [react(), tailwindcss()],
    define: {
      __TEDBUY_ENV__: JSON.stringify(environment === 'unspecified' ? '' : environment),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        'motion-dom': path.resolve(__dirname, 'node_modules/motion-dom/dist/cjs/index.js'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      headers: {
        'Link': '</sitemap.xml>; rel="sitemap", </.well-known/api-catalog>; rel="api-catalog", </auth.md>; rel="service-doc"'
      }
    },
  };
});
