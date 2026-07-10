import { createClient } from '@supabase/supabase-js';
import * as firestore from 'firebase/firestore';
import { db as firebaseDb } from './firebase';

// -------------------------------------------------------------
// Initialize Supabase Client if credentials are provided
// -------------------------------------------------------------
const supabaseUrl = (import.meta as any).env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = (import.meta as any).env.VITE_SUPABASE_ANON_KEY || '';

const isValidUrl = (url: string) => {
  return typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'));
};

export const isSupabaseActive = !!(supabaseUrl && supabaseAnonKey && isValidUrl(supabaseUrl));

export const supabase = isSupabaseActive
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

if (isSupabaseActive) {
  console.log('[Supabase Adapter] Active! Routing all client database calls to Supabase (PostgreSQL).');
} else {
  console.log('[Supabase Adapter] Inactive. Falling back to Google Firestore client SDK.');
}

// Map Firestore collection paths to Supabase table names
function mapPathToTable(path: string): string {
  const clean = path.replace(/^\//, '').replace(/\/$/, '');
  if (clean === 'storeNames') return 'store_names';
  if (clean === 'boostPurchases' || clean === 'boost_purchases') return 'boost_purchases';
  return clean;
}

// Convert camelCase object properties to snake_case or retain them
// Note: our Supabase schema uses quoted columns to preserve camelCase for standard properties
// like "phoneNumber", "whatsAppNumber", "sellerId", etc. so we can keep keys exactly as they are!
function sanitizePayload(data: any): any {
  if (!data || typeof data !== 'object') return data;
  
  // Recursively clean undefined values to null for PostgreSQL compatibility
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

// Allowed columns in our PostgreSQL schema to prevent "column does not exist" errors
const TABLE_COLUMNS: Record<string, Set<string>> = {
  users: new Set([
    'id', 'username', 'email', 'phoneNumber', 'whatsAppNumber', 'role', 
    'joinDate', 'photoUrl', 'followingSellers', 'savedProductIds', 
    'emailVerified', 'isGoogleAuth', 'authProvider', 'isAdmin', 'welcomeSent', 'createdAt'
  ]),
  products: new Set([
    'id', 'title', 'description', 'price', 'category', 'location', 
    'images', 'videos', 'brand', 'condition', 'negotiable', 'sellerId', 
    'sellerName', 'createdAt', 'viewsCount', 'likesCount', 'likedUserIds', 
    'boostStatus', 'boostPlan', 'boostStartDate', 'boostEndDate', 
    'boostPriority', 'priorityScore', 'boostPriorityLevel', 'boostPackagePrice', 
    'remainingBoostTime', 'boostAmount', 'lastBoostedAt', 'lastBoostPurchase', 
    'paymentStatus', 'paymentReference', 'boostHistory', 'visitCount', 'isApproved'
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
    'id', 'userId', 'title', 'message', 'type', 'read', 'createdAt', 'relatedId'
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
  
  // Clean undefined values to null recursively or set defaults
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
    if (result.followingSellers && typeof result.followingSellers === 'string') {
      try { result.followingSellers = JSON.parse(result.followingSellers); } catch (_) { result.followingSellers = []; }
    }
    if (!Array.isArray(result.followingSellers)) result.followingSellers = [];
    if (result.savedProductIds && typeof result.savedProductIds === 'string') {
      try { result.savedProductIds = JSON.parse(result.savedProductIds); } catch (_) { result.savedProductIds = []; }
    }
    if (!Array.isArray(result.savedProductIds)) result.savedProductIds = [];
  } else if (table === 'products') {
    result.negotiable = result.negotiable === true;
    result.boostStatus = result.boostStatus === true;
    result.isApproved = result.isApproved !== false; // default true
    result.viewsCount = Number(result.viewsCount) || 0;
    result.likesCount = Number(result.likesCount) || 0;
    result.boostPriority = Number(result.boostPriority) || 0;
    result.priorityScore = Number(result.priorityScore) || 0;
    result.boostPriorityLevel = Number(result.boostPriorityLevel) || 0;
    result.boostPackagePrice = Number(result.boostPackagePrice) || 0;
    result.remainingBoostTime = Number(result.remainingBoostTime) || 0;
    result.boostAmount = Number(result.boostAmount) || 0;
    result.visitCount = Number(result.visitCount) || 0;
    
    if (result.images && typeof result.images === 'string') {
      try { result.images = JSON.parse(result.images); } catch (_) { result.images = []; }
    }
    if (!Array.isArray(result.images)) result.images = [];
    if (result.videos && typeof result.videos === 'string') {
      try { result.videos = JSON.parse(result.videos); } catch (_) { result.videos = []; }
    }
    if (!Array.isArray(result.videos)) result.videos = [];
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

// -------------------------------------------------------------
// Mock Firebase References and Constraints for Adapter
// -------------------------------------------------------------
export interface AdapterRef {
  __isAdapterRef: true;
  type: 'collection' | 'doc';
  path: string;
  id?: string;
}

export interface AdapterQuery {
  __isAdapterQuery: true;
  ref: AdapterRef;
  constraints: any[];
}

export function collection(dbInstance: any, path: string): any {
  if (!isSupabaseActive) {
    return firestore.collection(firebaseDb, path);
  }
  return {
    __isAdapterRef: true,
    type: 'collection',
    path
  };
}

export function doc(dbInstanceOrRef: any, pathOrId?: string, id?: string): any {
  if (!isSupabaseActive) {
    // If it's called with doc(db, 'collection', 'id') or doc(collectionRef, 'id')
    if (dbInstanceOrRef && dbInstanceOrRef.__isAdapterRef === undefined) {
      return firestore.doc(firebaseDb, pathOrId as string, id as string);
    } else {
      return firestore.doc(dbInstanceOrRef, pathOrId as string);
    }
  }

  let fullPath = '';
  let docId = '';

  if (dbInstanceOrRef && dbInstanceOrRef.__isAdapterRef) {
    // Called with doc(collectionRef, id)
    fullPath = `${dbInstanceOrRef.path}/${pathOrId}`;
    docId = pathOrId || '';
  } else {
    // Called with doc(db, path, id)
    fullPath = `${pathOrId}/${id}`;
    docId = id || '';
  }

  return {
    __isAdapterRef: true,
    type: 'doc',
    path: fullPath,
    id: docId
  };
}

// Query constraints
export function where(field: string, op: string, value: any) {
  if (!isSupabaseActive) return firestore.where(field, op as any, value);
  return { type: 'where', field, op, value };
}

export function orderBy(field: string, direction: 'asc' | 'desc' = 'asc') {
  if (!isSupabaseActive) return firestore.orderBy(field, direction);
  return { type: 'orderBy', field, direction };
}

export function limit(n: number) {
  if (!isSupabaseActive) return firestore.limit(n);
  return { type: 'limit', n };
}

export function query(ref: any, ...constraints: any[]): any {
  if (!isSupabaseActive) return firestore.query(ref, ...constraints);
  return {
    __isAdapterQuery: true,
    ref,
    constraints
  };
}

export function increment(n: number) {
  if (!isSupabaseActive) return firestore.increment(n);
  return { __isIncrement: true, value: n };
}

// -------------------------------------------------------------
// Database Operations (getDoc, getDocs, setDoc, updateDoc, deleteDoc)
// -------------------------------------------------------------
export async function getDoc(docRef: any): Promise<any> {
  if (!isSupabaseActive) {
    return firestore.getDoc(docRef);
  }

  const parts = docRef.path.split('/');
  const table = mapPathToTable(parts[0]);
  const id = docRef.id || parts[1];

  try {
    const { data, error } = await supabase!
      .from(table)
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;

    return {
      id,
      exists: () => !!data,
      data: () => data || null
    };
  } catch (err: any) {
    console.warn(`[Supabase getDoc Fallback] Error fetching from table ${table} for id ${id}, falling back to Firestore:`, err?.message || err);
    return firestore.getDoc(docRef);
  }
}

// Helper to build a Supabase query from Adapter query or collection ref
function buildSupabaseQuery(table: string, constraints: any[] = []) {
  let q: any = supabase!.from(table).select('*');

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
        // Handle jsonb containment query
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

export async function getDocs(queryOrRef: any): Promise<any> {
  if (!isSupabaseActive) {
    return firestore.getDocs(queryOrRef);
  }

  const isQuery = queryOrRef.__isAdapterQuery;
  const ref = isQuery ? queryOrRef.ref : queryOrRef;
  const table = mapPathToTable(ref.path);
  const constraints = isQuery ? queryOrRef.constraints : [];

  try {
    const q = buildSupabaseQuery(table, constraints);
    const { data, error } = await q;

    if (error) throw error;

    const docs = (data || []).map((item: any) => ({
      id: item.id,
      exists: () => true,
      data: () => item
    }));

    return {
      docs,
      forEach: (cb: any) => docs.forEach(cb),
      size: docs.length,
      empty: docs.length === 0,
      metadata: { fromCache: false, hasPendingWrites: false }
    };
  } catch (err: any) {
    console.warn(`[Supabase getDocs Fallback] Error listing from table ${table}, falling back to Firestore:`, err?.message || err);
    return firestore.getDocs(queryOrRef);
  }
}

export async function setDoc(docRef: any, data: any, options?: any): Promise<void> {
  if (!isSupabaseActive) {
    try {
      await firestore.setDoc(docRef, data, options);
    } catch (fsErr: any) {
      console.warn(`[Supabase setDoc Backup] Backup write to Firestore failed:`, fsErr?.message || fsErr);
    }
    return;
  }

  const parts = docRef.path.split('/');
  const table = mapPathToTable(parts[0]);
  const id = docRef.id || parts[1];

  try {
    let payload = { id, ...data };
    
    // Process increments and nested values
    payload = sanitizePayload(payload);

    if (options?.merge) {
      // Fetch existing row first to merge properly
      const { data: existing } = await supabase!
        .from(table)
        .select('*')
        .eq('id', id)
        .maybeSingle();

      payload = { ...existing, ...payload };
    }

    payload = transformForSupabaseClient(table, payload, id);

    const { error } = await supabase!
      .from(table)
      .upsert(payload);

    if (error) throw error;
  } catch (err: any) {
    console.error(`[Supabase setDoc] Error setting row in table ${table} for id ${id}:`, err?.message || err);
    console.error(`[Supabase setDoc Action Required] Row-Level Security (RLS) is likely enabled on table "${table}" or tables/policies are missing in your Supabase instance.
To resolve this immediately:
1. Go to your Supabase Dashboard -> SQL Editor.
2. Run this command:
   ALTER TABLE public.${table} DISABLE ROW LEVEL SECURITY;
3. Or re-run the full script in 'supabase_schema.sql' to reset and disable RLS.`);
  }
}

export async function updateDoc(docRef: any, data: any): Promise<void> {
  if (!isSupabaseActive) {
    try {
      await firestore.updateDoc(docRef, data);
    } catch (fsErr: any) {
      console.warn(`[Supabase updateDoc Backup] Backup update to Firestore failed:`, fsErr?.message || fsErr);
    }
    return;
  }

  const parts = docRef.path.split('/');
  const table = mapPathToTable(parts[0]);
  const id = docRef.id || parts[1];

  try {
    let payload = sanitizePayload({ ...data });

    // Handle increments inline
    for (const [key, val] of Object.entries(payload)) {
      if (val && typeof val === 'object' && (val as any).__isIncrement) {
        const { data: current } = await supabase!
          .from(table)
          .select(key)
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

    const { error } = await supabase!
      .from(table)
      .update(payload)
      .eq('id', id);

    if (error) throw error;
  } catch (err: any) {
    console.error(`[Supabase updateDoc] Error updating row in table ${table} for id ${id}:`, err?.message || err);
    console.error(`[Supabase updateDoc Action Required] Row-Level Security (RLS) is likely enabled on table "${table}" or tables/policies are missing in your Supabase instance.
To resolve this immediately:
1. Go to your Supabase Dashboard -> SQL Editor.
2. Run this command:
   ALTER TABLE public.${table} DISABLE ROW LEVEL SECURITY;
3. Or re-run the full script in 'supabase_schema.sql' to reset and disable RLS.`);
  }
}

export async function deleteDoc(docRef: any): Promise<void> {
  if (!isSupabaseActive) {
    try {
      await firestore.deleteDoc(docRef);
    } catch (fsErr: any) {
      console.warn(`[Supabase deleteDoc Backup] Backup deletion in Firestore failed:`, fsErr?.message || fsErr);
    }
    return;
  }

  const parts = docRef.path.split('/');
  const table = mapPathToTable(parts[0]);
  const id = docRef.id || parts[1];

  try {
    const { error } = await supabase!
      .from(table)
      .delete()
      .eq('id', id);

    if (error) throw error;
  } catch (err: any) {
    console.error(`[Supabase deleteDoc] Error deleting row from table ${table} for id ${id}:`, err?.message || err);
    console.error(`[Supabase deleteDoc Action Required] Row-Level Security (RLS) is likely enabled on table "${table}" or tables/policies are missing in your Supabase instance.
To resolve this immediately:
1. Go to your Supabase Dashboard -> SQL Editor.
2. Run this command:
   ALTER TABLE public.${table} DISABLE ROW LEVEL SECURITY;
3. Or re-run the full script in 'supabase_schema.sql' to reset and disable RLS.`);
  }
}

// -------------------------------------------------------------
// Atomic Transactions & Batched Writes
// -------------------------------------------------------------
export function writeBatch(dbInstance?: any): any {
  if (!isSupabaseActive) {
    return firestore.writeBatch(firebaseDb);
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
      // Execute all write operations sequentially
      for (const op of operations) {
        await op();
      }
    }
  };
}

// -------------------------------------------------------------
// Real-time Event Subscriptions (onSnapshot)
// -------------------------------------------------------------
export function onSnapshot(
  queryOrDocRef: any,
  onNext: (snapshot: any) => void,
  onError?: (error: any) => void
): () => void {
  if (!isSupabaseActive) {
    return firestore.onSnapshot(queryOrDocRef, onNext, onError);
  }

  const isDoc = queryOrDocRef.type === 'doc' || (queryOrDocRef.path && queryOrDocRef.path.split('/').length > 1);

  if (isDoc) {
    const parts = queryOrDocRef.path.split('/');
    const table = mapPathToTable(parts[0]);
    const id = queryOrDocRef.id || parts[1];

    let active = true;

    // 1. Initial document fetch
    supabase!
      .from(table)
      .select('*')
      .eq('id', id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          if (onError) onError(error);
          return;
        }
        onNext({
          id,
          exists: () => !!data,
          data: () => data || null
        });
      });

    // 2. Postgres real-time updates subscription with fully unique channel name to prevent collisions
    const channel = supabase!
      .channel(`doc_sync:${table}:${id}:${Math.random().toString(36).substring(2, 15)}_${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `id=eq.${id}` },
        (payload) => {
          if (!active) return;
          const nextData = payload.eventType === 'DELETE' ? null : payload.new;
          onNext({
            id,
            exists: () => !!nextData,
            data: () => nextData
          });
        }
      )
      .subscribe();

    return () => {
      active = false;
      supabase!.removeChannel(channel);
    };
  } else {
    // List or collection query subscription
    const isQuery = queryOrDocRef.__isAdapterQuery;
    const ref = isQuery ? queryOrDocRef.ref : queryOrDocRef;
    const table = mapPathToTable(ref.path);
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

        const docs = (data || []).map((item: any) => ({
          id: item.id,
          exists: () => true,
          data: () => item
        }));

        onNext({
          docs,
          forEach: (cb: any) => docs.forEach(cb),
          size: docs.length,
          empty: docs.length === 0,
          metadata: { fromCache: false, hasPendingWrites: false },
          docChanges: () => [] // Standard empty array to support any client-side iteration
        });
      } catch (err) {
        if (onError) onError(err);
      }
    };

    // 1. Initial fetch
    runQueryAndNotify();

    // 2. Realtime pg postgres_changes subscription with fully unique channel name to prevent collisions
    const channel = supabase!
      .channel(`table_sync:${table}:${Math.random().toString(36).substring(2, 15)}_${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        () => {
          if (!active) return;
          // Re-query and notify when any insert, update or delete happens
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
