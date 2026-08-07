-- Identity Keys and Registration IDs
CREATE TABLE IF NOT EXISTS crypto.signal_identity_keys (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    identity_key TEXT NOT NULL,       -- Base64 encoded public Identity Key
    registration_id INTEGER NOT NULL, -- Signal protocol registration ID
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Signed PreKeys (rotated periodically)
CREATE TABLE IF NOT EXISTS crypto.signal_signed_prekeys (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    key_id INTEGER NOT NULL,
    public_key TEXT NOT NULL,         -- Base64 encoded public Signed PreKey
    signature TEXT NOT NULL,          -- Base64 encoded signature of public_key by identity_key
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, key_id)
);

-- One-Time PreKeys (consumed on first use)
CREATE TABLE IF NOT EXISTS crypto.signal_onetime_prekeys (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    key_id INTEGER NOT NULL,
    public_key TEXT NOT NULL,         -- Base64 encoded public One-Time PreKey
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, key_id)
);
