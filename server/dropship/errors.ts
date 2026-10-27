// Error codes and HTTP statuses from API_SPEC §0 (N-07).
export const ERROR_STATUS = {
  UNAUTHENTICATED: 401,
  ACCOUNT_RESTRICTED: 403,
  NOT_APPROVED: 403,
  FULFILMENT_ONLY: 403,
  IMPERSONATION_FORBIDDEN: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  STATE_CONFLICT: 409,
  RATE_LIMIT: 429,
  SERVER: 500,
  DROPSHIP_UNAVAILABLE: 503,
} as const;

export type DropshipErrorCode = keyof typeof ERROR_STATUS;

export class DropshipError extends Error {
  constructor(public code: DropshipErrorCode, message: string, public retryable = false) {
    super(message);
    this.name = 'DropshipError';
  }
  get status(): number {
    return ERROR_STATUS[this.code];
  }
}

// Shape shared by supabase-js (PostgrestError) and PGlite errors.
export interface DbErrorLike {
  code?: string;
  message?: string;
  details?: string;
  detail?: string;
}

// Maps a database error to an API error. Business errors are raised by dropship_fail()
// as 'DS_<CODE>' with a human-readable detail; constraint violations are input errors.
export function mapDbError(err: DbErrorLike): DropshipError {
  const message = err.message || '';
  const detail = err.details || err.detail || '';
  const ds = /^DS_([A-Z_]+)$/.exec(message);
  if (ds && ds[1] in ERROR_STATUS) {
    return new DropshipError(ds[1] as DropshipErrorCode, detail || ds[1]);
  }
  switch (err.code) {
    case '23514': // check_violation
    case '23502': // not_null_violation
    case '22P02': // invalid_text_representation (bad number)
    case '22003': // numeric_value_out_of_range
    case '22001': // string_data_right_truncation
      return new DropshipError('VALIDATION', 'One or more fields are invalid.');
    case '23503': // foreign_key_violation (unknown user)
      return new DropshipError('NOT_FOUND', 'User not found.');
    case '23505': // unique_violation
      return new DropshipError('STATE_CONFLICT', 'This record already exists.');
    case '40P01': // deadlock_detected
    case '55P03': // lock_not_available (lock_timeout)
      return new DropshipError('SERVER', 'The request could not be completed; please retry.', true);
    case '42883': // undefined_function
    case 'PGRST202': // PostgREST: function not in schema cache
    case '42P01': // undefined_table
      return new DropshipError('DROPSHIP_UNAVAILABLE', 'Dropship is not available right now.');
    default:
      return new DropshipError('SERVER', 'Unexpected server error.');
  }
}
