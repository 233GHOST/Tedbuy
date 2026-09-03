/** Matches web's formatProductPrice (duplicated in ProductCard.tsx and
 * ProductDetail.tsx) — products store a raw number or free-text string
 * (see SellScreen.tsx's handlePublish), never a pre-formatted "GHS X,XXX"
 * string, so every place that renders a price has to format it this way. */
export function formatProductPrice(priceVal: string | number): string {
  if (typeof priceVal === 'string') {
    const lower = priceVal.trim().toLowerCase();
    if (lower === 'contact for price' || lower.includes('contact for price')) return 'Inquire';
  }
  const getGHFormatted = (num: number) => {
    try {
      return new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS', maximumFractionDigits: 0 }).format(num);
    } catch (e) {
      return `GH₵ ${num.toLocaleString()}`;
    }
  };
  if (typeof priceVal === 'number') return getGHFormatted(priceVal);
  const cleanStr = String(priceVal).replace(/GHS/gi, '').replace(/GH₵/gi, '').replace(/,/g, '').trim();
  const num = Number(cleanStr);
  if (!isNaN(num) && cleanStr !== '') return getGHFormatted(num);
  return priceVal;
}
