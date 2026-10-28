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
