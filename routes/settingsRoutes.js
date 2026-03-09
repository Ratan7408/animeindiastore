const express = require('express');
const router = express.Router();
const {
  getSettings,
  updateSettings,
  uploadHeroBanner,
  deleteHeroBanner
} = require('../controllers/settingsController');
const { authenticate, isAdmin } = require('../middlewares/auth');
const { adminLimiter } = require('../middlewares/rateLimiter');
const { uploadSingle, handleUploadError } = require('../middlewares/upload');

router.get('/', authenticate, isAdmin, adminLimiter, getSettings);
router.put('/', authenticate, isAdmin, adminLimiter, updateSettings);
router.post('/upload-hero-banner', authenticate, isAdmin, adminLimiter, uploadSingle, handleUploadError, uploadHeroBanner);
router.delete('/upload-hero-banner', authenticate, isAdmin, adminLimiter, deleteHeroBanner);

module.exports = router;

