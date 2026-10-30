// Mirrors server/dropship/legacyGuards.ts isDropshipRowId exactly.
export function isDropshipRowId(id: unknown): boolean {
  return typeof id === 'string' && id.toLowerCase().startsWith('dsl_');
}

export function formatDeliveryWindow(min: number, max: number): string {
  if (min === max) return `${min} ${min === 1 ? 'day' : 'days'}`;
  return `${min}–${max} days`;
}

// Same output as the web app's formatPesewas (src/components/dropship/dropshipFormat.ts).
export function formatPesewas(pesewas: number): string {
  return `GH₵${(pesewas / 100).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** A v4-format UUID for idempotent requests (the server only needs it unique per buyer,
 * not secret). Uses crypto.getRandomValues when the runtime has it. */
export function makeRequestId(): string {
  const bytes = new Uint8Array(16);
  const c: any = (globalThis as any).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Client-side check before sending; the server checks everything again. */
export function deliveryDetailsProblem(d: { name: string; phone: string; region: string; area: string; address: string }): string | null {
  if (d.name.trim().length < 2) return 'Enter your full name.';
  if (!/^\+?[0-9]{9,15}$/.test(d.phone.replace(/[\s-]/g, ''))) return 'Enter a phone number the seller can call.';
  if (!d.region) return 'Choose your region.';
  if (d.area.trim().length < 2) return 'Enter your town or area.';
  if (d.address.trim().length < 5) return 'Enter your full address (house, street, landmark).';
  return null;
}
