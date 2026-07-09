const callService = require('./callService');
const logger = require('../logger');

/**
 * Start a call
 */
const startCall = async (req, res) => {
  try {
    const callerId = req.user.userId;
    const { userId, type } = req.body;

    const call = await callService.startCall(callerId, userId, type);

    res.status(200).json({
      success: true,
      call
    });
  } catch (error) {
    logger.error('Start call controller error:', error);
    res.status(400).json({
      success: false,
      error: 'Failed to start call',
      message: error.message
    });
  }
};

/**
 * Accept a call
 */
const acceptCall = async (req, res) => {
  try {
    const { callId } = req.body;
    const userId = req.user.userId;

    await callService.acceptCall(callId, userId);

    res.status(200).json({
      success: true,
      message: 'Call accepted'
    });
  } catch (error) {
    logger.error('Accept call controller error:', error);
    res.status(400).json({
      success: false,
      error: 'Failed to accept call',
      message: error.message
    });
  }
};

/**
 * End a call
 */
const endCall = async (req, res) => {
  try {
    const { callId } = req.body;
    const userId = req.user.userId;

    await callService.endCall(callId, userId);

    res.status(200).json({
      success: true,
      message: 'Call ended'
    });
  } catch (error) {
    logger.error('End call controller error:', error);
    res.status(400).json({
      success: false,
      error: 'Failed to end call',
      message: error.message
    });
  }
};

/**
 * Reject a call
 */
const rejectCall = async (req, res) => {
  try {
    const { callId } = req.body;
    const userId = req.user.userId;

    await callService.rejectCall(callId, userId);

    res.status(200).json({
      success: true,
      message: 'Call rejected'
    });
  } catch (error) {
    logger.error('Reject call controller error:', error);
    res.status(400).json({
      success: false,
      error: 'Failed to reject call',
      message: error.message
    });
  }
};

/**
 * Get call history
 */
const getCallHistory = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { limit = 20, offset = 0 } = req.query;

    const calls = await callService.getCallHistory(userId, parseInt(limit), parseInt(offset));

    res.status(200).json({
      success: true,
      calls
    });
  } catch (error) {
    logger.error('Get call history controller error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get call history',
      message: error.message
    });
  }
};

/**
 * Get call details
 */
const getCallDetails = async (req, res) => {
  try {
    const { callId } = req.params;

    const call = await callService.getCallDetails(callId);

    if (!call) {
      return res.status(404).json({
        success: false,
        error: 'Call not found'
      });
    }

    res.status(200).json({
      success: true,
      call
    });
  } catch (error) {
    logger.error('Get call details controller error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get call details',
      message: error.message
    });
  }
};

module.exports = {
  startCall,
  acceptCall,
  endCall,
  rejectCall,
  getCallHistory,
  getCallDetails
};