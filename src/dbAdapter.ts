import { createClient } from '@supabase/supabase-js';
import {
  getFirestore,
  collection as firestoreCollection,
  doc as firestoreDoc,
  setDoc as firestoreSetDoc,
  getDoc as firestoreGetDoc,
  getDocs as firestoreGetDocs,
  updateDoc as firestoreUpdateDoc,
  deleteDoc as firestoreDeleteDoc,
  writeBatch as firestoreWriteBatch,
  onSnapshot as firestoreOnSnapshot,
  query as firestoreQuery,
  where as firestoreWhere,
  orderBy as firestoreOrderBy,
  limit as firestoreLimit,
  increment as firestoreIncrement,
  type DocumentReference,
  type Query
} from 'firebase/firestore';
import { normalizeProduct } from './utils/productUtils';
import { db } from './firebase';

// -------------------------------------------------------------
// Initialize Supabase Client if credentials are provided
// -------------------------------------------------------------
const supabaseUrl = (import.meta as any).env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = (import.meta as any).env.VITE_SUPABASE_ANON_KEY || '';
const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

function parseMediaArray(val: any): string[] {
  if (!val) return [];
  let current = val;
  while (typeof current === 'string') {
    const trimmed = current.trim();
    if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
      try {
        current = JSON.parse(trimmed);
      } catch (_) {
        break;
      }
    } else {
      break;
    }
  }
  if (Array.isArray(current)) {
    return current.filter((item: any) => typeof item === 'string' && item.trim().length > 0 && item !== '[]' && item !== 'null');
  }
  if (typeof current === 'string' && current.trim().length > 0 && current !== '[]' && current !== 'null') {
    return [current.trim()];
  }
  return [];
}

const isValidUrl = (url: string) => {
  return typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'));
};

export const isSupabaseActive = isSupabaseConfigured;

export const supabase = isSupabaseActive
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

if (isSupabaseActive) {
  console.log('[Supabase Adapter] Active! Routing app data to Supabase PostgreSQL.');
} else {
  console.warn('[Supabase Adapter] Inactive. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable Supabase-backed app data storage.');
}

// Map legacy collection/table path names to Supabase table names
const VALID_TABLE_MAP: Record<string, string> = {
  users: 'users',
  products: 'products',
  chats: 'chats',
  messages: 'messages',
  notifications: 'notifications',
  reviews: 'reviews',
  reports: 'reports',
  storenames: 'store_names',
  store_names: 'store_names',
  boostpurchases: 'boost_purchases',
  boost_purchases: 'boost_purchases',
  deletedemails: 'users',
  deleted_emails: 'users'
};

function mapPathToTable(path: string): string {
  if (!path) return 'users';
  const clean = path.replace(/^\//, '').replace(/\/$/, '').trim();
  let normalized = clean.toLowerCase();
  if (normalized.includes('.')) {
    normalized = normalized.split('.').pop() || normalized;
  }
  return VALID_TABLE_MAP[normalized] || 'users';
}

function getDocPathInfo(docRef: any): { table: string; id: string; originalPath: string } {
  if (!docRef || typeof docRef.path !== 'string') {
    throw new Error(`Invalid document reference: ${JSON.stringify(docRef)}`);
  }

  const cleanPath = docRef.path.replace(/^\//, '').replace(/\/$/, '').trim();
  const parts = cleanPath.split('/').filter(Boolean);
  if (parts.length === 0) {
    throw new Error(`Invalid document reference path: "${docRef.path}"`);
  }

  let table = 'users';
  let id = '';

  if (parts.length >= 2) {
    table = mapPathToTable(parts[0]);
    id = String(docRef.id || parts[parts.length - 1] || '').trim();
  } else {
    table = 'users';
    id = parts[0];
  }

  if (!TABLE_COLUMNS[table]) {
    table = 'users';
  }

  if (!id) {
    throw new Error(`Invalid document reference for table "${table}": document ID is missing in path "${docRef.path}".`);
  }

  return { table, id, originalPath: docRef.path };
}

function sanitizePayload(data: any): any {
  if (!data || typeof data !== 'object') return data;
  
  const cleaned: any = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) {
      cleaned[k] = null;
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      cleaned[k] = sanitizePayload(v);
    } else {
      cleaned[k] = v;
    }
  }
  return cleaned;
}

