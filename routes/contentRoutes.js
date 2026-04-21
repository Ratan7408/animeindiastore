const express = require('express');
const router = express.Router();
const {
  getAllContent,
  getContentByType,
  createOrUpdateContent,
  updateBanners,
  deleteContent,
  uploadContentImage
} = require('../controllers/contentController');
const { authenticate, isAdmin } = require('../middlewares/auth');
const { adminLimiter } = require('../middlewares/rateLimiter');
const { uploadSingle, handleUploadError } = require('../middlewares/upload');

router.get('/', authenticate, isAdmin, adminLimiter, getAllContent);
router.get('/:type', authenticate, isAdmin, adminLimiter, getContentByType);
router.post('/', authenticate, isAdmin, adminLimiter, createOrUpdateContent);
router.put('/:type', authenticate, isAdmin, adminLimiter, createOrUpdateContent);
router.put('/:type/banners', authenticate, isAdmin, adminLimiter, updateBanners);
router.post('/upload-image', authenticate, isAdmin, adminLimiter, uploadSingle, handleUploadError, uploadContentImage);
router.delete('/:type', authenticate, isAdmin, adminLimiter, deleteContent);

module.exports = router;

