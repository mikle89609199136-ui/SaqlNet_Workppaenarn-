const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const callController = require('./callController');

const startCallValidation = [
  body('userId').notEmpty().withMessage('User ID is required').isUUID().withMessage('Invalid user ID'),
  body('type').notEmpty().withMessage('Call type is required').isIn(['voice', 'video']).withMessage('Invalid call type')
];

const endCallValidation = [
  body('callId').notEmpty().withMessage('Call ID is required').isUUID().withMessage('Invalid call ID')
];

router.post('/start', startCallValidation, callController.startCall);
router.post('/accept', callController.acceptCall);
router.post('/end', endCallValidation, callController.endCall);
router.post('/reject', callController.rejectCall);
router.get('/history', callController.getCallHistory);
router.get('/:callId', param('callId').isUUID().withMessage('Invalid call ID'), callController.getCallDetails);

// ✅ ВАЖНО: Экспортируем router, НЕ объект!
module.exports = router;