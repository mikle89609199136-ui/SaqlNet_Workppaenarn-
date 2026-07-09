const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const uploadController = require('./uploadController');
const upload = require('../../../middleware/upload');

const validate = (req, res, next) => {
  const { validationResult } = require('express-validator');
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array()
    });
  }
  next();
};

router.post('/upload', upload.single('file'), uploadController.uploadMedia);
router.post('/upload-multiple', upload.array('files', 10), uploadController.uploadMultipleMedia);
router.get('/:mediaId', param('mediaId').isUUID().withMessage('Invalid media ID'), uploadController.getMedia);
router.delete('/:mediaId', uploadController.deleteMedia);
router.get('/chat/:chatId', uploadController.getChatMedia);

// ✅ ВАЖНО: Экспортируем router, НЕ объект!
module.exports = router;