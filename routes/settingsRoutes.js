const express = require('express');
const router = express.Router();
const {
  getSettings,
  updateSettings
} = require('../controllers/settingsController');
const { authenticate, isAdmin } = require('../middlewares/auth');
const { adminLimiter } = require('../middlewares/rateLimiter');

router.get('/', authenticate, isAdmin, adminLimiter, getSettings);
router.put('/', authenticate, isAdmin, adminLimiter, updateSettings);

module.exports = router;

