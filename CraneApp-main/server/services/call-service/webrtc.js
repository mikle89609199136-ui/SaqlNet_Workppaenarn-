const logger = require('../logger');

/**
 * WebRTC Configuration
 */
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

/**
 * Generate WebRTC offer
 */
function generateOffer() {
  return {
    type: 'offer',
    sdp: '',
    timestamp: new Date().toISOString()
  };
}

/**
 * Generate WebRTC answer
 */
function generateAnswer() {
  return {
    type: 'answer',
    sdp: '',
    timestamp: new Date().toISOString()
  };
}

/**
 * Generate ICE candidate
 */
function generateIceCandidate(candidate) {
  return {
    candidate,
    timestamp: new Date().toISOString()
  };
}

/**
 * Validate WebRTC session
 */
function validateSession(session) {
  if (!session || !session.type) {
    return false;
  }
  return ['offer', 'answer', 'candidate'].includes(session.type);
}

/**
 * Handle WebRTC signaling
 */
function handleSignaling(userId, data, ws) {
  try {
    const { type, payload } = data;

    if (!validateSession(payload)) {
      throw new Error('Invalid WebRTC session');
    }

    logger.info(`WebRTC signaling from ${userId}: ${type}`);

    return {
      success: true,
      data: payload
    };
  } catch (error) {
    logger.error('WebRTC signaling error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  rtcConfig,
  generateOffer,
  generateAnswer,
  generateIceCandidate,
  validateSession,
  handleSignaling
};