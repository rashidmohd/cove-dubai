-- Sessions for signed-in guests, kept apart from admin sessions.
--
-- A separate table rather than rows in "admin_sessions": an admin session and
-- a guest session must never be interchangeable, and the simplest way to make
-- that impossible is for them to share nothing. Only a hash of the cookie
-- value is stored.

CREATE TABLE "guest_sessions" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "csrfToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guest_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "guest_sessions_tokenHash_key" ON "guest_sessions"("tokenHash");
CREATE INDEX "guest_sessions_accountId_idx" ON "guest_sessions"("accountId");
CREATE INDEX "guest_sessions_expiresAt_idx" ON "guest_sessions"("expiresAt");

ALTER TABLE "guest_sessions" ADD CONSTRAINT "guest_sessions_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "guest_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
