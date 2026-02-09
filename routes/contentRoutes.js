const express = require('express');
const router = express.Router();
const {
  getAllContent,
  getContentByType,
  createOrUpdateContent,
  updateBanners,
  deleteContent
} = require('../controllers/contentController');
const { authenticate, isAdmin } = require('../middlewares/auth');
const { adminLimiter } = require('../middlewares/rateLimiter');

router.get('/', authenticate, isAdmin, adminLimiter, getAllContent);
router.get('/:type', authenticate, isAdmin, adminLimiter, getContentByType);
router.post('/', authenticate, isAdmin, adminLimiter, createOrUpdateContent);
router.put('/:type', authenticate, isAdmin, adminLimiter, createOrUpdateContent);
router.put('/:type/banners', authenticate, isAdmin, adminLimiter, updateBanners);
router.delete('/:type', authenticate, isAdmin, adminLimiter, deleteContent);

module.exports = router;

