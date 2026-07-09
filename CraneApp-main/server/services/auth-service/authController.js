const authService = require('./authService');
const logger = require('../logger');

/**
 * Send verification code
 */
const sendCode = async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required'
      });
    }

    await authService.sendVerificationCode(phone);

    res.status(200).json({
      success: true,
      message: 'Verification code sent',
      expiresInSeconds: 300
    });
  } catch (error) {
    logger.error('Send code controller error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send code',
      message: error.message
    });
  }
};

/**
 * Verify code and login/register
 */
const verifyCode = async (req, res) => {
  try {
    const { phone, code } = req.body;

    if (!phone || !code) {
      return res.status(400).json({
        success: false,
        error: 'Phone and code are required'
      });
    }

    const result = await authService.verifyCode(phone, code);

    res.status(200).json({
      success: true,
      token: result.token,
      userId: result.userId,
      isNewUser: result.isNewUser
    });
  } catch (error) {
    logger.error('Verify code controller error:', error);
    res.status(400).json({
      success: false,
      error: 'Verification failed',
      message: error.message
    });
  }
};

/**
 * Register user profile
 */
const register = async (req, res) => {
  try {
    const { firstName, lastName, username } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized'
      });
    }

    if (!firstName) {
      return res.status(400).json({
        success: false,
        error: 'First name is required'
      });
    }

    await authService.registerUser(userId, firstName, lastName, username);

    res.status(200).json({
      success: true,
      message: 'Profile created successfully'
    });
  } catch (error) {
    logger.error('Register controller error:', error);
    res.status(400).json({
      success: false,
      error: 'Registration failed',
      message: error.message
    });
  }
};

/**
 * Logout user
 */
const logout = async (req, res) => {
  try {
    const userId = req.user?.userId;
    const token = req.headers.authorization?.split(' ')[1];

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized'
      });
    }

    await authService.logoutUser(userId, token);

    res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    logger.error('Logout controller error:', error);
    res.status(500).json({
      success: false,
      error: 'Logout failed',
      message: error.message
    });
  }
};

/**
 * Resend verification code
 */
const resendCode = async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required'
      });
    }

    await authService.sendVerificationCode(phone);

    res.status(200).json({
      success: true,
      message: 'Code resent successfully'
    });
  } catch (error) {
    logger.error('Resend code controller error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to resend code',
      message: error.message
    });
  }
};

module.exports = {
  sendCode,
  verifyCode,
  register,
  logout,
  resendCode
};