CREATE TABLE IF NOT EXISTS users.profiles (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    first_name VARCHAR(64) NOT NULL,
    last_name VARCHAR(64) NOT NULL DEFAULT '',
    bio TEXT NOT NULL DEFAULT '',
    avatar_url TEXT NOT NULL DEFAULT '',
    badges TEXT[] NOT NULL DEFAULT '{}',
    is_premium BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users.settings (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    settings JSONB NOT NULL DEFAULT '{"theme":"dark","notifications":true,"sounds":true,"language":"ru"}',
    privacy_settings JSONB NOT NULL DEFAULT '{"lastSeen":"all","phoneVisibility":"contacts","photoVisibility":"all","messagesFromStrangers":true,"groupsAdd":"all"}',
    notification_settings JSONB NOT NULL DEFAULT '{}',
    sound_settings JSONB NOT NULL DEFAULT '{}',
    storage_settings JSONB NOT NULL DEFAULT '{}',
    advanced_settings JSONB NOT NULL DEFAULT '{}',
    folders JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users.blocked_users (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    blocked_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    blocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, blocked_user_id),
    CONSTRAINT users_blocked_not_self CHECK (user_id <> blocked_user_id)
);

CREATE INDEX IF NOT EXISTS users_profiles_name_idx ON users.profiles(first_name, last_name);
CREATE INDEX IF NOT EXISTS users_blocked_blocked_user_idx ON users.blocked_users(blocked_user_id);

CREATE TABLE IF NOT EXISTS public.user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    device_name TEXT NOT NULL DEFAULT '',
    device_type TEXT NOT NULL DEFAULT '',
    ip_address TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    last_active TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    first_login TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_current BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS user_sessions_user_idx ON public.user_sessions(user_id);
