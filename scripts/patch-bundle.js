import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const assetsDir = path.resolve(__dirname, '../dist/assets');

if (!fs.existsSync(assetsDir)) {
  console.log('[Bundle Patcher] dist/assets directory not found. Skipping.');
  process.exit(0);
}

const files = fs.readdirSync(assetsDir);
let patchCount = 0;

files.forEach(file => {
  if (file.endsWith('.js')) {
    const filePath = path.join(assetsDir, file);
    let code = fs.readFileSync(filePath, 'utf8');
    
    // Look for: function Ee(n){if(n.indexOf("-")===-1)
    // We replace: `function Ee(n){if(n.indexOf("-")` with `function Ee(n){if(!n||typeof n.indexOf!=="function"||n.indexOf("-")`
    if (code.includes('function Ee(n){if(n.indexOf("-")')) {
      console.log(`[Bundle Patcher] Patching function Ee(n) in ${file}...`);
      code = code.replace(
        'function Ee(n){if(n.indexOf("-")',
        'function Ee(n){if(!n||typeof n.indexOf!=="function"||n.indexOf("-")'
      );
      fs.writeFileSync(filePath, code, 'utf8');
      patchCount++;
    }
  }
});

console.log(`[Bundle Patcher] Successfully completed. Patched ${patchCount} files.`);
