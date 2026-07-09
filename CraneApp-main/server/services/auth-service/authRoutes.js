const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const authService = require('./authService');

const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: errors.array()[0].msg });
    next();
};

router.post('/register', [
    body('username').isLength({ min: 3, max: 32 }).matches(/^[a-zA-Z0-9_]+$/),
    body('password').isLength({ min: 6 }),
    body('firstName').notEmpty(),
    validate
], async (req, res) => {
    try {
        const { username, password, firstName, lastName } = req.body;
        const result = await authService.registerUser(username, password, firstName, lastName);
        res.status(201).json({ success: true, user: result.user, token: result.token });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

router.post('/login', [
    body('username').notEmpty(),
    body('password').notEmpty(),
    validate
], async (req, res) => {
    try {
        const { username, password } = req.body;
        const result = await authService.loginUser(username, password);
        res.status(200).json({ success: true, user: result.user, token: result.token });
    } catch (error) {
        res.status(401).json({ success: false, error: error.message });
    }
});

router.get('/me', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, error: 'No token' });
        }
        const jwt = require('jsonwebtoken');
        const { query } = require('../../../database/database');
        const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
        const result = await query('SELECT id, username, first_name, last_name FROM users WHERE id = $1', [decoded.userId ?? decoded.subject]);
        if (result.rows.length === 0) return res.status(401).json({ success: false, error: 'User not found' });
        res.status(200).json({ success: true, user: result.rows[0] });
    } catch (error) {
        res.status(401).json({ success: false, error: 'Invalid token' });
    }
});

module.exports = router;