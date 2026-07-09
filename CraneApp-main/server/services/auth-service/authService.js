const { query } = require('../../../database/database');
const logger = require('../logger');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

async function registerUser(username, password, firstName, lastName) {
    try {
        // Проверяем существует ли юзернейм
        const existing = await query(
            'SELECT id FROM users WHERE username = $1',
            [username.toLowerCase()]
        );

        if (existing.rows.length > 0) {
            throw new Error('Username already taken');
        }

        // Хешируем пароль
        const hashedPassword = await bcrypt.hash(password, 10);
        const userId = uuidv4();

        // Создаем пользователя
        const result = await query(
            `INSERT INTO users (id, username, password_hash, first_name, last_name, created_at, last_seen)
             VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
             RETURNING id, username, first_name, last_name, created_at`,
            [userId, username.toLowerCase(), hashedPassword, firstName, lastName || '']
        );

        const user = result.rows[0];

        // Генерируем JWT токен
        if (!process.env.JWT_SECRET) {
            throw new Error('JWT_SECRET is not configured');
        }
        const token = jwt.sign(
            { userId: user.id, username: user.username },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        return { 
            user: {
                id: user.id,
                username: user.username,
                firstName: user.first_name,
                lastName: user.last_name
            },
            token 
        };
    } catch (error) {
        logger.error('Register user service error:', error);
        throw error;
    }
}

async function loginUser(username, password) {
    try {
        // Ищем пользователя по юзернейму
        const result = await query(
            `SELECT * FROM users WHERE username = $1`,
            [username.toLowerCase()]
        );

        if (result.rows.length === 0) {
            throw new Error('User not found');
        }

        const user = result.rows[0];

        // Проверяем пароль
        const isValid = await bcrypt.compare(password, user.password_hash);
        
        if (!isValid) {
            throw new Error('Invalid password');
        }

        // Обновляем last_seen
        await query(
            'UPDATE users SET last_seen = NOW() WHERE id = $1',
            [user.id]
        );

        // Генерируем JWT токен
        if (!process.env.JWT_SECRET) {
            throw new Error('JWT_SECRET is not configured');
        }
        const token = jwt.sign(
            { userId: user.id, username: user.username },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        return { 
            user: {
                id: user.id,
                username: user.username,
                firstName: user.first_name,
                lastName: user.last_name
            },
            token 
        };
    } catch (error) {
        logger.error('Login user service error:', error);
        throw error;
    }
}

async function verifyToken(token) {
    try {
        if (!process.env.JWT_SECRET) {
            throw new Error('JWT_SECRET is not configured');
        }
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        const result = await query(
            'SELECT id, username, first_name, last_name FROM users WHERE id = $1',
            [decoded.userId ?? decoded.subject]
        );

        if (result.rows.length === 0) {
            throw new Error('User not found');
        }

        return result.rows[0];
    } catch (error) {
        logger.error('Verify token service error:', error);
        throw new Error('Invalid token');
    }
}

module.exports = {
    registerUser,
    loginUser,
    verifyToken
};