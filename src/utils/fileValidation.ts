/**
 * File validation utilities for TedBuy.
 * Validates images using extension, MIME type, AND magic byte signatures
 * to prevent upload of malicious files disguised as images.
 */

// Magic byte signatures (file headers) for allowed image types
const MAGIC_BYTES: Record<string, number[][]> = {
  'image/jpeg': [
    [0xFF, 0xD8, 0xFF], // JPEG/JFIF
  ],
  'image/png': [
    [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], // PNG
  ],
  'image/webp': [
    [0x52, 0x49, 0x46, 0x46], // RIFF header (WebP starts with RIFF....WEBP)
  ],
  'image/heic': [
    [0x00, 0x00, 0x00], // HEIC ftyp box (first 4 bytes are size, bytes 4-7 are 'ftyp')
  ],
  'image/jfif': [
    [0xFF, 0xD8, 0xFF], // Same as JPEG
  ],
};

/**
 * Reads the first N bytes of a File to check magic byte signatures.
 * Returns true if the file header matches any allowed image format.
 */
async function checkMagicBytes(file: File): Promise<boolean> {
  try {
    const buffer = await file.slice(0, 12).arrayBuffer();
    const bytes = new Uint8Array(buffer);

    for (const [, signatures] of Object.entries(MAGIC_BYTES)) {
      for (const signature of signatures) {
        let matches = true;
        for (let i = 0; i < signature.length; i++) {
          if (bytes[i] !== signature[i]) {
            matches = false;
            break;
          }
        }
        if (matches) return true;
      }
    }

    // Special check for WebP: RIFF....WEBP
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
      if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
        return true;
      }
    }

    // Special check for HEIC/HEIF: ftyp box at offset 4
    if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
      return true;
    }

    return false;
  } catch {
    // If we can't read the file, fail closed
    return false;
  }
}

export async function validateImageFile(file: File): Promise<{ isValid: boolean; error?: string }> {
  const allowedExtensions = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'jfif'];
  const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/jfif'];

  const fileNameLower = file.name.toLowerCase();
  const fileExtMatch = fileNameLower.match(/\.([a-z0-9]+)$/);
  const fileExt = fileExtMatch ? fileExtMatch[1] : '';

  // 1. Strictly block SVG uploads to prevent Stored/DOM XSS
  if (fileExt === 'svg' || file.type === 'image/svg+xml') {
    return {
      isValid: false,
      error: 'SVG image uploads are strictly prohibited for security reasons (Stored XSS protection).'
    };
  }

  // 2. Validate file extension
  if (!allowedExtensions.includes(fileExt)) {
    return {
      isValid: false,
      error: 'Unsupported file extension. Please upload high-quality PNG, JPG, or WEBP pictures.'
    };
  }

  // 3. Validate MIME type (browser-provided, not trusted alone)
  if (file.type && !allowedMimeTypes.includes(file.type)) {
    return {
      isValid: false,
      error: 'Unsupported image format. Please select standard JPEG, PNG, WEBP, or HEIC image files.'
    };
  }

  // 4. Validate magic bytes (actual file content verification)
  const hasValidMagicBytes = await checkMagicBytes(file);
  if (!hasValidMagicBytes) {
    return {
      isValid: false,
      error: 'The file content does not match a valid image format. It may be corrupted or disguised.'
    };
  }

  // 5. Enforce strict maximum file size limit
  const maxBytes = 50 * 1024 * 1024; // 50MB
  if (file.size > maxBytes) {
    return {
      isValid: false,
      error: 'The selected picture is too large. Please upload an image smaller than 50MB.'
    };
  }

  return { isValid: true };
}