// Allowed columns in our PostgreSQL schema
const TABLE_COLUMNS: Record<string, Set<string>> = {
  users: new Set([
    'id', 'username', 'email', 'phoneNumber', 'whatsAppNumber', 'role', 
    'joinDate', 'photoUrl', 'followingSellers', 'savedProductIds', 
    'emailVerified', 'isGoogleAuth', 'authProvider', 'isAdmin', 'welcomeSent', 'isSuspended', 'createdAt'
  ]),
  products: new Set([
    'id', 'title', 'description', 'price', 'currency', 'category', 'subcategory', 'location', 
    'images', 'imageUrls', 'thumbnailUrls', 'videos', 'videoUrls', 'videoPoster', 'brand', 'condition', 'negotiable', 'sellerId', 
    'sellerName', 'sellerEmail', 'sellerPhoto', 'sellerJoinDate', 'createdAt', 'updatedAt', 'viewsCount', 'likesCount', 'likedUserIds', 
    'status', 'boostStatus', 'boostExpiry', 'boostPlan', 'boostStartDate', 'boostEndDate', 
    'boostPriority', 'priorityScore', 'boostPriorityLevel', 'boostPackagePrice', 
    'remainingBoostTime', 'boostAmount', 'lastBoostedAt', 'lastBoostPurchase', 
    'paymentStatus', 'paymentReference', 'boostHistory', 'visitCount', 'isApproved',
    'thumbnailUrl', 'videoPosterUrl', 'primaryPicture'
  ]),
  chats: new Set([
    'id', 'productId', 'productTitle', 'productPrice', 'productImage', 
    'buyerId', 'buyerName', 'sellerId', 'sellerName', 'lastMessageText', 
    'lastMessageTime', 'tradeStatus', 'adId', 'adTitle', 'adImage', 
    'adThumbnail', 'adType'
  ]),
  messages: new Set([
    'id', 'chatId', 'senderId', 'recipientId', 'text', 'createdAt', 'read'
  ]),
  reviews: new Set([
    'id', 'buyerId', 'buyerName', 'sellerId', 'rating', 'comment', 'productTitle', 'createdAt'
  ]),
  notifications: new Set([
    'id', 'userId', 'title', 'message', 'type', 'read', 'createdAt', 'relatedId',
    'triggerUserId', 'triggerUsername', 'triggerUserPhoto', 'productId', 'productTitle', 'productPrice', 'productImage', 'chatId'
  ]),
  store_names: new Set([
    'id', 'userId', 'username'
  ]),
  boost_purchases: new Set([
    'id', 'productId', 'userId', 'amount', 'currency', 'status', 'createdAt'
  ])
};

function filterTableColumns(table: string, data: any): any {
  const allowed = TABLE_COLUMNS[table];
  if (!allowed || !data || typeof data !== 'object' || Array.isArray(data)) {
    return data;
  }
  const filtered: any = {};
  for (const [key, value] of Object.entries(data)) {
    if (allowed.has(key)) {
      filtered[key] = value;
    }
  }
  return filtered;
}

