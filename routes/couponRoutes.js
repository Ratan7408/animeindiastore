const express = require('express');
const router = express.Router();
const {
  getAllCoupons,
  createCoupon,
  updateCoupon,
  deleteCoupon,
  getActiveCoupons,
  validateCoupon
} = require('../controllers/couponController');
const { authenticate, isAdmin } = require('../middlewares/auth');
const { adminLimiter } = require('../middlewares/rateLimiter');
const { validate } = require('../middlewares/validation');

// Public routes
router.get('/active', getActiveCoupons);
router.post('/validate', validateCoupon);

// Admin routes
router.get('/', authenticate, isAdmin, adminLimiter, getAllCoupons);
router.post('/', authenticate, isAdmin, adminLimiter, createCoupon);
router.put('/:id', authenticate, isAdmin, adminLimiter, updateCoupon);
router.delete('/:id', authenticate, isAdmin, adminLimiter, deleteCoupon);

module.exports = router;
