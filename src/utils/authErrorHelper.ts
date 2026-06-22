const AUTH_ERROR_MESSAGES: Record<string, string> = {
  "auth/network-request-failed": "No internet connection. Please check your network and try again.",
  "auth/invalid-email": "Please enter a valid email address.",
  "auth/user-not-found": "No account was found with that email address.",
  "auth/wrong-password": "Incorrect email or password.",
  "auth/invalid-credential": "Incorrect email, phone or password. Please try again.",
  "auth/email-already-in-use": "An account already exists with this email.",
  "auth/too-many-requests": "Too many attempts. Please try again later.",
  "auth/user-disabled": "This account has been disabled. Contact support for assistance.",
  "auth/operation-not-allowed": "Email/Password sign-in is not enabled in the backend setup.",
  "auth/popup-blocked": "Google sign-in popup was blocked by your browser. Please allow popups for this site or open in a new tab.",
  "auth/popup-closed-by-user": "Google sign-in was closed before completion. Please try again.",
  "auth/cancelled-popup-request": "The sign-in popup was cancelled. Please try again."
};

export function getAuthErrorMessage(error: any): string {
  if (!error) return "Something went wrong. Please try again.";

  // Extract error code and message
  const code = error?.code || "";
  const message = error?.message || "";

  // Log only in development context
  if (process.env.NODE_ENV === "development") {
    console.error("[Auth Error Helper Logger]:", error);
  }

  if (code && AUTH_ERROR_MESSAGES[code]) {
    return AUTH_ERROR_MESSAGES[code];
  }

  // Fallback checks on code/message substring patterns for resilience
  if (code.includes("network-request-failed") || message.includes("network-request-failed")) {
    return "No internet connection. Please check your network and try again.";
  }
  if (code.includes("invalid-email") || message.includes("invalid-email")) {
    return "Please enter a valid email address.";
  }
  if (code.includes("user-not-found") || message.includes("user-not-found")) {
    return "No account was found with that email address.";
  }
  if (code.includes("wrong-password") || message.includes("wrong-password")) {
    return "Incorrect email or password.";
  }
  if (code.includes("invalid-credential") || message.includes("invalid-credential")) {
    return "Incorrect email, phone or password. Please try again.";
  }
  if (code.includes("email-already-in-use") || message.includes("email-already-in-use")) {
    return "An account already exists with this email.";
  }
  if (code.includes("too-many-requests") || message.includes("too-many-requests")) {
    return "Too many attempts. Please try again later.";
  }
  if (code.includes("user-disabled") || message.includes("user-disabled")) {
    return "This account has been disabled. Contact support for assistance.";
  }
  if (code.includes("operation-not-allowed") || message.includes("operation-not-allowed")) {
    return "Email/Password sign-in is not enabled in the backend setup.";
  }
  if (code.includes("popup-blocked") || message.includes("popup-blocked")) {
    return "Google sign-in popup was blocked by your browser. Please allow popups for this site or open in a new tab.";
  }
  if (code.includes("popup-closed-by-user") || message.includes("popup-closed-by-user")) {
    return "Google sign-in was closed before completion. Please try again.";
  }

  // Return non-raw generic message if raw Firebase error is exposed
  if (message.includes("Firebase: Error")) {
    return "Something went wrong. Please try again.";
  }

  return message || "Something went wrong. Please try again.";
}