function transformForSupabaseClient(table: string, data: any, docId: string): any {
  const result: any = { ...data };
  if (!result.id) {
    result.id = docId;
  }
  
  for (const [k, v] of Object.entries(result)) {
    if (v === undefined) {
      result[k] = null;
    }
  }

  if (table === 'users') {
    if (!result.username) {
      result.username = result.email ? result.email.split('@')[0] : 'User_' + docId.substring(0, 5);
    }
    result.emailVerified = result.emailVerified === true;
    result.isGoogleAuth = result.isGoogleAuth === true;
    result.isAdmin = result.isAdmin === true;
    result.welcomeSent = result.welcomeSent === true;
    result.isSuspended = result.isSuspended === true;
    if (result.followingSellers && typeof result.followingSellers === 'string') {
      try { result.followingSellers = JSON.parse(result.followingSellers); } catch (_) { result.followingSellers = []; }
    }
    if (!Array.isArray(result.followingSellers)) result.followingSellers = [];
    if (result.savedProductIds && typeof result.savedProductIds === 'string') {
      try { result.savedProductIds = JSON.parse(result.savedProductIds); } catch (_) { result.savedProductIds = []; }
    }
    if (!Array.isArray(result.savedProductIds)) result.savedProductIds = [];
  } else if (table === 'products') {
    result.currency = result.currency || 'GHS';
    result.status = result.status || 'active';
    result.negotiable = result.negotiable === true;
    result.boostStatus = result.boostStatus === true;
    result.isApproved = result.isApproved !== false;
    result.viewsCount = Number(result.viewsCount) || 0;
    result.likesCount = Number(result.likesCount) || 0;
    result.price = Number(result.price) || 0;
    result.boostPriority = Number(result.boostPriority) || 0;
    result.priorityScore = Number(result.priorityScore) || 0;
    result.boostPriorityLevel = Number(result.boostPriorityLevel) || 0;
    result.boostPackagePrice = Number(result.boostPackagePrice) || 0;
    result.remainingBoostTime = Number(result.remainingBoostTime) || 0;
    result.boostAmount = Number(result.boostAmount) || 0;
    result.visitCount = Number(result.visitCount) || 0;
    
    // Parse media arrays cleanly, preserving full uploaded items
    const imgsFromImages = parseMediaArray(result.images);
    const imgsFromUrls = parseMediaArray(result.imageUrls);
    const imgs = imgsFromImages.length >= imgsFromUrls.length ? imgsFromImages : imgsFromUrls;
    result.images = imgs;
    result.imageUrls = imgs;
    if (imgs.length > 0) {
      result.displayImage = imgs[0];
      result.primaryPicture = imgs[0];
    }
    
    const vidsFromVideos = parseMediaArray(result.videos);
    const vidsFromUrls = parseMediaArray(result.videoUrls);
    const vids = vidsFromVideos.length >= vidsFromUrls.length ? vidsFromVideos : vidsFromUrls;
    result.videos = vids;
    result.videoUrls = vids;

    if (result.likedUserIds && typeof result.likedUserIds === 'string') {
      try { result.likedUserIds = JSON.parse(result.likedUserIds); } catch (_) { result.likedUserIds = []; }
    }
    if (!Array.isArray(result.likedUserIds)) result.likedUserIds = [];
    if (result.boostHistory && typeof result.boostHistory === 'string') {
      try { result.boostHistory = JSON.parse(result.boostHistory); } catch (_) { result.boostHistory = []; }
    }
    if (!Array.isArray(result.boostHistory)) result.boostHistory = [];
  } else if (table === 'messages') {
    result.read = result.read === true;
  } else if (table === 'reviews') {
    result.rating = Number(result.rating) || 5;
  } else if (table === 'notifications') {
    result.read = result.read === true;
  } else if (table === 'boost_purchases') {
    result.amount = Number(result.amount) || 0;
  }

  return filterTableColumns(table, result);
}

function getTableSelectColumns(table: string): string {
  return '*';
}

const clientKnownMissingColumns: Record<string, Set<string>> = {};

function extractMissingColumnFromError(errMsg: string): string | null {
  if (!errMsg || typeof errMsg !== 'string') return null;
  const regexes = [
    /Could not find the '([^']+)' column/i,
    /column ["']?([^"'\s]+)["']? of relation/i,
    /column (?:[^\s]+\.)?["']?([^"'\s]+)["']? does not exist/i,
    /Column '([^']+)' does not exist/i,
    /column '([^']+)' does not exist/i
  ];
  for (const rx of regexes) {
    const match = errMsg.match(rx);
    if (match && match[1]) {
      return match[1];
    }
  }
  return null;
}

function pruneClientKnownMissingColumns(table: string, payload: any): any {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const missingSet = clientKnownMissingColumns[table];
  if (!missingSet || missingSet.size === 0) return payload;

  const cleaned = { ...payload };
  for (const col of missingSet) {
    delete cleaned[col];
  }
  return cleaned;
}

