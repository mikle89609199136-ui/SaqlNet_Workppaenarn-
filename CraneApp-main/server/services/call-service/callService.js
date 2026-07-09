const { query } = require('../../../database/database');
const logger = require('../logger');
const { v4: uuidv4 } = require('uuid');

/**
 * Start a new call
 */
async function startCall(callerId, receiverId, type = 'voice') {
  try {
    const callId = uuidv4();
    
    await query(
      `INSERT INTO calls (id, caller_id, receiver_id, type, status, created_at)
       VALUES ($1, $2, $3, $4, 'initiated', NOW())`,
      [callId, callerId, receiverId, type]
    );

    return {
      callId,
      callerId,
      receiverId,
      type,
      status: 'initiated',
      createdAt: new Date()
    };
  } catch (error) {
    logger.error('Start call service error:', error);
    throw new Error('Failed to start call');
  }
}

/**
 * Accept a call
 */
async function acceptCall(callId, userId) {
  try {
    await query(
      `UPDATE calls 
       SET status = 'connected', started_at = NOW()
       WHERE id = $1 AND receiver_id = $2`,
      [callId, userId]
    );

    return true;
  } catch (error) {
    logger.error('Accept call service error:', error);
    throw new Error('Failed to accept call');
  }
}

/**
 * End a call
 */
async function endCall(callId, userId) {
  try {
    const result = await query(
      `UPDATE calls 
       SET status = 'ended', ended_at = NOW(),
           duration = EXTRACT(EPOCH FROM (NOW() - started_at))
       WHERE id = $1 AND (caller_id = $2 OR receiver_id = $2)
       RETURNING *`,
      [callId, userId]
    );

    return result.rows[0];
  } catch (error) {
    logger.error('End call service error:', error);
    throw new Error('Failed to end call');
  }
}

/**
 * Reject a call
 */
async function rejectCall(callId, userId) {
  try {
    await query(
      `UPDATE calls 
       SET status = 'rejected'
       WHERE id = $1 AND receiver_id = $2`,
      [callId, userId]
    );

    return true;
  } catch (error) {
    logger.error('Reject call service error:', error);
    throw new Error('Failed to reject call');
  }
}

/**
 * Get call history for user
 */
async function getCallHistory(userId, limit = 20, offset = 0) {
  try {
    const result = await query(
      `SELECT c.*, 
              u1.username as caller_username,
              u2.username as receiver_username
       FROM calls c
       JOIN users u1 ON c.caller_id = u1.id
       JOIN users u2 ON c.receiver_id = u2.id
       WHERE c.caller_id = $1 OR c.receiver_id = $1
       ORDER BY c.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    return result.rows;
  } catch (error) {
    logger.error('Get call history service error:', error);
    throw new Error('Failed to get call history');
  }
}

/**
 * Get call details
 */
async function getCallDetails(callId) {
  try {
    const result = await query(
      `SELECT c.*, 
              u1.username as caller_username,
              u2.username as receiver_username
       FROM calls c
       JOIN users u1 ON c.caller_id = u1.id
       JOIN users u2 ON c.receiver_id = u2.id
       WHERE c.id = $1`,
      [callId]
    );

    return result.rows[0];
  } catch (error) {
    logger.error('Get call details service error:', error);
    throw new Error('Failed to get call details');
  }
}

/**
 * Get active calls for user
 */
async function getActiveCalls(userId) {
  try {
    const result = await query(
      `SELECT * FROM calls 
       WHERE (caller_id = $1 OR receiver_id = $1) 
       AND status IN ('initiated', 'connected', 'ringing')`,
      [userId]
    );

    return result.rows;
  } catch (error) {
    logger.error('Get active calls service error:', error);
    throw new Error('Failed to get active calls');
  }
}

module.exports = {
  startCall,
  acceptCall,
  endCall,
  rejectCall,
  getCallHistory,
  getCallDetails,
  getActiveCalls
};