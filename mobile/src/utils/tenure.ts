export function parseDate(dateVal: any): Date | null {
  if (!dateVal) return null;
  if (dateVal instanceof Date) return dateVal;

  if (typeof dateVal === 'object') {
    if (typeof dateVal.seconds === 'number') {
      return new Date(dateVal.seconds * 1000);
    }
    if (typeof dateVal._seconds === 'number') {
      return new Date(dateVal._seconds * 1000);
    }
    if (typeof dateVal.toDate === 'function') {
      try {
        return dateVal.toDate();
      } catch (_) {}
    }
  }

  if (typeof dateVal === 'string') {
    const trimmed = dateVal.trim();
    if (!trimmed) return null;
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d;

    const parts = trimmed.split(' ');
    if (parts.length === 2) {
      const dAlt = new Date(`1 ${trimmed}`);
      if (!isNaN(dAlt.getTime())) return dAlt;
    }
    return null;
  }

  const d = new Date(dateVal);
  if (!isNaN(d.getTime())) return d;

  return null;
}

/**
 * Formats a user's join date into a friendly "membership tenure" label on TedBuy.
 * - Under 2 months: "New on TedBuy"
 * - 2-11 months: "X+ months on TedBuy" (e.g. "6+ months on TedBuy")
 * - 1 year: "1+ year on TedBuy"
 * - 2+ years: "X+ years on TedBuy" (e.g. "2+ years on TedBuy", "3+ years on TedBuy")
 */
export function formatTedbuyTenure(dateVal: any): string {
  const d = parseDate(dateVal);
  if (!d) return 'New on TedBuy';

  const now = new Date();
  if (d.getTime() > now.getTime()) {
    return 'New on TedBuy';
  }

  let years = now.getFullYear() - d.getFullYear();
  let months = now.getMonth() - d.getMonth();

  if (now.getDate() < d.getDate()) {
    months--;
  }

  let totalMonths = years * 12 + months;
  if (totalMonths < 0) totalMonths = 0;

  if (totalMonths < 2) {
    return 'New on TedBuy';
  }

  const fullYears = Math.floor(totalMonths / 12);

  if (fullYears >= 1) {
    if (fullYears === 1) {
      return '1+ year on TedBuy';
    }
    return `${fullYears}+ years on TedBuy`;
  }

  return `${totalMonths}+ months on TedBuy`;
}
