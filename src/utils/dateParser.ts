import { Product } from '../types';

/**
 * Robustly parses various date formats (ISO string, JS Date, timestamp-like objects)
 * into a standard JavaScript Date object.
 */
export function parseDate(dateVal: any): Date | null {
  if (!dateVal) return null;
  if (dateVal instanceof Date) return dateVal;
  
  // Handle timestamp object in browser
  if (typeof dateVal.toDate === 'function') {
    try {
      return dateVal.toDate();
    } catch (_) {}
  }
  
  // Handle REST / serialized timestamp-like object
  if (typeof dateVal === 'object') {
    if (typeof dateVal.seconds === 'number') {
      return new Date(dateVal.seconds * 1000);
    }
    if (typeof dateVal._seconds === 'number') {
      return new Date(dateVal._seconds * 1000);
    }
  }
  
  // Fallback to standard constructor
  const d = new Date(dateVal);
  if (!isNaN(d.getTime())) {
    return d;
  }
  
  return null;
}

/**
 * Safely resolves the target boost end date from product metadata
 */
export function getBoostEndDate(product: Product | null | undefined): Date | null {
  if (!product) return null;

  // 1. Direct explicit end date field check
  const rawEnd =
    product.boostEndDate ||
    product.boostExpiry ||
    (product as any).boost_end_date ||
    (product as any).boost_expiry;

  if (rawEnd && rawEnd !== 'N/A' && rawEnd !== 'null' && rawEnd !== 'undefined') {
    const parsed = parseDate(rawEnd);
    if (parsed) return parsed;
  }

  // 2. Fallback: derive from boostStartDate / lastBoostedAt / lastBoostPurchase and boostPlan
  const rawStart =
    product.boostStartDate ||
    product.lastBoostedAt ||
    (product as any).lastBoostPurchase ||
    (product as any).boost_start_date ||
    (product as any).last_boosted_at;

  if (rawStart && rawStart !== 'N/A' && rawStart !== 'null' && rawStart !== 'undefined') {
    const startDate = parseDate(rawStart);
    if (startDate) {
      const planDaysMap: Record<string, number> = {
        '3days': 3,
        '7days': 7,
        '14days': 14,
        '21days': 21,
        '1month': 30
      };
      const plan = product.boostPlan || (product as any).boost_plan || '7days';
      const days = planDaysMap[plan] || 7;
      return new Date(startDate.getTime() + days * 24 * 60 * 60 * 1000);
    }
  }

  // 3. Fallback: if boostStatus / isBoosted flag is true but no dates exist, fallback to createdAt + plan
  const isBoostedFlag = !!(
    product.boostStatus === true ||
    (product as any).boostStatus === 'true' ||
    (product as any).isBoosted === true ||
    (product as any).is_boosted === true ||
    (product as any).boost_status === true ||
    (product as any).boost_status === 'true'
  );

  if (isBoostedFlag) {
    const created = parseDate(product.createdAt);
    if (created) {
      const planDaysMap: Record<string, number> = {
        '3days': 3,
        '7days': 7,
        '14days': 14,
        '21days': 21,
        '1month': 30
      };
      const plan = product.boostPlan || (product as any).boost_plan || '7days';
      const days = planDaysMap[plan] || 7;
      return new Date(created.getTime() + days * 24 * 60 * 60 * 1000);
    }
  }

  return null;
}

/**
 * Checks if a product has an active non-expired premium listing boost
 */
export function isBoostActive(product: Product | null | undefined): boolean {
  if (!product) return false;

  const endDate = getBoostEndDate(product);
  if (!endDate) return false;

  // Active ONLY if the computed end date is strictly in the future
  return endDate.getTime() > Date.now();
}
