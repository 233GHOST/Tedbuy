import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadSharp() {
  try {
    const sharpModule = await import('sharp');
    return sharpModule.default ?? sharpModule;
  } catch (error) {
    throw new Error(`Sharp import failed: ${error.message}`);
  }
}

async function generate() {
  try {
    const svgPath = path.resolve(__dirname, '../public/favicon.svg');
    const publicDir = path.resolve(__dirname, '../public');
    const mobileAssetsDir = path.resolve(__dirname, '../mobile/assets');

    if (!fs.existsSync(svgPath)) {
      console.error('Error: favicon.svg not found in public directory!');
      process.exit(1);
    }

    console.log('[Favicon Generator] Rendering PNGs from favicon.svg...');

    const sharp = await loadSharp();

    // Define all web sizes to render (including Google Search preferred multiples of 48px: 48, 96, 144, 192)
    const sizes = {
      favicon16: { width: 16, height: 16, dest: path.join(publicDir, 'favicon-16.png') },
      favicon32: { width: 32, height: 32, dest: path.join(publicDir, 'favicon-32.png') },
      favicon48: { width: 48, height: 48, dest: path.join(publicDir, 'favicon-48.png') },
      favicon96: { width: 96, height: 96, dest: path.join(publicDir, 'favicon-96.png') },
      favicon144: { width: 144, height: 144, dest: path.join(publicDir, 'favicon-144.png') },
      apple: { width: 180, height: 180, dest: path.join(publicDir, 'apple-touch-icon.png') },
      icon192: { width: 192, height: 192, dest: path.join(publicDir, 'icon-192.png') },
      icon192x192: { width: 192, height: 192, dest: path.join(publicDir, 'icon-192x192.png') },
      icon512: { width: 512, height: 512, dest: path.join(publicDir, 'favicon.png') },
      icon512x512: { width: 512, height: 512, dest: path.join(publicDir, 'icon-512x512.png') }
    };

    const pngBuffers = {};

    for (const [key, cfg] of Object.entries(sizes)) {
      const buf = await sharp(svgPath)
        .resize(cfg.width, cfg.height)
        .png()
        .toBuffer();
      
      fs.writeFileSync(cfg.dest, buf);
      pngBuffers[key] = buf;
      console.log(`[Favicon Generator] Generated ${cfg.width}x${cfg.height} -> ${path.basename(cfg.dest)}`);
    }

    console.log('[Favicon Generator] Generating multi-resolution favicon.ico...');

    // We pack 16x16, 32x32, and 48x48 frames into favicon.ico (Standard Windows / Google standard)
    const icoFrames = [
      { width: 16, height: 16, buf: pngBuffers.favicon16 },
      { width: 32, height: 32, buf: pngBuffers.favicon32 },
      { width: 48, height: 48, buf: pngBuffers.favicon48 }
    ];

    const count = icoFrames.length;
    const headerSize = 6;
    const dirEntrySize = 16;
    
    const header = Buffer.alloc(headerSize);
    header.writeUInt16LE(0, 0);     // Reserved
    header.writeUInt16LE(1, 2);     // Type: 1 (ICO)
    header.writeUInt16LE(count, 4); // Number of images

    const entries = [];
    const dataBuffers = [];
    let currentOffset = headerSize + dirEntrySize * count;

    for (const frame of icoFrames) {
      const entry = Buffer.alloc(dirEntrySize);
      entry.writeUInt8(frame.width, 0);         // Width
      entry.writeUInt8(frame.height, 1);        // Height
      entry.writeUInt8(0, 2);                   // Color palette (0 = no palette)
      entry.writeUInt8(0, 3);                   // Reserved
      entry.writeUInt16LE(1, 4);                // Color planes (1)
      entry.writeUInt16LE(32, 6);               // Bits per pixel (32 for PNG)
      entry.writeUInt32LE(frame.buf.length, 8); // Image data size
      entry.writeUInt32LE(currentOffset, 12);   // Image data offset

      entries.push(entry);
      dataBuffers.push(frame.buf);
      
      currentOffset += frame.buf.length;
    }

    const icoBuffer = Buffer.concat([
      header,
      ...entries,
      ...dataBuffers
    ]);

    const icoDest = path.join(publicDir, 'favicon.ico');
    fs.writeFileSync(icoDest, icoBuffer);
    console.log(`[Favicon Generator] Successfully created multi-resolution favicon.ico at ${icoDest}`);

    // Update Mobile App Assets if directory exists
    if (fs.existsSync(mobileAssetsDir)) {
      const mobileIcon1024 = await sharp(svgPath).resize(1024, 1024).png().toBuffer();
      const mobileIcon512 = await sharp(svgPath).resize(512, 512).png().toBuffer();

      fs.writeFileSync(path.join(mobileAssetsDir, 'icon.png'), mobileIcon1024);
      fs.writeFileSync(path.join(mobileAssetsDir, 'adaptive-icon.png'), mobileIcon1024);
      fs.writeFileSync(path.join(mobileAssetsDir, 'favicon.png'), mobileIcon512);
      fs.writeFileSync(path.join(mobileAssetsDir, 'splash-icon.png'), mobileIcon512);
      console.log('[Favicon Generator] Updated mobile application assets in mobile/assets/');
    }

  } catch (error) {
    console.error('[Favicon Generator] Error during favicon generation:', error);
    process.exit(1);
  }
}

generate();
