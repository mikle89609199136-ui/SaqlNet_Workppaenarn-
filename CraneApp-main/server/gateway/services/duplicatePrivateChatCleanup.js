function createDuplicatePrivateChatCleanup({ createCraneAppBotChat, logger, query }) {
    async function cleanDuplicatePrivateChats() {
        try {
            logger.info('🧹 Cleaning duplicate private chats...');
            const result = await query(`
                WITH user_pairs AS (
                    SELECT c.id as chat_id, c.created_at, ARRAY_AGG(cm.user_id ORDER BY cm.user_id) as user_ids
                    FROM chats c
                    JOIN chat_members cm ON c.id = cm.chat_id
                    WHERE c.type = 'private'
                    GROUP BY c.id, c.created_at
                    HAVING COUNT(cm.user_id) = 2
                ),
                duplicate_groups AS (
                    SELECT user_ids, ARRAY_AGG(chat_id ORDER BY created_at ASC) as chat_ids, MIN(created_at) as first_created
                    FROM user_pairs
                    GROUP BY user_ids
                    HAVING COUNT(*) > 1
                )
                SELECT * FROM duplicate_groups
            `);

            if (result.rows.length === 0) {
                logger.info('✅ No duplicate private chats found');
                return;
            }

            logger.info(`📊 Found ${result.rows.length} groups of duplicate chats`);
            for (const group of result.rows) {
                await removeDuplicateGroup(group.chat_ids);
            }

            logger.info('✅ Duplicate private chats cleaned successfully');
            await ensureBotChats();
            await cleanDuplicateSessions();
        } catch (error) {
            logger.error('❌ Error cleaning duplicate chats:', error);
        }
    }

    async function removeDuplicateGroup(chatIds) {
        const keepChatId = chatIds[0];
        const deleteChatIds = chatIds.slice(1);
        logger.info(`Keeping chat ${keepChatId}, deleting: ${deleteChatIds.join(', ')}`);

        for (const deleteChatId of deleteChatIds) {
            await query(`UPDATE messages SET chat_id = $1 WHERE chat_id = $2 AND is_deleted = FALSE`, [keepChatId, deleteChatId]);
            await query(`DELETE FROM chat_members WHERE chat_id = $1`, [deleteChatId]);
            await query(`DELETE FROM chats WHERE id = $1`, [deleteChatId]);
            logger.info(`✅ Deleted duplicate chat: ${deleteChatId}`);
        }
    }

    async function ensureBotChats() {
        try {
            const allUsers = await query('SELECT id FROM users WHERE is_bot = FALSE OR is_bot IS NULL');
            for (const u of allUsers.rows) {
                await createCraneAppBotChat(u.id);
            }
            logger.info('✅ CraneApp bot chats ensured for all users');
        } catch (e) {
            logger.warn('⚠️ CraneApp bot setup failed:', e.message);
        }
    }

    async function cleanDuplicateSessions() {
        try {
            await query(`
                DELETE FROM user_sessions
                WHERE id NOT IN (
                    SELECT DISTINCT ON (user_id, user_agent) id
                    FROM user_sessions
                    ORDER BY user_id, user_agent, last_active DESC
                )
            `);
            logger.info('✅ Duplicate sessions cleaned');
        } catch (e) {
            logger.warn('⚠️ Session cleanup failed:', e.message);
        }
    }

    return { cleanDuplicatePrivateChats };
}

module.exports = createDuplicatePrivateChatCleanup;
