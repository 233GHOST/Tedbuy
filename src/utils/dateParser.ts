import { Product } from '../types';

/**
 * Robustly parses various date formats (ISO string, JS Date, Firestore Timestamp, or Timestamp-like objects)
 * into a standard JavaScript Date object.
 */
export function parseDate(dateVal: any): Date | null {
  if (!dateVal) return null;
  if (dateVal instanceof Date) return dateVal;
  
  // Handle Firestore Timestamp object in browser
  if (typeof dateVal.toDate === 'function') {
    try {
      return dateVal.toDate();
    } catch (_) {}
  }
  
  // Handle REST / serialized Firestore Timestamp
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
 * Checks if a product has an active premium listing boost
 */
export function isBoostActive(product: Product | null | undefined): boolean {
  if (!product) return false;
  if (!product.boostStatus) return false;
  const endDate = parseDate(product.boostEndDate);
  if (!endDate) return false;
  return endDate.getTime() > Date.now();
}
