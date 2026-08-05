# Security Specification for Tedbuy Firestore

## 1. Data Invariants

*   **Users (`/users/{userId}`)**: 
    1. A user can only write or modify their own user document (`userId == request.auth.uid`).
    2. Identity Spoofing is blocked: `incoming().id == request.auth.uid`.
    3. User email or username must not exceed boundary length thresholds (e.g., username length <= 100, email length <= 150) to prevent overflow attacks.

*   **Products (`/products/{productId}`)**:
    1. A product listing can only be created by an authenticated user (`request.auth.uid != null`).
    2. The `sellerId` field must match the creator's auth UID.
    3. A product can only be edited or deleted by its respective owner (`existing().sellerId == request.auth.uid`).
    4. Price, title, and location are required and must conform to schema types (e.g. price > 0, title is string and length <= 128).

*   **Chats (`/chats/{chatId}`)**:
    1. A chat can only be read or listed by its direct participants (`request.auth.uid == resource.data.buyerId || request.auth.uid == resource.data.sellerId`).
    2. Creation requires the `buyerId` to match the active buyer's auth UID.
    3. State transition from completed/terminal trading status is locked.

*   **Messages (`/messages/{messageId}`)**:
    1. A message must have a valid `chatId`.
    2. The sender of the message must match the authenticated user UID (`senderId == request.auth.uid`).
    3. The message recipient must exist in the parent chat record.

*   **Reviews (`/reviews/{reviewId}`)**:
    1. Only the buyer can write reviews for completed transactions (`buyerId == request.auth.uid`).
    2. The reviewer cannot rate themselves (e.g. `buyerId != sellerId`).
    3. Rating must be an integer between 1 and 5.

---

## 2. The "Dirty Dozen" Malicious Payloads

The following payloads represent malicious attempts to compromise the system and must be rejected with `PERMISSION_DENIED`.

### Scenario 1-3: User Profile Spoofing
1.  **Direct Profile Takeover**: User A tries to edit User B's username in `/users/userB` directly.
2.  **Shadow Verification Flag**: User A tries to create or update their own profile `/users/userA` with an unrequested field like `isAdmin: true` or `role: "admin"`.
3.  **Invalid ID Format Injection**: Attempt to create a user profile under a non-alphanumeric ID `/users/user_#@$!junk` containing harmful characters.

### Scenario 4-6: Unauthorized Products Manipulation
4.  **Impersonation List Posts**: Authenticated User A tries to post a product with `sellerId: "userB"` to spoof seller status.
5.  **Illegal Price Injection**: Attempt to create a listing `/products/prod1` with an invalid `price: -100` or `price: 1e99`.
6.  **Listing Hijack**: User B tries to update a product owned by User A to alter its seller identity or title.

### Scenario 7-9: Chat Negotiation Tampering
7.  **Snooping / Thread Interception**: User C (not buyer or seller) attempts to read details of chat thread `/chats/chat_userA_userB`.
8.  **Status Cheat**: A buyer tries to bypass seller delivery by setting `tradeStatus: 'completed'` directly before `tradeStatus: 'delivered'`.
9.  **Message Impersonation / Spoofing**: User A logs in and posts a message under `/messages/msg1` with `senderId: 'userB'`.

### Scenario 10-12: Integrity Defeating Reviews
10. **Self-Review Exploitation**: A seller registers a review where `buyerId == sellerId` to artificially inflate their ratings.
11. **Super-Rating Out of Bounds**: Buyer tries to post a review with `rating: 100` or `rating: -5`.
12. **Review Alteration Hijack**: User B attempts to change a review left by User A to alter the score or comment.

---

## 3. Security Assertions

All "Dirty Dozen" malicious payloads, as well as unauthenticated accesses, will be checked against the final, secured `firestore.rules` compiler and must be rejected.
