const assert = require('assert');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { app, server: httpServer } = require('../server/gateway/apiGateway');
const { query, pool } = require('../database/database');
const { publishScheduledMessages } = require('../server/gateway/channels');

const TEST_PORT = 3005;
let serverInstance;

function signToken(userId, username) {
    return jwt.sign({ userId, username }, process.env.JWT_SECRET || 'test-secret', { expiresIn: '1h' });
}

async function runTests() {
    console.log('🚀 Starting channelScheduling integration tests...');

    serverInstance = app.listen(TEST_PORT);

    const ownerId = uuidv4();
    const ownerToken = signToken(ownerId, 'sch_owner');
    let channelId;
    let scheduledMsgId;

    try {
        await query(`DELETE FROM users WHERE username = 'sch_owner'`);
        await query(`INSERT INTO users (id, username, password_hash, first_name, is_bot) VALUES ($1, 'sch_owner', 'pwd', 'Owner', FALSE)`, [ownerId]);

        const chRes = await fetch(`http://localhost:${TEST_PORT}/api/v1/chats/create-channel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ownerToken}` },
            body: JSON.stringify({ title: 'Schedule Channel', isPublic: false })
        });
        channelId = (await chRes.json()).chatId;

        const future = new Date(Date.now() + 2 * 60 * 1000).toISOString();
        const schedRes = await fetch(`http://localhost:${TEST_PORT}/api/v1/messages/${channelId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ownerToken}` },
            body: JSON.stringify({ content: 'Future post', scheduledAt: future, isSilent: true })
        });
        assert.strictEqual(schedRes.status, 201);
        const schedData = await schedRes.json();
        scheduledMsgId = schedData.message.id;
        assert.ok(schedData.message.scheduledAt);
        assert.strictEqual(schedData.message.publishedAt, null);
        console.log('✅ Scheduled post created');

        const listBefore = await fetch(`http://localhost:${TEST_PORT}/api/v1/messages/${channelId}`, {
            headers: { 'Authorization': `Bearer ${ownerToken}` }
        });
        const beforeData = await listBefore.json();
        const foundBefore = beforeData.messages.find(m => m.id === scheduledMsgId);
        assert.ok(foundBefore, 'Owner should see scheduled post in list');

        await query(
            `UPDATE messages SET scheduled_at = NOW() - INTERVAL '1 minute' WHERE id = $1`,
            [scheduledMsgId]
        );

        const broadcastToChat = async () => {};
        await publishScheduledMessages({ query, broadcastToChat, logger: console, uuidv4 });

        const row = await query('SELECT published_at, is_silent FROM messages WHERE id = $1', [scheduledMsgId]);
        assert.ok(row.rows[0].published_at, 'Scheduled post should be published');
        assert.strictEqual(row.rows[0].is_silent, true);
        console.log('✅ Scheduled publisher passed');

        console.log('🎉 All channelScheduling tests passed!');
    } catch (e) {
        console.error('❌ Tests failed:', e);
        process.exitCode = 1;
    } finally {
        try {
            if (channelId) {
                await query('DELETE FROM messages WHERE chat_id = $1', [channelId]);
                await query('DELETE FROM chat_members WHERE chat_id = $1', [channelId]);
                await query('DELETE FROM chats WHERE id = $1', [channelId]);
            }
            await query('DELETE FROM users WHERE id = $1', [ownerId]);
        } catch (_) {}
        if (serverInstance) {
            serverInstance.close(async () => {
                try { await pool.end(); } catch (_) {}
                process.exit(process.exitCode || 0);
            });
        }
    }
}

runTests();