async function safeSupabaseUpsert(table: string, payload: any, options: any = { onConflict: 'id' }): Promise<{ data: any; error: any }> {
  if (!supabase) return { data: null, error: new Error('Supabase client not initialized') };
  if (!clientKnownMissingColumns[table]) clientKnownMissingColumns[table] = new Set<string>();

  let currentPayload = pruneClientKnownMissingColumns(table, payload);
  const maxAttempts = 50;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { data, error } = await supabase
      .from(table)
      .upsert(currentPayload, options);

    if (!error) {
      return { data, error: null };
    }

    const errMsg = [error.message, error.details, error.hint].filter(Boolean).join(' ');
    const missingCol = extractMissingColumnFromError(errMsg);

    if (missingCol) {
      console.warn(`[Supabase Auto-Heal Client] Column '${missingCol}' missing in table '${table}'. Pruning and retrying (${attempt + 1}/${maxAttempts})...`);
      clientKnownMissingColumns[table].add(missingCol);
      delete currentPayload[missingCol];
      if (Object.keys(currentPayload).length === 0) {
        return { data: null, error: null };
      }
    } else {
      return { data, error };
    }
  }
  return await supabase.from(table).upsert(currentPayload, options);
}

async function safeSupabaseUpdate(table: string, payload: any, id: string): Promise<{ data: any; error: any }> {
  if (!supabase) return { data: null, error: new Error('Supabase client not initialized') };
  if (!clientKnownMissingColumns[table]) clientKnownMissingColumns[table] = new Set<string>();

  let currentPayload = pruneClientKnownMissingColumns(table, payload);
  const maxAttempts = 50;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { data, error } = await supabase
      .from(table)
      .update(currentPayload)
      .eq('id', id);

    if (!error) {
      return { data, error: null };
    }

    const errMsg = [error.message, error.details, error.hint].filter(Boolean).join(' ');
    const missingCol = extractMissingColumnFromError(errMsg);

    if (missingCol) {
      console.warn(`[Supabase Auto-Heal Client] Column '${missingCol}' missing in table '${table}'. Pruning and retrying (${attempt + 1}/${maxAttempts})...`);
      clientKnownMissingColumns[table].add(missingCol);
      delete currentPayload[missingCol];
      if (Object.keys(currentPayload).length === 0) {
        return { data: null, error: null };
      }
    } else {
      return { data, error };
    }
  }
  return await supabase.from(table).update(currentPayload).eq('id', id);
}

function transformFromSupabase(table: string, data: any): any {
  if (!data) return null;
  const result = { ...data };
  
  if (table === 'products') {
    return normalizeProduct(result);
  } else if (table === 'users') {
    if (result.followingSellers && typeof result.followingSellers === 'string') {
      try { result.followingSellers = JSON.parse(result.followingSellers); } catch (_) { result.followingSellers = []; }
    }
    if (!Array.isArray(result.followingSellers)) result.followingSellers = [];

    if (result.savedProductIds && typeof result.savedProductIds === 'string') {
      try { result.savedProductIds = JSON.parse(result.savedProductIds); } catch (_) { result.savedProductIds = []; }
    }
    if (!Array.isArray(result.savedProductIds)) result.savedProductIds = [];

    if (result.email && result.email.trim().toLowerCase() === 'asumaduvincent7@gmail.com') {
      result.isAdmin = true;
    }
  }
  return result;
}

// -------------------------------------------------------------
// Adapter References and Constraints
// -------------------------------------------------------------
function resolveFirestoreRef(ref: any): any {
  if (!ref) return null;
  if (ref.__firestoreRef) return ref.__firestoreRef;

  if (ref.type === 'doc') {
    return firestoreDoc(db, ref.path);
  }
  if (ref.type === 'collection') {
    return firestoreCollection(db, ref.path);
  }

  if (typeof ref === 'string') {
    return ref.includes('/') ? firestoreDoc(db, ref) : firestoreCollection(db, ref);
  }

  return null;
}

function resolveFirestoreQuery(queryOrRef: any): any {
  const isQuery = queryOrRef.__isAdapterQuery;
  const ref = isQuery ? queryOrRef.ref : queryOrRef;
  const baseRef = resolveFirestoreRef(ref);
  if (!baseRef) return null;

  const constraints = isQuery ? queryOrRef.constraints : [];
  const firestoreConstraints = constraints
    .filter(Boolean)
    .map((constraint: any) => {
      if (!constraint || typeof constraint !== 'object') return null;
      if (constraint.type === 'where') {
        return firestoreWhere(constraint.field, constraint.op, constraint.value);
      }
      if (constraint.type === 'orderBy') {
        return firestoreOrderBy(constraint.field, constraint.direction || 'asc');
      }
      if (constraint.type === 'limit') {
        return firestoreLimit(constraint.n);
      }
      return null;
    })
    .filter(Boolean);

  return firestoreConstraints.length > 0 ? firestoreQuery(baseRef, ...firestoreConstraints) : baseRef;
}

