const express = require('express');

function createChatModerationRoutes({ authMiddleware, broadcastToChat, logger, query, uuidv4 }) {
    const router = express.Router();

    router.use(authMiddleware);

    // Get list of banned users in a group
    router.get('/:chatId/bans', async (req, res) => {
        try {
            const { chatId } = req.params;
            const isGroup = await verifyIsGroup(query, chatId);
            if (!isGroup) return res.status(400).json({ error: 'Chat is not a group' });

            const rights = await getMemberRoleAndPerms(query, chatId, req.user.id);
            if (!rights || (rights.role !== 'owner' && rights.permissions?.can_ban_users !== true)) {
                return res.status(403).json({ error: req.t('accessDenied') || 'Access denied' });
            }

            const result = await query(
                `SELECT cb.id as ban_id, cb.reason, cb.banned_until, cb.created_at,
                        u.id as user_id, u.username, u.first_name, u.last_name, u.avatar_url
                 FROM chat_bans cb
                 JOIN users u ON cb.user_id = u.id
                 WHERE cb.chat_id = $1 AND (cb.banned_until IS NULL OR cb.banned_until > NOW())`,
                [chatId]
            );

            res.json({ bans: result.rows });
        } catch (error) {
            logger.error('Get group bans error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Invite/add a member to a group
    router.post('/:chatId/members', async (req, res) => {
        try {
            const { chatId } = req.params;
            const { userId } = req.body;
            if (!userId) return res.status(400).json({ error: 'User ID required' });

            const isGroup = await verifyIsGroup(query, chatId);
            if (!isGroup) return res.status(400).json({ error: 'Chat is not a group' });

            const rights = await getMemberRoleAndPerms(query, chatId, req.user.id);
            if (!rights) return res.status(403).json({ error: req.t('accessDenied') || 'Access denied' });

            if (rights.role === 'admin' && rights.permissions?.can_invite_users !== true) {
                return res.status(403).json({ error: 'Missing permission: can_invite_users' });
            }

            // Check if user is banned
            const banRes = await query(
                'SELECT 1 FROM chat_bans WHERE chat_id = $1 AND user_id = $2 AND (banned_until IS NULL OR banned_until > NOW())',
                [chatId, userId]
            );
            if (banRes.rows.length > 0) {
                return res.status(403).json({ error: 'User is banned from this group' });
            }

            // Insert member
            await query(
                'INSERT INTO chat_members (chat_id, user_id, role) VALUES ($1, $2, \'member\') ON CONFLICT DO NOTHING',
                [chatId, userId]
            );

            // Add system message
            const adderName = req.user.first_name || req.user.username || 'User';
            const addedRes = await query('SELECT first_name, username FROM users WHERE id = $1', [userId]);
            const addedName = addedRes.rows[0]?.first_name || addedRes.rows[0]?.username || 'User';
            const content = `${adderName} added ${addedName}`;
            const msgId = uuidv4();

            await query(
                "INSERT INTO messages (id, chat_id, sender_id, content, type, created_at) VALUES ($1, $2, $3, $4, 'text', NOW())",
                [msgId, chatId, req.user.id, content]
            );

            broadcastToChat(chatId, {
                type: 'new_message',
                chatId,
                chatType: 'group',
                message: { id: msgId, chatId, senderId: req.user.id, content, type: 'text', createdAt: new Date() }
            }, null);

            res.json({ success: true });
        } catch (error) {
            logger.error('Add group member error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Promote/demote user and update admin permissions
    router.post('/:chatId/members/:userId/role', async (req, res) => {
        try {
            const { chatId, userId } = req.params;
            const { role, permissions } = req.body;

            const isGroup = await verifyIsGroup(query, chatId);
            if (!isGroup) return res.status(400).json({ error: 'Chat is not a group' });

            const modRes = await query('SELECT role FROM chat_members WHERE chat_id = $1 AND user_id = $2', [chatId, req.user.id]);
            if (modRes.rows.length === 0 || modRes.rows[0].role !== 'owner') {
                return res.status(403).json({ error: 'Only the group owner can manage admin roles' });
            }

            const targetRes = await query('SELECT role FROM chat_members WHERE chat_id = $1 AND user_id = $2', [chatId, userId]);
            if (targetRes.rows.length === 0) {
                return res.status(404).json({ error: 'Target user is not a member of this chat' });
            }

            if (targetRes.rows[0].role === 'owner') {
                return res.status(400).json({ error: 'Cannot modify owner role' });
            }

            const cleanPermissions = {
                can_change_info: !!permissions?.can_change_info,
                can_delete_messages: !!permissions?.can_delete_messages,
                can_ban_users: !!permissions?.can_ban_users,
                can_invite_users: !!permissions?.can_invite_users,
                can_pin_messages: !!permissions?.can_pin_messages,
                can_add_admins: !!permissions?.can_add_admins,
            };

            await query(
                'UPDATE chat_members SET role = $1, permissions = $2 WHERE chat_id = $3 AND user_id = $4',
                [role === 'admin' ? 'admin' : 'member', JSON.stringify(cleanPermissions), chatId, userId]
            );

            // Broadcast updates
            broadcastToChat(chatId, {
                type: 'member_role_updated',
                chatId,
                userId,
                role: role === 'admin' ? 'admin' : 'member',
                permissions: cleanPermissions
            });

            res.json({ success: true });
        } catch (error) {
            logger.error('Manage role error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Mute user
    router.post('/:chatId/members/:userId/mute', async (req, res) => {
        try {
            const { chatId, userId } = req.params;
            const { duration, reason } = req.body;

            const check = await checkModerationRights(query, chatId, req.user.id, userId, 'can_ban_users');
            if (!check.allowed) return res.status(403).json({ error: check.error });

            const mutedUntil = calculateMuteUntil(duration);
            await query(
                'UPDATE chat_members SET muted_until = $1 WHERE chat_id = $2 AND user_id = $3',
                [mutedUntil, chatId, userId]
            );

            broadcastToChat(chatId, {
                type: 'member_muted',
                chatId,
                userId,
                mutedUntil
            });

            res.json({ success: true, mutedUntil });
        } catch (error) {
            logger.error('Mute member error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Unmute user
    router.post('/:chatId/members/:userId/unmute', async (req, res) => {
        try {
            const { chatId, userId } = req.params;

            const check = await checkModerationRights(query, chatId, req.user.id, userId, 'can_ban_users');
            if (!check.allowed) return res.status(403).json({ error: check.error });

            await query(
                'UPDATE chat_members SET muted_until = NULL WHERE chat_id = $2 AND user_id = $3',
                [chatId, userId]
            );

            broadcastToChat(chatId, {
                type: 'member_unmuted',
                chatId,
                userId
            });

            res.json({ success: true });
        } catch (error) {
            logger.error('Unmute member error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Ban user
    router.post('/:chatId/members/:userId/ban', async (req, res) => {
        try {
            const { chatId, userId } = req.params;
            const { duration, reason } = req.body;

            const check = await checkModerationRights(query, chatId, req.user.id, userId, 'can_ban_users');
            if (!check.allowed) return res.status(403).json({ error: check.error });

            const bannedUntil = calculateMuteUntil(duration);

            // Add to bans
            await query(
                `INSERT INTO chat_bans (chat_id, user_id, banned_by, reason, banned_until)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (chat_id, user_id) DO UPDATE SET banned_by = $3, reason = $4, banned_until = $5`,
                [chatId, userId, req.user.id, reason || null, bannedUntil]
            );

            // Remove member
            await query('DELETE FROM chat_members WHERE chat_id = $1 AND user_id = $2', [chatId, userId]);

            // Add system message
            const bannerName = req.user.first_name || req.user.username || 'Admin';
            const bannedRes = await query('SELECT first_name, username FROM users WHERE id = $1', [userId]);
            const bannedName = bannedRes.rows[0]?.first_name || bannedRes.rows[0]?.username || 'User';
            const content = `${bannerName} banned ${bannedName}`;
            const msgId = uuidv4();

            await query(
                "INSERT INTO messages (id, chat_id, sender_id, content, type, created_at) VALUES ($1, $2, $3, $4, 'text', NOW())",
                [msgId, chatId, req.user.id, content]
            );

            broadcastToChat(chatId, {
                type: 'member_banned',
                chatId,
                userId,
                bannedUntil
            });

            broadcastToChat(chatId, {
                type: 'new_message',
                chatId,
                chatType: 'group',
                message: { id: msgId, chatId, senderId: req.user.id, content, type: 'text', createdAt: new Date() }
            }, null);

            res.json({ success: true, bannedUntil });
        } catch (error) {
            logger.error('Ban member error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Unban user
    router.post('/:chatId/members/:userId/unban', async (req, res) => {
        try {
            const { chatId, userId } = req.params;

            const isGroup = await verifyIsGroup(query, chatId);
            if (!isGroup) return res.status(400).json({ error: 'Chat is not a group' });

            const rights = await getMemberRoleAndPerms(query, chatId, req.user.id);
            if (!rights || (rights.role !== 'owner' && rights.permissions?.can_ban_users !== true)) {
                return res.status(403).json({ error: 'Missing permission: can_ban_users' });
            }

            await query('DELETE FROM chat_bans WHERE chat_id = $1 AND user_id = $2', [chatId, userId]);

            broadcastToChat(chatId, {
                type: 'member_unbanned',
                chatId,
                userId
            });

            res.json({ success: true });
        } catch (error) {
            logger.error('Unban member error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Kick user (remove member)
    router.delete('/:chatId/members/:userId', async (req, res) => {
        try {
            const { chatId, userId } = req.params;

            const check = await checkModerationRights(query, chatId, req.user.id, userId, 'can_ban_users');
            if (!check.allowed) return res.status(403).json({ error: check.error });

            await query('DELETE FROM chat_members WHERE chat_id = $1 AND user_id = $2', [chatId, userId]);

            // Add system message
            const kickerName = req.user.first_name || req.user.username || 'Admin';
            const kickedRes = await query('SELECT first_name, username FROM users WHERE id = $1', [userId]);
            const kickedName = kickedRes.rows[0]?.first_name || kickedRes.rows[0]?.username || 'User';
            const content = `${kickerName} kicked ${kickedName}`;
            const msgId = uuidv4();

            await query(
                "INSERT INTO messages (id, chat_id, sender_id, content, type, created_at) VALUES ($1, $2, $3, $4, 'text', NOW())",
                [msgId, chatId, req.user.id, content]
            );

            broadcastToChat(chatId, {
                type: 'member_kicked',
                chatId,
                userId
            });

            broadcastToChat(chatId, {
                type: 'new_message',
                chatId,
                chatType: 'group',
                message: { id: msgId, chatId, senderId: req.user.id, content, type: 'text', createdAt: new Date() }
            }, null);

            res.json({ success: true });
        } catch (error) {
            logger.error('Kick member error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    return router;
}

async function verifyIsGroup(query, chatId) {
    const res = await query('SELECT type FROM chats WHERE id = $1', [chatId]);
    return res.rows.length > 0 && res.rows[0].type === 'group';
}

async function getMemberRoleAndPerms(query, chatId, userId) {
    const res = await query('SELECT role, permissions FROM chat_members WHERE chat_id = $1 AND user_id = $2', [chatId, userId]);
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
        role: row.role,
        permissions: typeof row.permissions === 'string' ? JSON.parse(row.permissions) : (row.permissions || {})
    };
}

async function checkModerationRights(query, chatId, moderatorId, targetId, requiredPermission) {
    const mod = await getMemberRoleAndPerms(query, chatId, moderatorId);
    if (!mod) return { allowed: false, error: 'Access denied' };

    const target = await getMemberRoleAndPerms(query, chatId, targetId);
    if (!target) return { allowed: false, error: 'Target user is not a member of this chat' };

    if (mod.role === 'owner') return { allowed: true, mod };
    if (mod.role === 'member') return { allowed: false, error: 'Only admins can moderate members' };

    if (target.role === 'owner' || target.role === 'admin') {
        return { allowed: false, error: 'Cannot moderate other admins or the owner' };
    }

    if (requiredPermission && mod.permissions[requiredPermission] !== true) {
        return { allowed: false, error: `Missing permission: ${requiredPermission}` };
    }

    return { allowed: true, mod };
}

function calculateMuteUntil(duration) {
    if (!duration || duration === 'forever' || duration === 'permanent') return null;
    if (typeof duration === 'number') {
        return new Date(Date.now() + duration * 60 * 1000);
    }
    if (typeof duration === 'string') {
        const num = parseInt(duration, 10);
        if (isNaN(num)) return null;
        if (duration.endsWith('m')) return new Date(Date.now() + num * 60 * 1000);
        if (duration.endsWith('h')) return new Date(Date.now() + num * 60 * 60 * 1000);
        if (duration.endsWith('d')) return new Date(Date.now() + num * 24 * 60 * 60 * 1000);
        if (duration.endsWith('w')) return new Date(Date.now() + num * 7 * 24 * 60 * 60 * 1000);
    }
    return null;
}

module.exports = createChatModerationRoutes;
