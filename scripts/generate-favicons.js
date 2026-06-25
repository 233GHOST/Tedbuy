import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function generate() {
  try {
    const svgPath = path.resolve(__dirname, '../public/favicon.svg');
    const publicDir = path.resolve(__dirname, '../public');

    if (!fs.existsSync(svgPath)) {
      console.error('Error: favicon.svg not found in public directory!');
      process.exit(1);
    }

    console.log('[Favicon Generator] Rendering PNGs from favicon.svg...');

    // Define sizes to render
    const sizes = {
      favicon16: { width: 16, height: 16, dest: path.join(publicDir, 'favicon-16.png') },
      favicon32: { width: 32, height: 32, dest: path.join(publicDir, 'favicon-32.png') },
      favicon48: { width: 48, height: 48, dest: path.join(publicDir, 'favicon-48.png') },
      apple: { width: 180, height: 180, dest: path.join(publicDir, 'apple-touch-icon.png') },
      icon192: { width: 192, height: 192, dest: path.join(publicDir, 'icon-192.png') },
      icon512: { width: 512, height: 512, dest: path.join(publicDir, 'favicon.png') }
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

    // We'll pack 16x16, 32x32, and 48x48 frames into favicon.ico
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
      entry.writeUInt8(frame.width, 0);     // Width
      entry.writeUInt8(frame.height, 1);    // Height
      entry.writeUInt8(0, 2);               // Color palette (0 = no palette)
      entry.writeUInt8(0, 3);               // Reserved
      entry.writeUInt16LE(1, 4);            // Color planes (1)
      entry.writeUInt16LE(32, 6);           // Bits per pixel (32 for PNG)
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
    console.log(`[Favicon Generator] Successfully created professional multi-resolution favicon.ico at ${icoDest}`);

    // Clean up temporary small PNGs if not strictly needed in index.html
    // Note: We keep favicon-48.png, favicon.png, apple-touch-icon.png, and icon-192.png because index.html references them.
    // We can clean up favicon-16.png and favicon-32.png as they are now fully packed inside favicon.ico!
    try {
      fs.unlinkSync(sizes.favicon16.dest);
      fs.unlinkSync(sizes.favicon32.dest);
    } catch (e) {}

  } catch (error) {
    console.error('[Favicon Generator] Error during favicon generation:', error);
    process.exit(1);
  }
}

generate();
