function createGatewayStartupMigrations({ logger, query }) {
    async function autoMigrate() {
        try {
            logger.info('🔧 Running database migrations...');
    
            // Фикс: убираем NOT NULL со всех необязательных колонок users
            const optionalUserCols = ['phone', 'name', 'avatar', 'bio', 'last_name', 'avatar_url', 'first_name'];
            for (const col of optionalUserCols) {
                await query(`ALTER TABLE users ALTER COLUMN ${col} DROP NOT NULL`).catch(() => {});
            }
            await query(`ALTER TABLE users ALTER COLUMN phone SET DEFAULT NULL`).catch(() => {});
            await query(`ALTER TABLE users ALTER COLUMN name SET DEFAULT NULL`).catch(() => {});
            await query(`ALTER TABLE users ALTER COLUMN avatar SET DEFAULT NULL`).catch(() => {});
            await query(`ALTER TABLE users ALTER COLUMN avatar_url SET DEFAULT ''`).catch(() => {});
            await query(`ALTER TABLE users ALTER COLUMN bio SET DEFAULT ''`).catch(() => {});
            // Убираем UNIQUE constraint на phone (пустые строки конфликтуют)
            await query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_phone_key`).catch(() => {});
            await query(`DROP INDEX IF EXISTS users_phone_key`).catch(() => {});
            // Обнуляем пустые phone чтобы не было дублей
            await query(`UPDATE users SET phone = NULL WHERE phone = ''`).catch(() => {});
            // Фикс таблицы chats — добавляем недостающие колонки
            await query(`ALTER TABLE chats ADD COLUMN IF NOT EXISTS title VARCHAR(128)`).catch(() => {});
            await query(`ALTER TABLE chats ADD COLUMN IF NOT EXISTS name VARCHAR(128)`).catch(() => {});
            await query(`ALTER TABLE chats ADD COLUMN IF NOT EXISTS description TEXT DEFAULT ''`).catch(() => {});
            await query(`ALTER TABLE chats ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT ''`).catch(() => {});
            await query(`ALTER TABLE chats ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE`).catch(() => {});
            await query(`ALTER TABLE chats ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE`).catch(() => {});
            await query(`ALTER TABLE chats ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMP`).catch(() => {});
            await query(`ALTER TABLE chats ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP`).catch(() => {});
    
            // Per-user закреп и архив чатов
            await query(`
                CREATE TABLE IF NOT EXISTS user_chat_settings (
                    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                    chat_id UUID REFERENCES chats(id) ON DELETE CASCADE,
                    is_pinned BOOLEAN DEFAULT FALSE,
                    pinned_at TIMESTAMP,
                    is_archived BOOLEAN DEFAULT FALSE,
                    archived_at TIMESTAMP,
                    last_read_at TIMESTAMP,
                    PRIMARY KEY (user_id, chat_id)
                )
            `).catch(() => {});
            await query(`ALTER TABLE user_chat_settings ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMP`).catch(() => {});
            await query(`
                INSERT INTO user_chat_settings (user_id, chat_id, last_read_at)
                SELECT cm.user_id, cm.chat_id, COALESCE(MAX(m.created_at), NOW())
                FROM chat_members cm
                LEFT JOIN messages m ON m.chat_id = cm.chat_id
                LEFT JOIN user_chat_settings ucs ON ucs.user_id = cm.user_id AND ucs.chat_id = cm.chat_id
                WHERE ucs.user_id IS NULL
                GROUP BY cm.user_id, cm.chat_id
            `).catch(() => {});
            await query(`
                UPDATE user_chat_settings ucs
                SET last_read_at = COALESCE(latest.last_message_at, NOW())
                FROM (
                    SELECT cm.user_id, cm.chat_id, MAX(m.created_at) AS last_message_at
                    FROM chat_members cm
                    LEFT JOIN messages m ON m.chat_id = cm.chat_id
                    GROUP BY cm.user_id, cm.chat_id
                ) latest
                WHERE ucs.user_id = latest.user_id
                  AND ucs.chat_id = latest.chat_id
                  AND ucs.last_read_at IS NULL
            `).catch(() => {});
            
            // Сообщения
            await query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE`);
            await query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMP`);
            await query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_edited BOOLEAN DEFAULT FALSE`);
            await query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP`);
            await query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE`);
            await query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_message_id UUID`);
            await query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_url TEXT`);
            await query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_type VARCHAR(50)`);
            await query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_encrypted BOOLEAN DEFAULT FALSE, ADD COLUMN IF NOT EXISTS media_encryption JSONB`);
            await query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS voice_duration INTEGER DEFAULT 0`);
            // Убеждаемся что media_url — TEXT (неограниченный размер для base64)
            await query(`ALTER TABLE messages ALTER COLUMN media_url TYPE TEXT`);
            
            // Пользователи
            await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(64) NOT NULL DEFAULT ''`);
            await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(64) DEFAULT ''`);
            await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT ''`);
            await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT ''`);
            await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_bot BOOLEAN DEFAULT FALSE`);
            await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT FALSE`);
            await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS language VARCHAR(10) DEFAULT 'ru'`);
            
            // Настройки пользователей
            await query(`
                CREATE TABLE IF NOT EXISTS user_settings (
                    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                    settings JSONB DEFAULT '{"theme":"dark","notifications":true,"sounds":true,"language":"ru"}',
                    privacy_settings JSONB DEFAULT '{}',
                    notification_settings JSONB DEFAULT '{}',
                    sound_settings JSONB DEFAULT '{}',
                    storage_settings JSONB DEFAULT '{}',
                    advanced_settings JSONB DEFAULT '{}',
                    folders JSONB DEFAULT '[]',
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            `);
            
            // Passcode column
            await query(`ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS passcode_hash TEXT DEFAULT NULL`);
            await query(`ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS passcode_enabled BOOLEAN DEFAULT FALSE`);
            await query(`ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS passcode_timeout INTEGER DEFAULT 60`);
    
            // Сессии пользователей
            await query(`
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
                )
            `);
            
            // Заблокированные пользователи
            await query(`
                CREATE TABLE IF NOT EXISTS blocked_users (
                    id UUID PRIMARY KEY,
                    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                    blocked_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                    blocked_at TIMESTAMP DEFAULT NOW(),
                    UNIQUE(user_id, blocked_user_id)
                )
            `);
            
            // Стикерпаки
            await query(`
                CREATE TABLE IF NOT EXISTS sticker_packs (
                    id UUID PRIMARY KEY,
                    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                    name VARCHAR(100) NOT NULL,
                    description TEXT,
                    icon_url TEXT,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            `);
            
            // Стикеры
            await query(`
                CREATE TABLE IF NOT EXISTS stickers (
                    id UUID PRIMARY KEY,
                    pack_id UUID REFERENCES sticker_packs(id) ON DELETE CASCADE,
                    image_url TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            `);
    
            // GIF — общие для всех пользователей
            await query(`
                CREATE TABLE IF NOT EXISTS gifs (
                    id UUID PRIMARY KEY,
                    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                    name VARCHAR(100),
                    url TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            `);
            await query(`CREATE INDEX IF NOT EXISTS idx_gifs_user ON gifs(user_id)`);
    
            // Избранные GIF — для каждого пользователя
            await query(`
                CREATE TABLE IF NOT EXISTS favorite_gifs (
                    id UUID PRIMARY KEY,
                    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                    gif_id UUID REFERENCES gifs(id) ON DELETE CASCADE,
                    created_at TIMESTAMP DEFAULT NOW(),
                    UNIQUE(user_id, gif_id)
                )
            `);
            await query(`CREATE INDEX IF NOT EXISTS idx_favorite_gifs_user ON favorite_gifs(user_id)`);
    
            // Медиафайлы — отдельная таблица для хранения в БД
            await query(`
                CREATE TABLE IF NOT EXISTS media_files (
                    id UUID PRIMARY KEY,
                    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                    data TEXT NOT NULL,
                    mime_type VARCHAR(100),
                    size_bytes INTEGER DEFAULT 0,
                    encrypted BOOLEAN DEFAULT FALSE, encryption JSONB,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            `);
            await query(`ALTER TABLE media_files ADD COLUMN IF NOT EXISTS encrypted BOOLEAN DEFAULT FALSE, ADD COLUMN IF NOT EXISTS encryption JSONB`);
            await query(`CREATE INDEX IF NOT EXISTS idx_media_files_user ON media_files(user_id)`);
            
            // Индексы
            await query(`CREATE INDEX IF NOT EXISTS idx_messages_pinned ON messages(chat_id) WHERE is_pinned = TRUE`);
            await query(`CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id)`);
            await query(`CREATE INDEX IF NOT EXISTS idx_messages_chat_created ON messages(chat_id, created_at DESC)`);
            await query(`CREATE INDEX IF NOT EXISTS idx_messages_reply ON messages(reply_to_message_id)`);
            await query(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id)`);
            await query(`CREATE INDEX IF NOT EXISTS idx_blocked_user ON blocked_users(user_id)`);
            await query(`CREATE INDEX IF NOT EXISTS idx_sticker_packs_user ON sticker_packs(user_id)`);
            await query(`CREATE INDEX IF NOT EXISTS idx_stickers_pack ON stickers(pack_id)`);
            
            // Закрепление и архивирование чатов
            await query(`ALTER TABLE chats ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE`);
            await query(`ALTER TABLE chats ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE`);
            await query(`ALTER TABLE chats ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMP`);
            await query(`ALTER TABLE chats ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP`);
            await query(`ALTER TABLE chats ADD COLUMN IF NOT EXISTS description TEXT DEFAULT ''`);
            await query(`ALTER TABLE chats ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT ''`);
            
            // Индексы для производительности
            await query(`CREATE INDEX IF NOT EXISTS idx_chats_pinned ON chats(is_pinned) WHERE is_pinned = TRUE`);
            await query(`CREATE INDEX IF NOT EXISTS idx_chats_archived ON chats(is_archived) WHERE is_archived = TRUE`);
            
            // Создаём уникальный индекс для предотвращения дубликатов приватных чатов
            await query(`DROP INDEX IF EXISTS idx_private_chat_unique`);
            
            // Создаём триггерную функцию для проверки дубликатов приватных чатов
            await query(`
                CREATE OR REPLACE FUNCTION prevent_duplicate_private_chats()
                RETURNS TRIGGER AS $$
                DECLARE
                    existing_chat_id UUID;
                    chat_type TEXT;
                BEGIN
                    -- Получаем тип чата
                    SELECT type INTO chat_type FROM chats WHERE id = NEW.chat_id;
                    
                    -- Только для приватных чатов
                    IF chat_type = 'private' THEN
                        -- Проверяем, существует ли уже чат с этими двумя пользователями
                        WITH other_members AS (
                            SELECT user_id FROM chat_members 
                            WHERE chat_id = NEW.chat_id AND user_id != NEW.user_id
                            LIMIT 1
                        )
                        SELECT c.id INTO existing_chat_id
                        FROM chats c
                        JOIN chat_members cm1 ON c.id = cm1.chat_id AND cm1.user_id = NEW.user_id
                        JOIN chat_members cm2 ON c.id = cm2.chat_id AND cm2.user_id = (SELECT user_id FROM other_members)
                        WHERE c.type = 'private' AND c.id != NEW.chat_id;
                        
                        IF existing_chat_id IS NOT NULL THEN
                            RAISE EXCEPTION 'Private chat already exists between these users';
                        END IF;
                    END IF;
                    RETURN NEW;
                END;
                $$ LANGUAGE plpgsql;
            `);
            
            // Создаём триггер
            await query(`
                DROP TRIGGER IF EXISTS check_duplicate_private_chats ON chat_members;
                CREATE TRIGGER check_duplicate_private_chats
                BEFORE INSERT ON chat_members
                FOR EACH ROW
                EXECUTE FUNCTION prevent_duplicate_private_chats();
            `);
            
            // Реакции на сообщения
            await query(`
                CREATE TABLE IF NOT EXISTS message_reactions (
                    id UUID PRIMARY KEY,
                    message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
                    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                    emoji VARCHAR(10) NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    UNIQUE(message_id, user_id, emoji)
                )
            `);
            await query(`CREATE INDEX IF NOT EXISTS idx_reactions_message ON message_reactions(message_id)`);
    
            // 2FA — доп. пароль
            await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS two_fa_hash VARCHAR(255)`);
            await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS two_fa_enabled BOOLEAN DEFAULT FALSE`);
    
            // Статусы пользователей
            await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_fake BOOLEAN DEFAULT FALSE`);
            await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_scam BOOLEAN DEFAULT FALSE`);
            await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS badge VARCHAR(20) DEFAULT NULL`);
            await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS badges TEXT[] DEFAULT '{}'`);
            await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_muted BOOLEAN DEFAULT FALSE`);
            await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT FALSE`);
            await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS muted_until TIMESTAMP DEFAULT NULL`);
            await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS mute_reason TEXT DEFAULT NULL`);
            await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS block_reason TEXT DEFAULT NULL`);
    
            // Поиск по сообщениям - храним незашифрованный текст для поиска
            try {
                await query(`ALTER TABLE messages ADD COLUMN content_plain TEXT`);
                console.log('Added content_plain to messages table');
            } catch (error) {
                if (error.code === '42701') { // 'duplicate_column' error code
                    console.log('Column content_plain already exists, skipping migration.');
                } else {
                    console.error('Error adding content_plain column:', error);
                }
            }
    
            // Запросы в поддержку
            await query(`
                CREATE TABLE IF NOT EXISTS support_requests (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                    chat_id UUID REFERENCES chats(id) ON DELETE CASCADE,
                    message TEXT NOT NULL,
                    status VARCHAR(20) DEFAULT 'open',
                    created_at TIMESTAMP DEFAULT NOW()
                )
            `);
            await query(`CREATE INDEX IF NOT EXISTS idx_support_user ON support_requests(user_id)`);
            await query(`CREATE INDEX IF NOT EXISTS idx_support_status ON support_requests(status)`);
    
            // Избранные сообщения
            await query(`            CREATE TABLE IF NOT EXISTS favorite_messages (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                    message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
                    saved_at TIMESTAMP DEFAULT NOW(),
                    UNIQUE(user_id, message_id)
                )
            `);
            await query(`CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorite_messages(user_id)`);
    
            // E2E Encryption — публичные ключи пользователей
            await query(`
                CREATE TABLE IF NOT EXISTS user_public_keys (
                    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                    public_key TEXT NOT NULL,
                    key_id VARCHAR(64) NOT NULL,
                    pq_public_key TEXT,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            `);
            await query(`ALTER TABLE user_public_keys ADD COLUMN IF NOT EXISTS pq_public_key TEXT`).catch(() => {});
    
            // E2E Encryption — зашифрованные сессионные ключи для каждого чата
            await query(`
                CREATE TABLE IF NOT EXISTS chat_encryption_keys (
                    id UUID PRIMARY KEY,
                    chat_id UUID REFERENCES chats(id) ON DELETE CASCADE,
                    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                    encrypted_key TEXT NOT NULL,
                    sender_key_id VARCHAR(64) NOT NULL,
                    pq_ciphertext TEXT,
                    created_at TIMESTAMP DEFAULT NOW(),
                    UNIQUE(chat_id, user_id)
                )
            `);
            await query(`ALTER TABLE chat_encryption_keys ADD COLUMN IF NOT EXISTS pq_ciphertext TEXT`).catch(() => {});
    
            // MLS Encryption Tables
            await query(`
                CREATE TABLE IF NOT EXISTS user_mls_keypackages (
                    id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    keypackage_id VARCHAR(64) NOT NULL, keypackage_bytes TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS group_mls_state (
                    chat_id UUID PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
                    epoch BIGINT NOT NULL DEFAULT 0, tree_structure TEXT NOT NULL, updated_at TIMESTAMP DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS group_mls_commits (
                    id UUID PRIMARY KEY, chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
                    epoch BIGINT NOT NULL, sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    commit_bytes TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW(), UNIQUE(chat_id, epoch)
                );
                CREATE INDEX IF NOT EXISTS idx_mls_kp_user ON user_mls_keypackages(user_id);
                CREATE INDEX IF NOT EXISTS idx_g_mls_commits ON group_mls_commits(chat_id, epoch);
            `).catch(() => {});
    
            // Добавляем флаг зашифрованности к сообщениям
            await query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_encrypted BOOLEAN DEFAULT FALSE`);
            await query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS encryption_iv TEXT`);
            await query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_mls BOOLEAN DEFAULT FALSE`);
            await query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS mls_epoch INT DEFAULT 0`);
    
            // Расширяем CHECK-ограничение типов сообщений — добавляем 'call'
            await query(`ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_type_check`).catch(() => {});
            await query(`ALTER TABLE messages ADD CONSTRAINT messages_type_check CHECK (type IN ('text','image','video','audio','voice','file','sticker','gif','contact','location','call'))`).catch(() => {});

            // P1: key_epoch для ротации сессионных ключей (forward secrecy)
            await query(`ALTER TABLE chat_encryption_keys ADD COLUMN IF NOT EXISTS key_epoch INTEGER DEFAULT 0`).catch(() => {});

            // P1: PostgreSQL-backed rate limiter
            await query(`
                CREATE TABLE IF NOT EXISTS rate_limit_hits (
                    key TEXT NOT NULL PRIMARY KEY,
                    hits INTEGER NOT NULL DEFAULT 0,
                    reset_at TIMESTAMPTZ NOT NULL
                )
            `).catch(() => {});
            await query(`CREATE INDEX IF NOT EXISTS idx_rate_limit_reset ON rate_limit_hits(reset_at)`).catch(() => {});

            // P1: MLS Welcome messages (для новых участников групп)
            await query(`
                CREATE TABLE IF NOT EXISTS group_mls_welcome (
                    id UUID PRIMARY KEY,
                    chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
                    recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    epoch BIGINT NOT NULL DEFAULT 0,
                    welcome_bytes TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    UNIQUE(chat_id, recipient_id)
                )
            `).catch(() => {});
            await query(`CREATE INDEX IF NOT EXISTS idx_mls_welcome_recipient ON group_mls_welcome(chat_id, recipient_id)`).catch(() => {});

            // P2: Crypto audit log
            await query(`
                CREATE TABLE IF NOT EXISTS crypto_audit_log (
                    id UUID PRIMARY KEY,
                    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
                    chat_id UUID REFERENCES chats(id) ON DELETE SET NULL,
                    event_type VARCHAR(50) NOT NULL,
                    details JSONB DEFAULT '{}',
                    created_at TIMESTAMP DEFAULT NOW()
                )
            `).catch(() => {});
            await query(`CREATE INDEX IF NOT EXISTS idx_crypto_audit_user ON crypto_audit_log(user_id, created_at DESC)`).catch(() => {});
            await query(`CREATE INDEX IF NOT EXISTS idx_crypto_audit_chat ON crypto_audit_log(chat_id, created_at DESC)`).catch(() => {});
            await query(`CREATE INDEX IF NOT EXISTS idx_crypto_audit_event ON crypto_audit_log(event_type, created_at DESC)`).catch(() => {});

            logger.info('✅ Database migrations completed!');
            
        } catch (error) {
            logger.warn('⚠️ Migration warning:', error.message);
        }
    }
    return { autoMigrate };
}

module.exports = createGatewayStartupMigrations;
