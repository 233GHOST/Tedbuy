const AUTH_ERROR_MESSAGES: Record<string, string> = {
  "auth/network-request-failed": "No internet connection. Please check your connection and try again.",
  "auth/invalid-email": "Please enter a valid email address.",
  "auth/user-not-found": "We couldn't find an account with that email address. Please sign up or check the spelling.",
  "auth/wrong-password": "Incorrect email or password.",
  "auth/invalid-credential": "The email or password you entered is incorrect. Please try again.",
  "auth/email-already-in-use": "This email is already registered. Please try signing in instead.",
  "auth/too-many-requests": "Too many attempts. For security, please wait a moment before trying again.",
  "auth/user-disabled": "This account has been suspended. Please contact our support team for help.",
  "auth/operation-not-allowed": "This sign-in option is temporarily offline. Please try signing in with Google.",
  "auth/popup-blocked": "The sign-in window was blocked. Please enable pop-ups for this site or open the app in a new tab.",
  "auth/popup-closed-by-user": "Sign-in was closed. Please try again.",
  "auth/cancelled-popup-request": "The sign-in process was cancelled. Please try again."
};

export function toUserFriendlyError(error: any): string {
  if (!error) return "Something didn't go quite right on our end. Please try again.";

  let msg = "";
  if (typeof error === 'string') {
    msg = error;
  } else {
    msg = error?.message || error?.error || String(error);
  }

  const clean = msg.toLowerCase();

  if (clean.includes('suspended') || clean.includes('suspension')) {
    return msg;
  }

  // 1. Connection / Network errors
  if (clean.includes('network') || clean.includes('fetch') || clean.includes('load failed') || clean.includes('connect')) {
    return "Unable to connect. Please check your internet connection and try again.";
  }

  // 2. Permissions / Access errors
  if (clean.includes('permission') || clean.includes('insufficient') || clean.includes('denied') || clean.includes('unauthorized') || clean.includes('forbidden')) {
    return "This action is temporarily unavailable. Please make sure you are signed in or refresh the page.";
  }

  // 3. Quota / Rate Limit / Busy
  if (clean.includes('quota') || clean.includes('exhausted') || clean.includes('limit') || clean.includes('too many requests') || clean.includes('busy')) {
    return "Our system is experiencing high traffic right now. Please wait a moment and try again.";
  }

  // 4. Index / Missing setup / database internal / SQL
  if (clean.includes('index') || clean.includes('composite') || clean.includes('syntax') || clean.includes('query') || clean.includes('sql') || clean.includes('database')) {
    return "This section is undergoing a quick update. Please refresh the page in a moment.";
  }

  // 5. Firebase / SDK internal strings
  if (clean.includes('firebase') || clean.includes('firestore') || clean.includes('sdk') || clean.includes('grpc') || clean.includes('api')) {
    return "We encountered a temporary connection issue. Please refresh the page.";
  }

  // 6. Payment Portal / Paystack
  if (clean.includes('paystack') || clean.includes('public key')) {
    return "The payment gateway is taking a moment to load. Please try again in a few seconds.";
  }

  // 7. Generic Auth-like codes if they sneak in raw
  if (clean.includes('auth/') || clean.includes('credential') || clean.includes('password')) {
    if (clean.includes('invalid') || clean.includes('wrong')) {
      return "The details you entered are incorrect. Please check and try again.";
    }
    if (clean.includes('already') || clean.includes('in-use')) {
      return "This email is already registered. Please try signing in instead.";
    }
  }

  // 8. Card verification
  if (clean.includes('16-digit') || clean.includes('card number')) {
    return "Please enter a valid card number and try again.";
  }

  // 9. Default fallback if it looks developer-focused / technical
  const isTechnical = 
    clean.includes('exception') || 
    clean.includes('undefined') || 
    clean.includes('null') || 
    clean.includes('[object') ||
    clean.includes('invalid_argument') ||
    clean.includes('failed_precondition') ||
    clean.includes('index') ||
    clean.includes('composite') ||
    clean.includes('syntax') ||
    clean.includes('query') ||
    clean.includes('sql') ||
    clean.includes('database') ||
    clean.includes('grpc') ||
    clean.includes('api') ||
    clean.includes('code=') ||
    clean.includes('typeerror') ||
    clean.includes('firebaseerror') ||
    clean.includes('referenceerror') ||
    (clean.includes('error') && (clean.includes(':') || clean.includes('(') || clean.includes('code') || !clean.includes(' '))) ||
    (clean.includes('fail') && (clean.includes(':') || clean.includes('(') || clean.includes('code') || !clean.includes(' ')));

  if (isTechnical) {
    return "Something didn't go quite right on our end. Please try again in a moment.";
  }

  return msg;
}

export function getAuthErrorMessage(error: any): string {
  if (!error) return "Something went wrong. Please try again.";

  // Extract error code and message
  const code = error?.code || "";
  const message = error?.message || error?.error || (typeof error === 'string' ? error : "");

  if (message.toLowerCase().includes('suspended') || message.toLowerCase().includes('suspension')) {
    return message;
  }

  // Log only in development context
  if (process.env.NODE_ENV === "development") {
    console.error("[Auth Error Helper Logger]:", error);
  }

  if (code && AUTH_ERROR_MESSAGES[code]) {
    return AUTH_ERROR_MESSAGES[code];
  }

  // Fallback checks on code/message substring patterns for resilience
  if (code.includes("network-request-failed") || message.includes("network-request-failed")) {
    return AUTH_ERROR_MESSAGES["auth/network-request-failed"];
  }
  if (code.includes("invalid-email") || message.includes("invalid-email")) {
    return AUTH_ERROR_MESSAGES["auth/invalid-email"];
  }
  if (code.includes("user-not-found") || message.includes("user-not-found")) {
    return AUTH_ERROR_MESSAGES["auth/user-not-found"];
  }
  if (code.includes("wrong-password") || message.includes("wrong-password")) {
    return AUTH_ERROR_MESSAGES["auth/wrong-password"];
  }
  if (code.includes("invalid-credential") || message.includes("invalid-credential")) {
    return AUTH_ERROR_MESSAGES["auth/invalid-credential"];
  }
  if (code.includes("email-already-in-use") || message.includes("email-already-in-use")) {
    return AUTH_ERROR_MESSAGES["auth/email-already-in-use"];
  }
  if (code.includes("too-many-requests") || message.includes("too-many-requests")) {
    return AUTH_ERROR_MESSAGES["auth/too-many-requests"];
  }
  if (code.includes("user-disabled") || message.includes("user-disabled")) {
    return AUTH_ERROR_MESSAGES["auth/user-disabled"];
  }
  if (code.includes("operation-not-allowed") || message.includes("operation-not-allowed")) {
    return AUTH_ERROR_MESSAGES["auth/operation-not-allowed"];
  }
  if (code.includes("popup-blocked") || message.includes("popup-blocked")) {
    return AUTH_ERROR_MESSAGES["auth/popup-blocked"];
  }
  if (code.includes("popup-closed-by-user") || message.includes("popup-closed-by-user")) {
    return AUTH_ERROR_MESSAGES["auth/popup-closed-by-user"];
  }

  // Use general user-friendly error converter for fallback
  return toUserFriendlyError(error);
}
