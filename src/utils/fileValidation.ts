export function validateImageFile(file: File): { isValid: boolean; error?: string } {
  const allowedExtensions = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'jfif'];
  const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/jfif'];

  const fileNameLower = file.name.toLowerCase();
  const fileExtMatch = fileNameLower.match(/\.([a-z0-9]+)$/);
  const fileExt = fileExtMatch ? fileExtMatch[1] : '';

  // 1. Strictly block SVG uploads to prevent Stored/DOM XSS through embedded XML scripting
  if (fileExt === 'svg' || file.type === 'image/svg+xml') {
    return {
      isValid: false,
      error: 'SVG image uploads are strictly prohibited for security reasons (Stored XSS protection).'
    };
  }

  // 2. Validate file extension matches our safe whitelist
  if (!allowedExtensions.includes(fileExt)) {
    return {
      isValid: false,
      error: 'Unsupported file extension. Please upload high-quality PNG, JPG, or WEBP pictures.'
    };
  }

  // 3. Validate MIME type if it is provided by the client/browser
  if (file.type && !allowedMimeTypes.includes(file.type)) {
    return {
      isValid: false,
      error: 'Unsupported image format. Please select standard JPEG, PNG, WEBP, or HEIC image files.'
    };
  }

  // 4. Enforce strict maximum file size limit (50MB limit)
  const maxBytes = 50 * 1024 * 1024; // 50MB
  if (file.size > maxBytes) {
    return {
      isValid: false,
      error: 'The selected picture is too large. Please upload an image smaller than 50MB.'
    };
  }

  return { isValid: true };
}
