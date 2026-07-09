const assert = require('assert');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { app } = require('../server/gateway/apiGateway');
const { query, pool } = require('../database/database');

const TEST_PORT = 3004;
let serverInstance;

function signToken(userId, username) {
    return jwt.sign({ userId, username }, process.env.JWT_SECRET || 'test-secret', { expiresIn: '1h' });
}

async function runTests() {
    console.log('🚀 Starting channelComments integration tests...');

    serverInstance = app.listen(TEST_PORT);

    const ownerId = uuidv4();
    const subscriberId = uuidv4();
    const strangerId = uuidv4();
    const ownerToken = signToken(ownerId, 'cc_owner');
    const subscriberToken = signToken(subscriberId, 'cc_sub');
    const strangerToken = signToken(strangerId, 'cc_stranger');

    let channelId;
    let groupId;
    let postId;

    try {
        await query(`DELETE FROM users WHERE username IN ('cc_owner', 'cc_sub', 'cc_stranger')`);

        await query(
            `INSERT INTO users (id, username, password_hash, first_name, is_bot) VALUES
             ($1, 'cc_owner', 'pwd', 'Owner', FALSE),
             ($2, 'cc_sub', 'pwd', 'Sub', FALSE),
             ($3, 'cc_stranger', 'pwd', 'Stranger', FALSE)`,
            [ownerId, subscriberId, strangerId]
        );

        const chRes = await fetch(`http://localhost:${TEST_PORT}/api/v1/chats/create-channel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ownerToken}` },
            body: JSON.stringify({ title: 'Comments Channel', isPublic: true, username: 'cc_' + Date.now().toString(36).slice(-5) })
        });
        const chData = await chRes.json();
        channelId = chData.chatId;

        await fetch(`http://localhost:${TEST_PORT}/api/v1/channels/${channelId}/subscribe`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${subscriberToken}` }
        });

        const postRes = await fetch(`http://localhost:${TEST_PORT}/api/v1/messages/${channelId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ownerToken}` },
            body: JSON.stringify({ content: 'Post with comments' })
        });
        postId = (await postRes.json()).message.id;

        const strangerComment = await fetch(`http://localhost:${TEST_PORT}/api/v1/channels/${channelId}/posts/${postId}/comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${strangerToken}` },
            body: JSON.stringify({ content: 'No access' })
        });
        assert.strictEqual(strangerComment.status, 403);
        console.log('✅ Stranger comment blocked');

        const commentRes = await fetch(`http://localhost:${TEST_PORT}/api/v1/channels/${channelId}/posts/${postId}/comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${subscriberToken}` },
            body: JSON.stringify({ content: 'Nice post!' })
        });
        assert.strictEqual(commentRes.status, 201);
        console.log('✅ Subscriber comment passed');

        const listRes = await fetch(`http://localhost:${TEST_PORT}/api/v1/channels/${channelId}/posts/${postId}/comments`, {
            headers: { 'Authorization': `Bearer ${subscriberToken}` }
        });
        const listData = await listRes.json();
        assert.strictEqual(listData.comments.length, 1);
        console.log('✅ List comments passed');

        const grpRes = await fetch(`http://localhost:${TEST_PORT}/api/v1/chats/create-group`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ownerToken}` },
            body: JSON.stringify({ title: 'Discussion Group', members: [subscriberId] })
        });
        groupId = (await grpRes.json()).chatId;

        const linkRes = await fetch(`http://localhost:${TEST_PORT}/api/v1/channels/${channelId}/discussion`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ownerToken}` },
            body: JSON.stringify({ discussionChatId: groupId })
        });
        assert.strictEqual(linkRes.status, 200);
        console.log('✅ Discussion group linked');

        console.log('🎉 All channelComments tests passed!');
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
            if (groupId) {
                await query('DELETE FROM messages WHERE chat_id = $1', [groupId]);
                await query('DELETE FROM chat_members WHERE chat_id = $1', [groupId]);
                await query('DELETE FROM chats WHERE id = $1', [groupId]);
            }
            await query('DELETE FROM users WHERE id IN ($1, $2, $3)', [ownerId, subscriberId, strangerId]);
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
