# Username rename semantics

`auth.users.username` is the single canonical username. Registration, availability
checks, and rename use the same trim/lowercase/format policy. Login and QR lookup
normalize case and whitespace while retaining support for stored legacy names.

`users.profiles` is the single source of truth for mutable public profile data,
including `first_name`, `last_name`, `bio`, and `avatar_url`. Values with the same
names in `auth.users` are legacy registration data and must not be updated or used
as a fallback for profile reads. They will be removed after all readers and the
registration flow have been migrated to `users.profiles`.

- Rename is `PUT /api/v2/users/me/username`. It locks the user row, claims the
  canonical value in `auth.username_registry`, updates the name, and records the
  previous and new values in `users.username_changes` in one transaction.
- A user may change username once per 24 hours. A rejected request returns `429`
  and `Retry-After`; requests that normalize to the current name are idempotent and
  do not consume the cooldown.
- Search, profile responses, chat lists, and member summaries read the canonical
  value from `auth.users`. A committed rename emits `user_profile_updated` through
  PostgreSQL `NOTIFY`; chat-service forwards it to the user's devices and accounts
  sharing a chat. The event carries `userId` and the canonical `username`, allowing
  API consumers to invalidate profile/search/chat caches. If an ephemeral event is
  missed while offline, every subsequent REST projection still reads the canonical
  value from `auth.users`.
- User and chat identity is UUID-based, so memberships, messages, and encryption
  state are unaffected. Existing access tokens may retain the old informational
  username claim until refresh, but authorization and response projection use the
  user ID rather than that claim.
- QR/deep links are username-based. QR lookup uses an exact case-insensitive match
  and continues to support legacy `base.N` usernames. Previous names remain reserved
  to their original account, so an old link can never be redirected to a new owner;
  it stops resolving unless that original account reclaims the name.
- The requesting client should replace its current-user cache with the profile in the
  rename response; other devices and chat peers receive the backend realtime event.

The public availability endpoint remains the only unauthenticated username-existence
signal. Rename is authenticated and reports the same occupied/free distinction, so it
does not introduce a stronger enumeration primitive.
