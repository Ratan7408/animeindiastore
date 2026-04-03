const express = require('express');
const router = express.Router();
const {
  verify,
  webhook,
  createShipment,
  syncTracking,
  syncLastOrder,
  trackShipment,
  getAvailableCouriers
} = require('../controllers/shiprocketController');
const { authenticate, isAdmin } = require('../middlewares/auth');
const { adminLimiter } = require('../middlewares/rateLimiter');

// Shiprocket dashboard → Webhooks (no JWT; use SHIPROCKET_WEBHOOK_SECRET + X-Api-Key)
router.post('/webhook', webhook);

// Verify Shiprocket connection (admin)
router.get('/verify', authenticate, isAdmin, verify);

// All other Shiprocket routes require admin auth
router.post('/create-shipment/:orderId', authenticate, isAdmin, adminLimiter, createShipment);
router.post('/sync-tracking/:orderId', authenticate, isAdmin, adminLimiter, syncTracking);
router.post('/sync-last-order', authenticate, isAdmin, adminLimiter, syncLastOrder);
router.get('/couriers/:orderId', authenticate, isAdmin, adminLimiter, getAvailableCouriers);
router.get('/track/:awb', authenticate, isAdmin, trackShipment);

module.exports = router;
