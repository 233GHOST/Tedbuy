import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const reactDomDir = path.resolve(__dirname, '../node_modules/react-dom');
const viteCacheDir = path.resolve(__dirname, '../node_modules/.vite');

if (!fs.existsSync(reactDomDir)) {
  console.log('[React-DOM Patcher] node_modules/react-dom directory not found. Skipping.');
  process.exit(0);
}

function walkDir(dir, callback) {
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      walkDir(filePath, callback);
    } else if (file.endsWith('.js')) {
      callback(filePath);
    }
  });
}

let patchCount = 0;

console.log('[React-DOM Patcher] Scanning and patching files in node_modules/react-dom...');

walkDir(reactDomDir, (filePath) => {
  let content = fs.readFileSync(filePath, 'utf8');
  let originalContent = content;

  // Pattern 1: -1 === type.indexOf("-")
  // Replace with: -1 === (!type || typeof type.indexOf !== "function" ? -1 : type.indexOf("-"))
  if (content.includes('type.indexOf("-")')) {
    content = content.replace(/type\.indexOf\s*\(\s*["']-["']\s*\)/g, '(!type || typeof type.indexOf !== "function" ? -1 : type.indexOf("-"))');
  }

  // Pattern 2: -1 === tagName.indexOf("-")
  // Replace with: -1 === (!tagName || typeof tagName.indexOf !== "function" ? -1 : tagName.indexOf("-"))
  if (content.includes('tagName.indexOf("-")')) {
    content = content.replace(/tagName\.indexOf\s*\(\s*["']-["']\s*\)/g, '(!tagName || typeof tagName.indexOf !== "function" ? -1 : tagName.indexOf("-"))');
  }

  // Pattern 3: r.indexOf("--")
  // Replace with: (!r || typeof r.indexOf !== "function" ? -1 : r.indexOf("--"))
  if (content.includes('r.indexOf("--")')) {
    content = content.replace(/r\.indexOf\s*\(\s*["']--["']\s*\)/g, '(!r || typeof r.indexOf !== "function" ? -1 : r.indexOf("--"))');
  }

  // Pattern 4: styleName.indexOf("-")
  // Replace with: (!styleName || typeof styleName.indexOf !== "function" ? -1 : styleName.indexOf("-"))
  if (content.includes('styleName.indexOf("-")')) {
    content = content.replace(/styleName\.indexOf\s*\(\s*["']-["']\s*\)/g, '(!styleName || typeof styleName.indexOf !== "function" ? -1 : styleName.indexOf("-"))');
  }

  // Pattern 5: nameChunk.indexOf("-")
  // Replace with: (!nameChunk || typeof nameChunk.indexOf !== "function" ? -1 : nameChunk.indexOf("-"))
  if (content.includes('nameChunk.indexOf("-")')) {
    content = content.replace(/nameChunk\.indexOf\s*\(\s*["']-["']\s*\)/g, '(!nameChunk || typeof nameChunk.indexOf !== "function" ? -1 : nameChunk.indexOf("-"))');
  }

  if (content !== originalContent) {
    fs.writeFileSync(filePath, content, 'utf8');
    patchCount++;
    console.log(`[React-DOM Patcher] Patched unsafe indexOf check in: ${path.relative(reactDomDir, filePath)}`);
  }
});

console.log(`[React-DOM Patcher] Completed. Patched ${patchCount} files.`);

// Force Vite to re-bundle dependencies
if (fs.existsSync(viteCacheDir)) {
  console.log('[React-DOM Patcher] Clearing Vite dependency cache to force pre-bundling rebuild...');
  try {
    fs.rmSync(viteCacheDir, { recursive: true, force: true });
    console.log('[React-DOM Patcher] Vite cache cleared successfully.');
  } catch (err) {
    console.warn('[React-DOM Patcher] Warning: failed to clear Vite cache directory:', err.message);
  }
}
