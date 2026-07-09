/**
 * Database Seed Script
 * Creates initial data for CraneApp (CraneApp bot, news channel, admin account)
 */

const { pool } = require('./database');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const logger = require('../server/services/logger');

async function seed() {
    try {
        logger.info(' Starting database seeding...');

        // Create admin user
        // NOTE: Change this password in production!
        const adminPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'ChangeMe123!', 10);
        const adminId = '00000000-0000-0000-0000-000000000001';
        await pool.query(
            `INSERT INTO users (id, phone, username, first_name, last_name, is_bot, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())
             ON CONFLICT (id) DO NOTHING`,
            [adminId, '+999000000000', 'admin2282', 'Crane', 'Admin', false]
        );

        // Create CraneApp Bot
        const botId = '00000000-0000-0000-0000-000000000002';
        await pool.query(
            `INSERT INTO users (id, phone, username, first_name, last_name, bio, is_bot, is_verified, badge, avatar_url, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
             ON CONFLICT (id) DO NOTHING`,
            [botId, '+999000000001', 'craneapp_bot', 'CraneApp', 'Bot', 
             'Официальный бот CraneApp. Уведомления о безопасности и поддержка.', true, true, 'verified', 'https://i.ibb.co/1Y4Pg7BF/94-20260317155000.png']
        );

        // Create News Channel
        // Create News Channel
        const channelId = '00000000-0000-0000-0000-000000000003';
        await pool.query(
            `INSERT INTO chats (id, type, title, description, owner_id, avatar_url, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())
             ON CONFLICT (id) DO NOTHING`,
            [channelId, 'channel', 'Новости CraneApp', 'Официальные обновления и новости проекта', 
             adminId, null]
        );

        // Add admin as channel member
        await pool.query(
            `INSERT INTO chat_members (chat_id, user_id, role, joined_at)
             VALUES ($1, $2, 'owner', NOW())
             ON CONFLICT (chat_id, user_id) DO NOTHING`,
            [channelId, adminId]
        );

        // Create welcome chat with CraneApp Bot
        const welcomeChatId = '00000000-0000-0000-0000-000000000004';
        await pool.query(
            `INSERT INTO chats (id, type, title, owner_id, created_at)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (id) DO NOTHING`,
            [welcomeChatId, 'private', 'CraneApp', botId]
        );

        // Insert sample news posts
        const newsPosts = [
            { content: '🚀 Добро пожаловать в CraneApp! Мы запустили новую версию мессенджера.', type: 'text' },
            { content: '🎨 Теперь доступен новый дизайн в розово-фиолетовых тонах!', type: 'text' },
            { content: '🤖 Познакомьтесь с CraneApp Bot — официальным ботом мессенджера.', type: 'text' },
            { content: '🔒 Улучшенная безопасность: все сообщения теперь защищены.', type: 'text' }
        ];

        for (const post of newsPosts) {
            await pool.query(
                `INSERT INTO messages (id, chat_id, sender_id, content, type, created_at)
                 VALUES ($1, $2, $3, $4, $5, NOW())
                 ON CONFLICT (id) DO NOTHING`,
                [crypto.randomUUID(), channelId, adminId, post.content, post.type]
            );
        }

        // Create default settings for all users
        await pool.query(
            `CREATE TABLE IF NOT EXISTS user_settings (
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
            )`
        );

        logger.info('✅ Database seeding completed successfully!');
        logger.info('📊 Created:');
        logger.info('   - Admin account: @admin2282 (password from ADMIN_PASSWORD env)');
        logger.info('   - CraneApp Bot: @craneapp_bot (verified ✓)');
        logger.info('   - News Channel: Новости CraneApp');
        logger.info('   - Sample news posts: 4');
        
        process.exit(0);
    } catch (error) {
        logger.error('❌ Database seeding failed:', error);
        process.exit(1);
    }
}

// Run seed
seed();