const jwt = require('jsonwebtoken');
const logger = require('../services/logger');
const i18n = require('../i18n');

/**
 * Authentication Middleware
 * Validates JWT tokens for protected routes
 */
const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: i18n.t(i18n.languageFromHeaders(req), 'accessDenied'),
        message: i18n.t(i18n.languageFromHeaders(req), 'noToken')
      });
    }

    const token = authHeader.split(' ')[1];
    if (!process.env.JWT_SECRET) {
      logger.error('JWT_SECRET is not configured');
      return res.status(500).json({
        error: i18n.t(i18n.languageFromHeaders(req), 'serverConfigError'),
        message: i18n.t(i18n.languageFromHeaders(req), 'authSystemConfigError')
      });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = {
      userId: decoded.userId ?? decoded.subject,
      phone: decoded.phone,
      username: decoded.username ?? decoded.username
    };

    req.headers['x-user-id'] = decoded.userId ?? decoded.subject;

    next();
  } catch (error) {
    logger.error('Auth middleware error:', error);

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: i18n.t(i18n.languageFromHeaders(req), 'tokenExpired'),
        message: i18n.t(i18n.languageFromHeaders(req), 'loginAgain')
      });
    }

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        error: i18n.t(i18n.languageFromHeaders(req), 'invalidToken'),
        message: i18n.t(i18n.languageFromHeaders(req), 'invalidToken')
      });
    }

    return res.status(500).json({
      error: i18n.t(i18n.languageFromHeaders(req), 'authenticationError'),
      message: i18n.t(i18n.languageFromHeaders(req), 'internalServerError')
    });
  }
};

/**
 * Optional Auth Middleware
 */
const optionalAuthMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      if (!process.env.JWT_SECRET) {
        logger.error('JWT_SECRET is not configured');
        return next();
      }
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      req.user = {
        userId: decoded.userId ?? decoded.subject,
        phone: decoded.phone,
        username: decoded.username
      };
      req.headers['x-user-id'] = decoded.userId ?? decoded.subject;
    }

    next();
  } catch (error) {
    next();
  }
};

// ✅ ВАЖНО: Экспортируем функцию напрямую, НЕ объект!
module.exports = authMiddleware;
module.exports.optionalAuthMiddleware = optionalAuthMiddleware;
