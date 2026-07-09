CREATE SCHEMA IF NOT EXISTS support;

CREATE TABLE IF NOT EXISTS support.requests (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    subject    TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','closed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS support_requests_user_idx ON support.requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS support_requests_status_idx ON support.requests(status);

CREATE TABLE IF NOT EXISTS support.messages (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES support.requests(id) ON DELETE CASCADE,
    sender_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    is_staff   BOOLEAN NOT NULL DEFAULT FALSE,
    content    TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS support_messages_request_idx ON support.messages(request_id, created_at);
