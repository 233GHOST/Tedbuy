/** Server list if it answered (even an empty one: the server said "none"), else the on-phone computation. */
export function preferServerList<T>(server: T[] | null | undefined, local: T[]): T[] {
  return Array.isArray(server) ? server : local;
}
