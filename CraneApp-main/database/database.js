require('dotenv').config();
const { Pool } = require('pg');

function shouldUseSsl(connectionString) {
    if (!connectionString) return false;
    if (process.env.DB_SSL) return process.env.DB_SSL === 'true';
    if (process.env.PGSSLMODE === 'disable') return false;

    try {
        const hostname = new URL(connectionString).hostname;
        if (['localhost', '127.0.0.1', 'db'].includes(hostname)) {
            return false;
        }
    } catch (_) {
        return process.env.NODE_ENV === 'production';
    }

    return process.env.NODE_ENV === 'production';
}

function normalizeConnectionString(connectionString) {
    if (!connectionString) return connectionString;
    if (process.env.DB_PREFER_IPV6 === 'true') return connectionString;

    try {
        const url = new URL(connectionString);
        if (url.hostname === 'localhost') {
            url.hostname = '127.0.0.1';
        }
        return url.toString();
    } catch (_) {
        return connectionString;
    }
}

const databaseUrl = normalizeConnectionString(process.env.DATABASE_URL);

// Railway автоматически даёт эти переменные при добавлении PostgreSQL
const pool = new Pool({
    connectionString: databaseUrl,
    ssl: shouldUseSsl(databaseUrl) ? { rejectUnauthorized: false } : false,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
});

async function query(text, params, timeoutMs = 12000) {
    const client = await pool.connect();
    try {
        await client.query(`SET statement_timeout = ${timeoutMs}`);
        const res = await client.query(text, params);
        return res;
    } finally {
        client.release();
    }
}

async function initDatabase() {
    try {
        const res = await pool.query('SELECT NOW()');
        console.log('✅ Database connected:', res.rows[0].now);
    } catch (error) {
        console.error('❌ Database init failed:', error);
        throw error;
    }
}

