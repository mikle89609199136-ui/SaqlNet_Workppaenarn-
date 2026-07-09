const express = require('express');

function createAuthAccountRoutes({
    authMiddleware,
    bcrypt,
    i18n,
    jwt,
    logger,
    QRCode,
    query,
    security,
    uuidv4,
}) {
    const router = express.Router();
    const qrTokens = new Map();

    setInterval(() => {
        const now = Date.now();
        for (const [token, data] of qrTokens.entries()) {
            if (data.expiresAt < now) qrTokens.delete(token);
        }
    }, 2 * 60 * 1000);

    router.post('/logout', authMiddleware, async (req, res) => {
        try {
            const token = req.headers.authorization.split(' ')[1];
            await security.revokeToken(token, req.user.id);
            logger.info('✅ User logged out:', req.user.username);
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/logout-all', authMiddleware, async (req, res) => {
        try {
            await security.revokeAllUserSessions(req.user.id);
            logger.info('✅ All sessions revoked for:', req.user.username);
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/qr-token', authMiddleware, async (req, res) => {
        try {
            const qrToken = uuidv4();
            const expiresAt = Date.now() + 5 * 60 * 1000;

            qrTokens.set(qrToken, {
                userId: req.user.id,
                expiresAt,
                confirmed: false,
                authToken: null,
            });

            const host = req.get('host');
            const protocol = req.headers['x-forwarded-proto'] || req.protocol;
            const qrUrl = `${protocol}://${host}/api/v2/auth/qr-confirm?token=${qrToken}`;
            const qrImage = await QRCode.toDataURL(qrUrl, {
                width: 256,
                margin: 2,
                color: { dark: '#000000', light: '#ffffff' },
            });

            res.json({ qrToken, qrImage, expiresAt });
        } catch (error) {
            logger.error('QR token generation error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.get('/qr-status/:token', (req, res) => {
        const data = qrTokens.get(req.params.token);
        if (!data) return res.json({ status: 'expired' });
        if (data.expiresAt < Date.now()) {
            qrTokens.delete(req.params.token);
            return res.json({ status: 'expired' });
        }
        if (data.confirmed) {
            const authToken = data.authToken;
            qrTokens.delete(req.params.token);
            return res.json({ status: 'confirmed', authToken });
        }
        res.json({ status: 'pending', expiresAt: data.expiresAt });
    });

    router.get('/qr-confirm', async (req, res) => {
        try {
            const data = qrTokens.get(req.query.token);
            const lang = req.locale || i18n.languageFromHeaders(req);
            const tt = (key, vars) => i18n.t(lang, key, vars);

            if (!data || data.expiresAt < Date.now()) {
                return res.status(400).send(renderQrError(tt('qrExpiredTitle'), tt('qrExpiredDesc')));
            }

            const userResult = await query(
                'SELECT id, username, first_name, last_name, avatar_url FROM users WHERE id = $1',
                [data.userId]
            );
            const user = userResult.rows[0];
            if (!user) return res.status(404).send(tt('userNotFound'));

            res.send(renderQrConfirmPage({ qrToken: req.query.token, lang, tt, user }));
        } catch (error) {
            logger.error('QR confirm page error:', error);
            res.status(500).send('Internal Server Error');
        }
    });

    router.post('/qr-confirm', async (req, res) => {
        try {
            const { qrToken } = req.body;
            if (!qrToken) return res.status(400).json({ error: 'qrToken required' });

            const data = qrTokens.get(qrToken);
            if (!data || data.expiresAt < Date.now()) {
                return res.status(400).json({ error: 'QR connection expired or invalid' });
            }

            // Verify scanner token if provided
            let scanningUserId = null;
            const authHeader = req.headers.authorization;
            if (authHeader && authHeader.startsWith('Bearer ')) {
                try {
                    const token = authHeader.split(' ')[1];
                    const decoded = jwt.verify(token, process.env.JWT_SECRET);
                    scanningUserId = decoded.userId ?? decoded.subject;
                } catch (_) {}
            }

            if (scanningUserId && scanningUserId !== data.userId) {
                return res.status(403).json({ error: 'Unauthorized user for this QR session' });
            }

            const userResult = await query(
                'SELECT id, username, first_name, last_name, avatar_url FROM users WHERE id = $1',
                [data.userId]
            );
            const user = userResult.rows[0];
            if (!user) return res.status(404).json({ error: 'User not found' });

            const authToken = jwt.sign(
                { userId: user.id, username: user.username },
                process.env.JWT_SECRET,
                { expiresIn: '30d' }
            );

            data.confirmed = true;
            data.authToken = authToken;

            res.json({ success: true, authToken });
        } catch (error) {
            logger.error('QR confirm POST error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.get('/me', async (req, res) => {
        try {
            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return res.status(401).json({ error: req.t('noToken') });
            }

            const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
            const result = await query(
                'SELECT id, username, first_name, last_name, avatar_url, bio, badge, is_bot FROM users WHERE id = $1',
                [decoded.userId ?? decoded.subject]
            );
            const user = result.rows[0];
            if (!user) return res.status(401).json({ error: req.t('userNotFound') });

            res.status(200).json({
                user: {
                    id: user.id,
                    username: user.username,
                    firstName: user.first_name,
                    lastName: user.last_name,
                    avatarUrl: user.avatar_url || '',
                    bio: user.bio || '',
                    badge: user.badge || null,
                    isBot: user.is_bot || false,
                },
            });
        } catch (error) {
            res.status(401).json({ error: req.t('invalidToken') });
        }
    });

    router.get('/sessions', authMiddleware, async (req, res) => {
        try {
            const result = await query(
                `SELECT id, device_name, device_type, ip_address, location,
                        last_active, first_login, is_current
                 FROM user_sessions
                 WHERE user_id = $1
                 ORDER BY last_active DESC`,
                [req.user.id]
            );

            res.json({
                sessions: result.rows.map((session) => ({
                    id: session.id,
                    deviceName: session.device_name,
                    deviceType: session.device_type,
                    ipAddress: session.ip_address,
                    location: session.location,
                    lastActive: session.last_active,
                    firstLogin: session.first_login,
                    is_current: session.is_current,
                })),
            });
        } catch (error) {
            logger.error('❌ Get sessions error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/change-password', authMiddleware, async (req, res) => {
        try {
            const { currentPassword, newPassword } = req.body;
            if (!currentPassword || !newPassword) {
                return res.status(400).json({ error: req.t('bothPasswordsRequired') });
            }
            if (newPassword.length < 6) {
                return res.status(400).json({ error: req.t('passwordMin') });
            }

            const result = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
            const user = result.rows[0];
            if (!user) return res.status(404).json({ error: req.t('userNotFound') });

            const valid = await bcrypt.compare(currentPassword, user.password_hash);
            if (!valid) return res.status(401).json({ error: req.t('currentPasswordInvalid') });

            const newHash = await bcrypt.hash(newPassword, 10);
            await query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, req.user.id]);
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.get('/2fa/status', authMiddleware, async (req, res) => {
        try {
            const result = await query('SELECT two_fa_enabled FROM users WHERE id = $1', [req.user.id]);
            res.json({ enabled: result.rows[0]?.two_fa_enabled || false });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/2fa/enable', authMiddleware, async (req, res) => {
        try {
            const { password } = req.body;
            if (!password || password.length < 6) {
                return res.status(400).json({ error: req.t('passwordMin') });
            }

            const hash = await bcrypt.hash(password, 10);
            await query('UPDATE users SET two_fa_hash = $1, two_fa_enabled = TRUE WHERE id = $2', [hash, req.user.id]);
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/2fa/disable', authMiddleware, async (req, res) => {
        try {
            const { password } = req.body;
            const result = await query('SELECT two_fa_hash FROM users WHERE id = $1', [req.user.id]);
            const hash = result.rows[0]?.two_fa_hash;
            if (!hash) return res.status(400).json({ error: req.t('twoFANotSet') });

            const match = await bcrypt.compare(password, hash);
            if (!match) return res.status(401).json({ error: req.t('invalidPassword') });

            await query('UPDATE users SET two_fa_hash = NULL, two_fa_enabled = FALSE WHERE id = $1', [req.user.id]);
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/2fa/verify', authMiddleware, async (req, res) => {
        try {
            const { password } = req.body;
            const result = await query('SELECT two_fa_hash, two_fa_enabled FROM users WHERE id = $1', [req.user.id]);
            const row = result.rows[0];
            if (!row?.two_fa_enabled) return res.json({ success: true, required: false });

            const match = await bcrypt.compare(password, row.two_fa_hash);
            if (!match) return res.status(401).json({ error: req.t('invalidAdditionalPassword') });

            res.json({ success: true, required: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    return router;
}

function renderQrError(title, message) {
    return `
        <html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#000;color:#fff;">
            <h2 style="color:#FF4B4B;">${title}</h2>
            <p>${message}</p>
        </body></html>
    `;
}

function renderQrConfirmPage({ qrToken, lang, tt, user }) {
    return `
        <!DOCTYPE html>
        <html lang="${lang}">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${tt('qrLoginTitle')}</title>
            <style>
                body { font-family: system-ui, sans-serif; background: #000; color: #fff; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
                .card { background: #121212; border-radius: 16px; padding: 32px; text-align: center; max-width: 320px; width: 90%; }
                .avatar { width: 72px; height: 72px; border-radius: 50%; background: linear-gradient(135deg, #FF007F, #9D00FF); display: flex; align-items: center; justify-content: center; font-size: 28px; font-weight: 700; margin: 0 auto 16px; }
                h2 { margin: 0 0 8px; font-size: 20px; }
                p { color: #B0B0B0; font-size: 14px; margin: 0 0 24px; }
                .btn { width: 100%; padding: 14px; border-radius: 12px; border: none; background: linear-gradient(135deg, #FF007F, #9D00FF); color: #fff; font-size: 15px; font-weight: 600; cursor: pointer; }
                .btn:disabled { opacity: 0.5; cursor: not-allowed; }
                .success { color: #00FF88; font-size: 13px; margin-top: 12px; display: none; }
                .error { color: #FF4B4B; font-size: 13px; margin-top: 12px; display: none; }
            </style>
        </head>
        <body>
            <div class="card">
                <div class="avatar">${(user.first_name || user.username || '?')[0].toUpperCase()}</div>
                <h2>${user.first_name || user.username}</h2>
                <p>@${user.username}<br>${tt('qrLoginPrompt')}</p>
                <button class="btn" id="confirmBtn" onclick="doLogin()">${tt('qrLoginButton')}</button>
                <div class="success" id="successMsg">${tt('qrLoginSuccess')}</div>
                <div class="error" id="errorMsg"></div>
            </div>
            <script>
                async function doLogin() {
                    const btn = document.getElementById('confirmBtn');
                    const successMsg = document.getElementById('successMsg');
                    const errorMsg = document.getElementById('errorMsg');
                    
                    btn.disabled = true;
                    errorMsg.style.display = 'none';

                    try {
                        const localToken = localStorage.getItem('craneapp_auth_token');
                        const headers = { 'Content-Type': 'application/json' };
                        if (localToken) {
                            headers['Authorization'] = 'Bearer ' + localToken;
                        }

                        const res = await fetch('/api/v2/auth/qr-confirm', {
                            method: 'POST',
                            headers: headers,
                            body: JSON.stringify({ qrToken: '${qrToken}' })
                        });

                        const data = await res.json();
                        if (!res.ok) {
                            throw new Error(data.error || 'Failed to authorize device');
                        }

                        localStorage.setItem('craneapp_auth_token', data.authToken);
                        localStorage.setItem('craneapp_user_data', JSON.stringify({
                            id: '${user.id}',
                            username: '${user.username}',
                            firstName: '${user.first_name}',
                            lastName: '${user.last_name || ''}',
                            avatarUrl: '${user.avatar_url || ''}'
                        }));
                        
                        successMsg.style.display = 'block';
                        setTimeout(() => {
                            window.location.href = '/mobile/chats';
                        }, 800);
                    } catch (err) {
                        btn.disabled = false;
                        errorMsg.textContent = err.message;
                        errorMsg.style.display = 'block';
                    }
                }
            </script>
        </body>
        </html>
    `;
}

module.exports = createAuthAccountRoutes;
