const { spawn } = require('child_process');
const http = require('http');

const PORT = 3000;
const NODE_PORT = 3001;
const RUST_PORT = 5005;

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper to wait for a port to be open
async function waitPort(port, path = '/', expectedStatus = 200, timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const res = await new Promise((resolve, reject) => {
                const req = http.get({
                    hostname: '127.0.0.1',
                    port: port,
                    path: path,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    }
                }, (res) => {
                    // Consume response data to free socket
                    res.on('data', () => {});
                    resolve(res);
                });
                req.on('error', reject);
                req.end();
            });
            console.log(`Port ${port} path ${path} returned status ${res.statusCode}`);
            if (res.statusCode === expectedStatus || (port === RUST_PORT && res.statusCode === 404)) {
                return true;
            }
        } catch (e) {
            // port not open yet
        }
        await delay(500);
    }
    throw new Error(`Timeout waiting for port ${port}`);
}

async function request(url, options = {}) {
    const u = new URL(url);
    const clientOptions = {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: options.method || 'GET',
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            ...(options.headers || {})
        }
    };

    return new Promise((resolve, reject) => {
        const req = http.request(clientOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = data ? JSON.parse(data) : {};
                    resolve({ status: res.statusCode, body: parsed });
                } catch (e) {
                    resolve({ status: res.statusCode, body: data });
                }
            });
        });
        req.on('error', reject);
        if (options.body) {
            req.write(JSON.stringify(options.body));
        }
        req.end();
    });
}

