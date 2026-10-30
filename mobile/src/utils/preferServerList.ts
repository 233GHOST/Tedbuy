/** Server list if it answered (even an empty one: the server said "none"), else the on-phone computation. */
export function preferServerList<T>(server: T[] | null | undefined, local: T[]): T[] {
  return Array.isArray(server) ? server : local;
}

/** Drops server-list items the phone already knows are sold or hidden (the server list only catches up on the next refresh). Null passes through. */
export function dropUnavailable<T extends { id?: string }>(
  server: T[] | null | undefined,
  localProducts: Array<{ id?: string; isSold?: boolean; status?: string }>
): T[] | null {
  if (!Array.isArray(server)) return null;
  const gone = new Set(
    localProducts.filter((p) => p && (p.isSold || p.status === 'hidden' || p.status === 'sold')).map((p) => p.id)
  );
  return gone.size === 0 ? server : server.filter((p) => !gone.has(p.id));
}
