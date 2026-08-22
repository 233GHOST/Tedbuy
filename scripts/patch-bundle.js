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
    
    // Look for: function XX(n){if(n.indexOf("-")
    // We replace it with: function XX(n){if(!n||typeof n.indexOf!=="function"||n.indexOf("-")
    const regex = /function\s+([a-zA-Z0-9_$]+)\s*\(\s*([a-zA-Z0-9_$]+)\s*\)\s*\{\s*if\s*\(\s*\2\.indexOf\s*\(\s*["']-["']\s*\)/g;
    if (regex.test(code)) {
      console.log(`[Bundle Patcher] Patching custom element check in ${file}...`);
      code = code.replace(regex, (match, fnName, paramName) => {
        return `function ${fnName}(${paramName}){if(!${paramName}||typeof ${paramName}.indexOf!=="function"||${paramName}.indexOf("-")`;
      });
      fs.writeFileSync(filePath, code, 'utf8');
      patchCount++;
    }
  }
});

console.log(`[Bundle Patcher] Successfully completed. Patched ${patchCount} files.`);