async function main() {
    console.log('🚀 Starting integration test services...');

    const processes = [];

    // 1. Start Rust Crypto Service
    console.log('⚡ Starting Rust Crypto Service...');
    const rustProc = spawn('./server/crypto-rust/target/debug/crypto-rust', [], {
        stdio: 'inherit'
    });
    processes.push({ name: 'Rust Crypto', proc: rustProc });

    // 2. Start Node API Gateway
    console.log('🦢 Starting Node API Gateway...');
    const nodeProc = spawn('node', ['server/gateway/apiGateway.js'], {
        env: { ...process.env, PORT: NODE_PORT, NODE_PORT: NODE_PORT },
        stdio: 'inherit'
    });
    processes.push({ name: 'Node Gateway', proc: nodeProc });

    // 3. Start Go API Gateway
    console.log('🦢 Starting Go API Gateway...');
    const goProc = spawn('./server/gateway-go/gateway-go', [], {
        env: { ...process.env, PORT: PORT, NODE_PORT: NODE_PORT },
        stdio: 'inherit'
    });
    processes.push({ name: 'Go Gateway', proc: goProc });

    // Set up shutdown cleanup
    const cleanup = () => {
        console.log('\n🧹 Cleaning up processes...');
        for (const p of processes) {
            if (!p.proc.killed) {
                console.log(`Killing ${p.name}...`);
                p.proc.kill('SIGTERM');
            }
        }
    };

    process.on('exit', cleanup);
    process.on('SIGINT', () => { process.exit(1); });
    process.on('SIGTERM', () => { process.exit(1); });

    try {
        console.log('⏳ Waiting for services to become healthy...');
        await waitPort(RUST_PORT, '/');
        console.log('✅ Rust Crypto Service is UP');

        await waitPort(NODE_PORT, '/api/v2/health');
        console.log('✅ Node API Gateway is UP');

        await waitPort(PORT, '/api/v2/health');
        console.log('✅ Go API Gateway is UP');

        console.log('\n--- Running API Integration Tests ---');

        // Test 1: Go health check
        console.log('Test 1: GET /api/v2/health on Go Gateway');
        const healthRes = await request(`http://127.0.0.1:${PORT}/api/v2/health`);
        console.log('Result:', healthRes);
        if (healthRes.status !== 200 || healthRes.body.status !== 'ok') {
            throw new Error('Healthcheck test failed');
        }

        // Test 2: Rust Crypto verification endpoint directly
        console.log('Test 2: POST /api/v2/crypto/verify-key on Rust Crypto');
        const verifyKeyRes = await request(`http://127.0.0.1:${RUST_PORT}/api/v2/crypto/verify-key`, {
            method: 'POST',
            body: { key_id: 'testkey123', public_key: 'testpubkeybytes' }
        });
        console.log('Result:', verifyKeyRes);
        if (verifyKeyRes.status !== 200 || !verifyKeyRes.body.valid) {
            throw new Error('Verify Key test failed');
        }

        // Test 3: User Registration (User A)
        console.log('Test 3: Registering user A...');
        const usernameA = `testuserA_${Math.floor(Math.random() * 100000)}`;
        const registerARes = await request(`http://127.0.0.1:${PORT}/api/v2/auth/register`, {
            method: 'POST',
            body: {
                username: usernameA,
                password: 'testpassword123',
                firstName: 'TestA',
                lastName: 'User'
            }
        });
        console.log('Result User A:', registerARes);
        if (registerARes.status !== 201 || !registerARes.body.token) {
            throw new Error('Registration of User A failed');
        }
        const token = registerARes.body.token;
        const userId = registerARes.body.user.id;

        // Register User B
        console.log('Test 3b: Registering user B...');
        const usernameB = `testuserB_${Math.floor(Math.random() * 100000)}`;
        const registerBRes = await request(`http://127.0.0.1:${PORT}/api/v2/auth/register`, {
            method: 'POST',
            body: {
                username: usernameB,
                password: 'testpassword123',
                firstName: 'TestB',
                lastName: 'User'
            }
        });
        console.log('Result User B:', registerBRes);
        if (registerBRes.status !== 201 || !registerBRes.body.token) {
            throw new Error('Registration of User B failed');
        }
        const userIdB = registerBRes.body.user.id;

        // Create Private Chat between User A and User B
        console.log('Test 3c: Creating private chat between User A and User B...');
        const createChatRes = await request(`http://127.0.0.1:${PORT}/api/v2/chats/private`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: {
                userId: userIdB
            }
        });
        console.log('Result Create Chat:', createChatRes);
        if (createChatRes.status !== 201 || !createChatRes.body.chatId) {
            throw new Error('Create private chat failed');
        }
        const chatId = createChatRes.body.chatId;

        // Test 4: Upload MLS KeyPackages
        console.log('Test 4: POST /api/v2/mls/keypackages (Upload KeyPackages)');
        // Generate valid base64 keypackage bytes (must decode to something of length >= 10 to satisfy Rust validator)
        const mockKeyPackageBytes = Buffer.from('mockkeypackagebytes12345').toString('base64');
        const uploadKpRes = await request(`http://127.0.0.1:${PORT}/api/v2/mls/keypackages`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: {
                keypackages: [
                    { keypackageBytes: mockKeyPackageBytes }
                ]
            }
        });
        console.log('Result:', uploadKpRes);
        if (uploadKpRes.status !== 200 || !uploadKpRes.body.ok) {
            throw new Error('Upload KeyPackages failed');
        }

        // Test 5: Fetch MLS KeyPackage
        console.log('Test 5: GET /api/v2/mls/keypackages/:userId (Fetch one and consume)');
        const fetchKpRes = await request(`http://127.0.0.1:${PORT}/api/v2/mls/keypackages/${userId}`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        console.log('Result:', fetchKpRes);
        if (fetchKpRes.status !== 200 || !fetchKpRes.body.keypackageBytes) {
            throw new Error('Fetch KeyPackage failed');
        }

        // Test 6: Get MLS Group State
        console.log('Test 6: GET /api/v2/mls/group/:chatId/state');
        const stateRes = await request(`http://127.0.0.1:${PORT}/api/v2/mls/group/${chatId}/state`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        console.log('Result:', stateRes);
        if (stateRes.status !== 200 || stateRes.body.epoch !== '0') {
            throw new Error('Get MLS Group State failed');
        }

        // Test 7: Submit MLS Group Commit
        console.log('Test 7: POST /api/v2/mls/group/:chatId/commit');
        const mockCommitBytes = Buffer.from('mockcommitbytes12345').toString('base64');
        const commitRes = await request(`http://127.0.0.1:${PORT}/api/v2/mls/group/${chatId}/commit`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: {
                commitBytes: mockCommitBytes,
                currentEpoch: 0,
                treeStructure: 'mocktreestructure'
            }
        });
        console.log('Result:', commitRes);
        if (commitRes.status !== 200 || commitRes.body.nextEpoch !== 1) {
            throw new Error('Submit Commit failed');
        }

        // Test 8: Get updated state (should be epoch 1)
        console.log('Test 8: GET /api/v2/mls/group/:chatId/state (updated)');
        const updatedStateRes = await request(`http://127.0.0.1:${PORT}/api/v2/mls/group/${chatId}/state`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        console.log('Result:', updatedStateRes);
        if (updatedStateRes.status !== 200 || updatedStateRes.body.epoch !== '1') {
            throw new Error('Get updated MLS Group State failed');
        }

        console.log('\n🎉 ALL INTEGRATION TESTS PASSED SUCCESSFULLY! 🎉');
        process.exit(0);

    } catch (e) {
        console.error('❌ Integration tests failed:', e);
        process.exit(1);
    }
}

main();