export function collection(arg1: any, arg2?: string): any {
  let fullPath = '';
  if (typeof arg1 === 'string') {
    fullPath = arg2 ? `${arg1}/${arg2}` : arg1;
  } else if (arg1 && arg1.__isAdapterRef) {
    fullPath = arg2 ? `${arg1.path}/${arg2}` : arg1.path;
  } else if (typeof arg2 === 'string') {
    fullPath = arg2;
  }

  const cleanPath = fullPath.replace(/^\//, '').replace(/\/$/, '').trim();

  return {
    __isAdapterRef: true,
    type: 'collection',
    path: cleanPath
  };
}

export function doc(arg1: any, arg2?: string, arg3?: string): any {
  let fullPath = '';

  if (typeof arg1 === 'string') {
    if (typeof arg2 === 'string') {
      if (typeof arg3 === 'string') {
        fullPath = `${arg1}/${arg2}/${arg3}`;
      } else {
        fullPath = `${arg1}/${arg2}`;
      }
    } else {
      fullPath = arg1.includes('/') ? arg1 : `users/${arg1}`;
    }
  } else if (arg1 && arg1.__isAdapterRef) {
    const basePath = arg1.path || '';
    if (typeof arg2 === 'string') {
      if (typeof arg3 === 'string') {
        fullPath = `${basePath}/${arg2}/${arg3}`;
      } else {
        fullPath = `${basePath}/${arg2}`;
      }
    } else {
      fullPath = basePath;
    }
  } else if (typeof arg2 === 'string') {
    if (typeof arg3 === 'string') {
      fullPath = `${arg2}/${arg3}`;
    } else {
      fullPath = arg2.includes('/') ? arg2 : `users/${arg2}`;
    }
  }

  const cleanPath = fullPath.replace(/^\//, '').replace(/\/$/, '').trim();
  const parts = cleanPath.split('/').filter(Boolean);
  const docId = parts.length > 0 ? parts[parts.length - 1] : '';

  return {
    __isAdapterRef: true,
    type: 'doc',
    path: cleanPath,
    id: docId
  };
}

export function where(field: string, op: string, value: any) {
  return { type: 'where', field, op, value };
}

export function orderBy(field: string, direction: 'asc' | 'desc' = 'asc') {
  return { type: 'orderBy', field, direction };
}

export function limit(n: number) {
  return { type: 'limit', n };
}

export function query(ref: any, ...constraints: any[]): any {
  return {
    __isAdapterQuery: true,
    ref,
    constraints
  };
}

export function increment(n: number) {
  return { __isIncrement: true, value: n };
}

// -------------------------------------------------------------
// Database Operations
// -------------------------------------------------------------
export async function getDoc(docRef: any): Promise<any> {
  if (!isSupabaseActive) {
    const ref = resolveFirestoreRef(docRef);
    if (!ref) {
      let docId = 'local';
      try {
        const info = getDocPathInfo(docRef);
        docId = info.id;
      } catch (_) {}
      return {
        id: docId,
        exists: () => false,
        data: () => null
      };
    }

    const snap = await firestoreGetDoc(ref);
    return {
      id: snap.id,
      exists: () => snap.exists(),
      data: () => snap.exists() ? snap.data() : null
    };
  }

  const { table, id, originalPath } = getDocPathInfo(docRef);

  try {
    console.log(`[Supabase Adapter] getDoc path="${originalPath}" table="${table}" id="${id}"`);
    const selectCols = getTableSelectColumns(table);
    const { data, error } = await supabase!
      .from(table)
      .select(selectCols)
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.warn(`[Supabase getDoc] Error fetching from table ${table} for id ${id}:`, error);
      throw error;
    }

    const transformedData = data ? transformFromSupabase(table, data) : null;

    return {
      id,
      exists: () => !!transformedData,
      data: () => transformedData
    };
  } catch (err: any) {
    throw err;
  }
}

function buildSupabaseQuery(table: string, constraints: any[] = []) {
  const selectCols = getTableSelectColumns(table);
  let q: any = supabase!.from(table).select(selectCols);

  for (const c of constraints) {
    if (!c) continue;
    if (c.type === 'where') {
      const { field, op, value } = c;
      if (op === '==') {
        q = q.eq(field, value);
      } else if (op === '!=') {
        q = q.neq(field, value);
      } else if (op === '>') {
        q = q.gt(field, value);
      } else if (op === '>=') {
        q = q.gte(field, value);
      } else if (op === '<') {
        q = q.lt(field, value);
      } else if (op === '<=') {
        q = q.lte(field, value);
      } else if (op === 'in') {
        q = q.in(field, Array.isArray(value) ? value : [value]);
      } else if (op === 'array-contains') {
        q = q.contains(field, JSON.stringify([value]));
      }
    } else if (c.type === 'orderBy') {
      const { field, direction } = c;
      q = q.order(field, { ascending: direction === 'asc' });
    } else if (c.type === 'limit') {
      q = q.limit(c.n);
    }
  }

  return q;
}

function getCollectionPathInfo(ref: any): { table: string; originalPath: string } {
  if (!ref || typeof ref.path !== 'string') {
    throw new Error(`Invalid collection reference: ${JSON.stringify(ref)}`);
  }
  const parts = ref.path.split('/').filter(Boolean);
  if (parts.length === 0) {
    throw new Error(`Invalid collection reference path: "${ref.path}"`);
  }
  return { table: mapPathToTable(parts[0]), originalPath: ref.path };
}

export async function getDocs(queryOrRef: any): Promise<any> {
  if (!isSupabaseActive) {
    const q = resolveFirestoreQuery(queryOrRef);
    if (!q) {
      return {
        docs: [],
        forEach: () => {},
        size: 0,
        empty: true,
        metadata: { fromCache: false, hasPendingWrites: false }
      };
    }

    const snapshot = await firestoreGetDocs(q);
    const docs = snapshot.docs.map((docSnap: any) => ({
      id: docSnap.id,
      exists: () => docSnap.exists(),
      data: () => docSnap.data()
    }));

    return {
      docs,
      forEach: (cb: any) => docs.forEach(cb),
      size: docs.length,
      empty: docs.length === 0,
      metadata: { fromCache: false, hasPendingWrites: false }
    };
  }

  const isQuery = queryOrRef.__isAdapterQuery;
  const ref = isQuery ? queryOrRef.ref : queryOrRef;
  const { table, originalPath } = getCollectionPathInfo(ref);
  const constraints = isQuery ? queryOrRef.constraints : [];

  try {
    console.log(`[Supabase Adapter] getDocs path="${originalPath}" table="${table}"`);
    const q = buildSupabaseQuery(table, constraints);
    const { data, error } = await q;

    if (error) {
      console.warn(`[Supabase getDocs] Error querying table ${table}:`, error);
      throw error;
    }

    const docs = (data || []).map((item: any) => {
      const transformed = transformFromSupabase(table, item);
      return {
        id: transformed.id,
        exists: () => true,
        data: () => transformed
      };
    });

    return {
      docs,
      forEach: (cb: any) => docs.forEach(cb),
      size: docs.length,
      empty: docs.length === 0,
      metadata: { fromCache: false, hasPendingWrites: false }
    };
  } catch (err: any) {
    throw err;
  }
}

export async function setDoc(docRef: any, data: any, options?: any): Promise<void> {
  if (!isSupabaseActive) {
    const ref = resolveFirestoreRef(docRef);
    if (!ref) {
      console.warn('[dbAdapter] Firestore ref could not be resolved for setDoc.');
      return;
    }
    await firestoreSetDoc(ref, data, options);
    return;
  }

  const { table, id, originalPath } = getDocPathInfo(docRef);

  let payload = { id, ...data };
  console.log(`[Supabase Adapter] setDoc path="${originalPath}" table="${table}" id="${id}"`);
  payload = sanitizePayload(payload);

  if (options?.merge) {
    const { data: existing } = await supabase!
      .from(table)
      .select('*')
      .eq('id', id)
      .maybeSingle();

    payload = { ...existing, ...payload };
  }

  payload = transformForSupabaseClient(table, payload, id);

  const { error } = await safeSupabaseUpsert(table, payload);

  if (error) {
    console.error(`[Supabase setDoc Error] Failed setting row in ${table} (${id}):`, error?.message || error);
    throw error;
  }
}

export async function updateDoc(docRef: any, data: any): Promise<void> {
  if (!isSupabaseActive) {
    const ref = resolveFirestoreRef(docRef);
    if (!ref) {
      console.warn('[dbAdapter] Firestore ref could not be resolved for updateDoc.');
      return;
    }

    const payload = sanitizePayload({ ...data });
    for (const [key, val] of Object.entries(payload)) {
      if (val && typeof val === 'object' && (val as any).__isIncrement) {
        const currentSnap = await firestoreGetDoc(ref);
        const currentValue = currentSnap.exists() ? (currentSnap.data() as any)?.[key] : 0;
        payload[key] = (Number(currentValue) || 0) + (val as any).value;
      }
    }

    await firestoreUpdateDoc(ref, payload);
    return;
  }

  const { table, id, originalPath } = getDocPathInfo(docRef);

  let payload = sanitizePayload({ ...data });
  console.log(`[Supabase Adapter] updateDoc path="${originalPath}" table="${table}" id="${id}"`);

  for (const [key, val] of Object.entries(payload)) {
    if (val && typeof val === 'object' && (val as any).__isIncrement) {
      const { data: current } = await supabase!
        .from(table)
        .select('*')
        .eq('id', id)
        .maybeSingle();
      const currentNum = (current && current[key]) || 0;
      payload[key] = currentNum + (val as any).value;
    }
  }

  payload = filterTableColumns(table, payload);

  if (Object.keys(payload).length === 0) {
    return;
  }

  const { error } = await safeSupabaseUpdate(table, payload, id);

  if (error) {
    console.error(`[Supabase updateDoc Error] Failed updating row in ${table} (${id}):`, error?.message || error);
    throw error;
  }
}

export async function deleteDoc(docRef: any): Promise<void> {
  if (!isSupabaseActive) {
    const ref = resolveFirestoreRef(docRef);
    if (!ref) {
      console.warn('[dbAdapter] Firestore ref could not be resolved for deleteDoc.');
      return;
    }
    await firestoreDeleteDoc(ref);
    return;
  }

  const { table, id, originalPath } = getDocPathInfo(docRef);

  const { error } = await supabase!
    .from(table)
    .delete()
    .eq('id', id);

  if (error) {
    console.error(`[Supabase deleteDoc Error] Failed deleting row from ${table} (${id}):`, error?.message || error);
    throw error;
  }
}

export function writeBatch(dbInstance?: any): any {
  if (!isSupabaseActive) {
    const batch = firestoreWriteBatch(db);
    const operations: Array<() => Promise<void>> = [];

    return {
      set: (docRef: any, data: any, options?: any) => {
        const ref = resolveFirestoreRef(docRef);
        if (ref) {
          batch.set(ref, data, options);
        }
      },
      update: (docRef: any, data: any) => {
        const ref = resolveFirestoreRef(docRef);
        if (ref) {
          batch.update(ref, data);
        }
      },
      delete: (docRef: any) => {
        const ref = resolveFirestoreRef(docRef);
        if (ref) {
          batch.delete(ref);
        }
      },
      commit: async () => {
        await batch.commit();
      }
    };
  }

  const operations: Array<() => Promise<void>> = [];

  return {
    set: (docRef: any, data: any, options?: any) => {
      operations.push(async () => {
        await setDoc(docRef, data, options);
      });
    },
    update: (docRef: any, data: any) => {
      operations.push(async () => {
        await updateDoc(docRef, data);
      });
    },
    delete: (docRef: any) => {
      operations.push(async () => {
        await deleteDoc(docRef);
      });
    },
    commit: async () => {
      if (!isSupabaseActive) {
        console.warn('[dbAdapter] Supabase inactive. writeBatch commit bypassed.');
        return;
      }
      for (const op of operations) {
        await op();
      }
    }
  };
}

export function onSnapshot(
  queryOrDocRef: any,
  onNext: (snapshot: any) => void,
  onError?: (error: any) => void
): () => void {
  if (!isSupabaseActive) {
    const isDoc = queryOrDocRef?.type === 'doc' || (queryOrDocRef?.path && queryOrDocRef.path.split('/').filter(Boolean).length > 1);
    if (isDoc) {
      const ref = resolveFirestoreRef(queryOrDocRef);
      if (!ref) {
        let docId = 'local';
        try {
          const info = getDocPathInfo(queryOrDocRef);
          docId = info.id;
        } catch (_) {}
        onNext({
          id: docId,
          exists: () => false,
          data: () => null
        });
        return () => {};
      }

      return firestoreOnSnapshot(ref, (snap: any) => {
        onNext({
          id: snap.id,
          exists: () => snap.exists(),
          data: () => snap.exists() ? snap.data() : null
        });
      }, onError);
    }

    const q = resolveFirestoreQuery(queryOrDocRef);
    if (!q) {
      onNext({
        docs: [],
        forEach: () => {},
        size: 0,
        empty: true,
        metadata: { fromCache: false, hasPendingWrites: false },
        docChanges: () => []
      });
      return () => {};
    }

    return firestoreOnSnapshot(q, (snap: any) => {
      const docs = snap.docs.map((docSnap: any) => ({
        id: docSnap.id,
        exists: () => docSnap.exists(),
        data: () => docSnap.data()
      }));
      onNext({
        docs,
        forEach: (cb: any) => docs.forEach(cb),
        size: docs.length,
        empty: docs.length === 0,
        metadata: { fromCache: snap.metadata?.fromCache || false, hasPendingWrites: snap.metadata?.hasPendingWrites || false },
        docChanges: () => snap.docChanges()
      });
    }, onError);
  }

  const isDoc = queryOrDocRef.type === 'doc' || (queryOrDocRef.path && queryOrDocRef.path.split('/').filter(Boolean).length > 1);

  if (isDoc) {
    const { table, id } = getDocPathInfo(queryOrDocRef);

    let active = true;

    const selectCols = getTableSelectColumns(table);
    supabase!
      .from(table)
      .select(selectCols)
      .eq('id', id)
      .maybeSingle()
      .then(({ data, error }) => {
         if (!active) return;
         if (error) {
           if (onError) onError(error);
           return;
         }
         const transformed = data ? transformFromSupabase(table, data) : null;
         onNext({
           id,
           exists: () => !!transformed,
           data: () => transformed
         });
      });

    const channel = supabase!
      .channel(`doc_sync:${table}:${id}:${Math.random().toString(36).substring(2, 15)}_${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `id=eq.${id}` },
        (payload) => {
          if (!active) return;
          const nextData = payload.eventType === 'DELETE' ? null : payload.new;
          const transformed = nextData ? transformFromSupabase(table, nextData) : null;
          onNext({
            id,
            exists: () => !!transformed,
            data: () => transformed
          });
        }
      )
      .subscribe();

    return () => {
      active = false;
      supabase!.removeChannel(channel);
    };
  } else {
    const isQuery = queryOrDocRef.__isAdapterQuery;
    const ref = isQuery ? queryOrDocRef.ref : queryOrDocRef;
    const { table } = getCollectionPathInfo(ref);
    const constraints = isQuery ? queryOrDocRef.constraints : [];

    let active = true;

    const runQueryAndNotify = async () => {
      try {
        const q = buildSupabaseQuery(table, constraints);
        const { data, error } = await q;
        if (!active) return;
        if (error) {
          if (onError) onError(error);
          return;
        }

        const docs = (data || []).map((item: any) => {
          const transformed = transformFromSupabase(table, item);
          return {
            id: transformed.id,
            exists: () => true,
            data: () => transformed
          };
        });

        onNext({
          docs,
          forEach: (cb: any) => docs.forEach(cb),
          size: docs.length,
          empty: docs.length === 0,
          metadata: { fromCache: false, hasPendingWrites: false },
          docChanges: () => []
        });
      } catch (err) {
        if (onError) onError(err);
      }
    };

    runQueryAndNotify();

    const channel = supabase!
      .channel(`table_sync:${table}:${Math.random().toString(36).substring(2, 15)}_${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        () => {
          if (!active) return;
          runQueryAndNotify();
        }
      )
      .subscribe();

    return () => {
      active = false;
      supabase!.removeChannel(channel);
    };
  }
}
