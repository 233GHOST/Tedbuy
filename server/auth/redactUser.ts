// A raw `users` row (select('*')) carries the legacy password/password_hash columns and the
// device push token alongside everything else. Every place that hands such a row to a client,
// admin or not, strips these first: a push token lets anyone send notifications to that phone.
export function redactUserSecrets<T extends Record<string, any> | null | undefined>(user: T): T {
  if (!user || typeof user !== 'object') return user;
  const { password, password_hash, pushToken, pushTokenPlatform, pushTokenUpdatedAt, ...safe } = user;
  return safe as T;
}
