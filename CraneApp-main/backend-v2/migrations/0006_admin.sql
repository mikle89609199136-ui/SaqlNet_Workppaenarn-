-- Admin role column on users (safe to add if not exists)
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin', 'moderator'));

-- Reports table
CREATE TABLE IF NOT EXISTS admin.reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL CHECK (target_type IN ('user', 'message', 'chat')),
    target_id UUID NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
    resolution TEXT NOT NULL DEFAULT '',
    resolved_at TIMESTAMPTZ,
    resolved_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_reports_status_idx ON admin.reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_reports_reporter_idx ON admin.reports(reporter_id);