async function ensureTablesExist() {
    const schema = `
    -- Users table
    CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        phone VARCHAR(20),
        username VARCHAR(32) UNIQUE,
        first_name VARCHAR(64) NOT NULL,
        last_name VARCHAR(64),
        bio TEXT,
        avatar VARCHAR(255),
        avatar_url TEXT DEFAULT '',
        password_hash VARCHAR(255) NOT NULL,
        is_verified BOOLEAN DEFAULT FALSE,
        is_online BOOLEAN DEFAULT FALSE,
        is_bot BOOLEAN DEFAULT FALSE,
        is_premium BOOLEAN DEFAULT FALSE,
        is_blocked BOOLEAN DEFAULT FALSE,
        language VARCHAR(10) DEFAULT 'ru',
        last_seen TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    
    -- Add is_blocked column if it doesn't exist (for existing tables)
    DO $$
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'is_blocked'
        ) THEN
            ALTER TABLE users ADD COLUMN is_blocked BOOLEAN DEFAULT FALSE;
        END IF;
    END $$;

    -- Chats table
    CREATE TABLE IF NOT EXISTS chats (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        type VARCHAR(20) NOT NULL CHECK (type IN ('private', 'group', 'channel')),
        title VARCHAR(128),
        name VARCHAR(128),
        description TEXT DEFAULT '',
        avatar VARCHAR(255),
        avatar_url TEXT DEFAULT '',
        owner_id UUID REFERENCES users(id),
        is_pinned BOOLEAN DEFAULT FALSE,
        is_archived BOOLEAN DEFAULT FALSE,
        pinned_at TIMESTAMP,
        archived_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_chats_type ON chats(type);
    CREATE INDEX IF NOT EXISTS idx_chats_owner ON chats(owner_id);

    -- Chat members table
    CREATE TABLE IF NOT EXISTS chat_members (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        chat_id UUID REFERENCES chats(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        role VARCHAR(20) DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        muted_until TIMESTAMP,
        permissions JSONB DEFAULT '{}',
        pinned BOOLEAN DEFAULT FALSE,
        UNIQUE(chat_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_members_chat ON chat_members(chat_id);
    CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_members(user_id);

    -- Add permissions column if it doesn't exist (for existing tables)
    DO $$
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'chat_members' AND column_name = 'permissions'
        ) THEN
            ALTER TABLE chat_members ADD COLUMN permissions JSONB DEFAULT '{}';
        END IF;
    END $$;

    -- Chat bans table
    CREATE TABLE IF NOT EXISTS chat_bans (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        chat_id UUID REFERENCES chats(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        banned_by UUID REFERENCES users(id),
        reason TEXT,
        banned_until TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(chat_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_bans_chat ON chat_bans(chat_id);

    -- Per-user chat settings
    CREATE TABLE IF NOT EXISTS user_chat_settings (
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        chat_id UUID REFERENCES chats(id) ON DELETE CASCADE,
        is_pinned BOOLEAN DEFAULT FALSE,
        pinned_at TIMESTAMP,
        is_archived BOOLEAN DEFAULT FALSE,
        archived_at TIMESTAMP,
        last_read_at TIMESTAMP,
        PRIMARY KEY (user_id, chat_id)
    );

    -- Messages table
    CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        chat_id UUID REFERENCES chats(id) ON DELETE CASCADE,
        sender_id UUID REFERENCES users(id),
        content TEXT,
        type VARCHAR(20) DEFAULT 'text' CHECK (type IN ('text', 'image', 'video', 'audio', 'voice', 'file', 'sticker', 'gif', 'contact', 'location', 'call')),
        media_url TEXT,
        media_type VARCHAR(50),
        media_encrypted BOOLEAN DEFAULT FALSE,
        media_encryption JSONB,
        reply_to_message_id UUID,
        forwarded_from UUID REFERENCES messages(id),
        voice_duration INTEGER DEFAULT 0,
        is_pinned BOOLEAN DEFAULT FALSE,
        pinned_at TIMESTAMP,
        is_edited BOOLEAN DEFAULT FALSE,
        edited_at TIMESTAMP,
        is_deleted BOOLEAN DEFAULT FALSE,
        deleted_at TIMESTAMP,
        is_encrypted BOOLEAN DEFAULT FALSE,
        encryption_iv TEXT,
        is_mls BOOLEAN DEFAULT FALSE,
        mls_epoch INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id);
    CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
    CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);

    -- Reactions table
    CREATE TABLE IF NOT EXISTS reactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id),
        emoji VARCHAR(10) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(message_id, user_id, emoji)
    );
    CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions(message_id);

    -- Calls table
    CREATE TABLE IF NOT EXISTS calls (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        chat_id UUID REFERENCES chats(id),
        caller_id UUID REFERENCES users(id),
        type VARCHAR(20) CHECK (type IN ('voice', 'video')),
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'ended', 'missed')),
        started_at TIMESTAMP,
        ended_at TIMESTAMP,
        duration INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_calls_chat ON calls(chat_id);
    CREATE INDEX IF NOT EXISTS idx_calls_caller ON calls(caller_id);

    -- Contacts table
    CREATE TABLE IF NOT EXISTS contacts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        contact_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(64),
        is_blocked BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, contact_user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id);
    CREATE INDEX IF NOT EXISTS idx_contacts_blocked ON contacts(user_id, is_blocked);

    -- Sessions table
    CREATE TABLE IF NOT EXISTS sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        refresh_token VARCHAR(255) NOT NULL,
        device_info JSON,
        ip_address VARCHAR(45),
        user_agent TEXT,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(refresh_token);

    -- Settings table
    CREATE TABLE IF NOT EXISTS settings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
        notifications JSON DEFAULT '{}',
        privacy JSON DEFAULT '{}',
        appearance JSON DEFAULT '{}',
        language VARCHAR(10) DEFAULT 'en',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- User settings (extended)
    CREATE TABLE IF NOT EXISTS user_settings (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        settings JSONB DEFAULT '{"theme":"dark","notifications":true,"sounds":true,"language":"ru"}',
        privacy_settings JSONB DEFAULT '{}',
        notification_settings JSONB DEFAULT '{}',
        sound_settings JSONB DEFAULT '{}',
        storage_settings JSONB DEFAULT '{}',
        advanced_settings JSONB DEFAULT '{}',
        folders JSONB DEFAULT '[]',
        passcode_hash TEXT DEFAULT NULL,
        passcode_enabled BOOLEAN DEFAULT FALSE,
        passcode_timeout INTEGER DEFAULT 60,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
    );

    -- User sessions (devices)
    CREATE TABLE IF NOT EXISTS user_sessions (
        id UUID PRIMARY KEY,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        device_name VARCHAR(100),
        device_type VARCHAR(50),
        ip_address VARCHAR(50),
        location VARCHAR(255),
        user_agent TEXT,
        last_active TIMESTAMP DEFAULT NOW(),
        first_login TIMESTAMP DEFAULT NOW(),
        is_current BOOLEAN DEFAULT FALSE
    );

    -- Blocked users
    CREATE TABLE IF NOT EXISTS blocked_users (
        id UUID PRIMARY KEY,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        blocked_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        blocked_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, blocked_user_id)
    );

    -- Sticker packs
    CREATE TABLE IF NOT EXISTS sticker_packs (
        id UUID PRIMARY KEY,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        icon_url TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
    );

    -- Stickers
    CREATE TABLE IF NOT EXISTS stickers (
        id UUID PRIMARY KEY,
        pack_id UUID REFERENCES sticker_packs(id) ON DELETE CASCADE,
        image_url TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
    );

    -- Media files
    CREATE TABLE IF NOT EXISTS media_files (
        id UUID PRIMARY KEY,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        owner_id UUID,
        chat_id UUID,
        file_type VARCHAR(50),
        data TEXT,
        file_url TEXT,
        thumbnail_url TEXT,
        mime_type VARCHAR(100),
        size_bytes INTEGER DEFAULT 0,
        encrypted BOOLEAN DEFAULT FALSE,
        encryption JSONB,
        original_name VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_media_files_user ON media_files(user_id);

    -- Message reactions
    CREATE TABLE IF NOT EXISTS message_reactions (
        id UUID PRIMARY KEY,
        message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        emoji VARCHAR(10) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(message_id, user_id, emoji)
    );
    CREATE INDEX IF NOT EXISTS idx_message_reactions_message ON message_reactions(message_id);

    -- User public keys (E2E encryption)
    CREATE TABLE IF NOT EXISTS user_public_keys (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        public_key TEXT NOT NULL,
        key_id VARCHAR(64) NOT NULL,
        pq_public_key TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
    );

    -- Chat encryption keys (E2E)
    CREATE TABLE IF NOT EXISTS chat_encryption_keys (
        id UUID PRIMARY KEY,
        chat_id UUID REFERENCES chats(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        encrypted_key TEXT NOT NULL,
        sender_key_id VARCHAR(64) NOT NULL,
        pq_ciphertext TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(chat_id, user_id)
    );

    -- MLS KeyPackages
    CREATE TABLE IF NOT EXISTS user_mls_keypackages (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        keypackage_id VARCHAR(64) NOT NULL,
        keypackage_bytes TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_mls_keypackages_user ON user_mls_keypackages(user_id);

    -- MLS Group State
    CREATE TABLE IF NOT EXISTS group_mls_state (
        chat_id UUID PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
        epoch BIGINT NOT NULL DEFAULT 0,
        tree_structure TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
    );

    -- MLS Commits
    CREATE TABLE IF NOT EXISTS group_mls_commits (
        id UUID PRIMARY KEY,
        chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        epoch BIGINT NOT NULL,
        sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        commit_bytes TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(chat_id, epoch)
    );
    CREATE INDEX IF NOT EXISTS idx_group_mls_commits_chat_epoch ON group_mls_commits(chat_id, epoch);

    -- Reports table
    CREATE TABLE IF NOT EXISTS reports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reported_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reason VARCHAR(100) NOT NULL,
        description TEXT,
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'resolved', 'dismissed')),
        admin_notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_reports_reported ON reports(reported_user_id);
    CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(reporter_id);
    CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
    CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at DESC);
    `;

    try {
        await pool.query(schema);
        console.log('✅ Database tables initialized');
    } catch (error) {
        console.error('❌ Failed to create tables:', error);
        throw error;
    }
}

module.exports = { pool, query, initDatabase, ensureTablesExist };
