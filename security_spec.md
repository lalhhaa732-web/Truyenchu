# Security Specification (Phase 0: Payload-First Security TDD)

## 1. Data Invariants
1. **Default-Deny Catch-All**: Any path not explicitly matched is strictly denied (`allow read, write: if false;`).
2. **Novels (`/novels/{novelId}`)**:
   - Readable by any signed-in user where `resource.data.id == novelId` (for `get`) or `resource.data.chapterCount >= 0` (for `list`).
   - Can only be created by a verified authenticated user (`request.auth.token.email_verified == true`) where `incoming().ownerId == request.auth.uid`, `incoming().id == novelId`, `incoming().createdAt == request.time`, and `incoming().updatedAt == request.time`.
   - Can only be updated by the `ownerId` (`existing().ownerId == request.auth.uid`), preserving immutable fields (`id`, `ownerId`, `createdAt`) and requiring `incoming().updatedAt == request.time`.
3. **Chapters (`/novels/{novelId}/chapters/{chapterId}`)**:
   - Relational Sync (Master Gate): Creating a chapter requires verifying that `/novels/$(novelId)` exists and its `ownerId == request.auth.uid`.
   - `incoming().novelId == novelId`, `incoming().id == chapterId`, `incoming().ownerId == request.auth.uid`, and `incoming().createdAt == request.time`.
   - Chapters are immutable once published (`allow update: if false;`), and can only be deleted by the parent novel's owner.
4. **User Progress (`/users/{userId}/progress/{novelId}`)**:
   - Strictly isolated to the owner (`request.auth.uid == userId` and `resource.data.userId == request.auth.uid`).
   - Requires `incoming().userId == request.auth.uid`, `incoming().novelId == novelId`, and `incoming().updatedAt == request.time`.

## 2. The "Dirty Dozen" Payloads
1. **Shadow Field Injection on Novel Create**: `{ ..., "isAdmin": true }` -> Rejected by `hasOnly()`.
2. **Identity Spoofing on Novel Create**: `ownerId: "victim_uid"` when `request.auth.uid == "attacker_uid"` -> Rejected by `data.ownerId == request.auth.uid`.
3. **Unverified Email Write**: `request.auth.token.email_verified == false` -> Rejected by `isVerifiedUser()`.
4. **ID Poisoning**: 500-character junk string as `{novelId}` -> Rejected by `isValidId(novelId)`.
5. **Denial of Wallet / Oversized Content**: 100,000-character `synopsis` string -> Rejected by `data.synopsis.size() <= 2000`.
6. **Forged Client Timestamp on Create**: `createdAt` set to past/future timestamp instead of `request.time` -> Rejected by `incoming().createdAt == request.time`.
7. **Immutable Field Tampering on Update**: Changing `ownerId` or `createdAt` during novel update -> Rejected by `affectedKeys().hasOnly(...)` and immutability checks.
8. **Orphaned Chapter Write**: Creating `/novels/non_existent/chapters/c1` -> Rejected by `exists(/databases/$(database)/documents/novels/$(novelId))`.
9. **Unauthorized Chapter Injection**: User B attempting to add a chapter to User A's novel -> Rejected by Master Gate `get(/databases/$(database)/documents/novels/$(novelId)).data.ownerId == request.auth.uid`.
10. **Cross-User Progress Read (PII/Private Data Leak)**: User B attempting `get` or `list` on `/users/userA/progress` -> Rejected by `request.auth.uid == userId && resource.data.userId == request.auth.uid`.
11. **Value Poisoning on Update**: Updating `chapterCount` with a string `"999"` -> Rejected by `isValidNovelDoc(incoming())` wrapping the `allow update` block.
12. **Invalid Enum Injection**: Setting `status: "Hacked"` or `coverStyle: "neon"` -> Rejected by strict enum list validation.
