const assert = require('assert');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { app } = require('../server/gateway/apiGateway');
const { query, pool } = require('../database/database');

const TEST_PORT = 3003;
let serverInstance;

function signToken(userId, username) {
    return jwt.sign({ userId, username }, process.env.JWT_SECRET || 'test-secret', { expiresIn: '1h' });
}

async function runTests() {
    console.log('🚀 Starting channelLogic integration tests...');

    serverInstance = app.listen(TEST_PORT, () => {
        console.log(`📡 Test server running on port ${TEST_PORT}`);
    });

    const ownerId = uuidv4();
    const subscriberId = uuidv4();
    const ownerToken = signToken(ownerId, 'ch_owner');
    const subscriberToken = signToken(subscriberId, 'ch_sub');

    let channelId;

    try {
        await query(`DELETE FROM message_views WHERE message_id IN (SELECT id FROM messages WHERE chat_id IN (SELECT id FROM chats WHERE owner_id = $1))`, [ownerId]);
        await query(`DELETE FROM messages WHERE chat_id IN (SELECT id FROM chats WHERE owner_id = $1)`, [ownerId]);
        await query(`DELETE FROM chat_members WHERE user_id IN ($1, $2)`, [ownerId, subscriberId]);
        await query(`DELETE FROM chats WHERE owner_id = $1`, [ownerId]);
        await query(`DELETE FROM users WHERE username IN ('ch_owner', 'ch_sub')`);

        await query(
            `INSERT INTO users (id, username, password_hash, first_name, is_bot) VALUES
             ($1, 'ch_owner', 'pwd', 'Owner', FALSE),
             ($2, 'ch_sub', 'pwd', 'Subscriber', FALSE)`,
            [ownerId, subscriberId]
        );

        const createRes = await fetch(`http://localhost:${TEST_PORT}/api/v1/chats/create-channel`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ownerToken}`
            },
            body: JSON.stringify({
                title: 'Test Channel',
                description: 'Channel for tests',
                isPublic: true,
                username: 'test_ch_' + Date.now().toString(36).slice(-6)
            })
        });
        assert.strictEqual(createRes.status, 201, 'Channel creation should succeed');
        const createData = await createRes.json();
        channelId = createData.chatId;
        assert.ok(channelId);
        console.log('✅ Channel creation passed');

        const subscribeRes = await fetch(`http://localhost:${TEST_PORT}/api/v1/channels/${channelId}/subscribe`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${subscriberToken}` }
        });
        assert.strictEqual(subscribeRes.status, 200);
        console.log('✅ Subscribe passed');

        const subPostRes = await fetch(`http://localhost:${TEST_PORT}/api/v1/messages/${channelId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${subscriberToken}`
            },
            body: JSON.stringify({ content: 'Subscriber post attempt' })
        });
        assert.strictEqual(subPostRes.status, 403, 'Subscriber must not post to channel');
        console.log('✅ Subscriber post blocked');

        const adminPostRes = await fetch(`http://localhost:${TEST_PORT}/api/v1/messages/${channelId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ownerToken}`
            },
            body: JSON.stringify({ content: 'Official channel post', isSilent: true, authorSignature: 'Editor' })
        });
        assert.strictEqual(adminPostRes.status, 201);
        const adminPostData = await adminPostRes.json();
        assert.strictEqual(adminPostData.message.isSilent, true);
        assert.strictEqual(adminPostData.message.authorSignature, 'Editor');
        console.log('✅ Admin post passed');

        const getRes = await fetch(`http://localhost:${TEST_PORT}/api/v1/channels/${channelId}`, {
            headers: { 'Authorization': `Bearer ${subscriberToken}` }
        });
        assert.strictEqual(getRes.status, 200);
        const getData = await getRes.json();
        assert.ok(getData.channel.subscriberCount >= 2);
        console.log('✅ Channel info passed');

        console.log('🎉 All channelLogic tests passed!');
    } catch (e) {
        console.error('❌ Tests failed:', e);
        process.exitCode = 1;
    } finally {
        try {
            if (channelId) {
                await query('DELETE FROM message_views WHERE message_id IN (SELECT id FROM messages WHERE chat_id = $1)', [channelId]);
                await query('DELETE FROM messages WHERE chat_id = $1', [channelId]);
                await query('DELETE FROM chat_members WHERE chat_id = $1', [channelId]);
                await query('DELETE FROM chats WHERE id = $1', [channelId]);
            }
            await query('DELETE FROM users WHERE id IN ($1, $2)', [ownerId, subscriberId]);
        } catch (cleanupErr) {
            console.error('⚠️ Cleanup error:', cleanupErr.message);
        }
        if (serverInstance) {
            serverInstance.close(async () => {
                try { await pool.end(); } catch (_) {}
                process.exit(process.exitCode || 0);
            });
        }
    }
}

runTests();
