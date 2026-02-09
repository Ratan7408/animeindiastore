const express = require('express');
const router = express.Router();
const {
  getAllPayments,
  getPaymentStats,
  updateRefundStatus,
  createRazorpayOrder,
  verifyRazorpayPayment
} = require('../controllers/paymentController');
const { authenticate, isAdmin, authenticateCustomer } = require('../middlewares/auth');
const { adminLimiter } = require('../middlewares/rateLimiter');

// Admin routes
router.get('/', authenticate, isAdmin, adminLimiter, getAllPayments);
router.get('/stats', authenticate, isAdmin, adminLimiter, getPaymentStats);
router.put('/:id/refund', authenticate, isAdmin, adminLimiter, updateRefundStatus);

// Customer-facing Razorpay routes
router.post('/razorpay/create-order', authenticateCustomer, createRazorpayOrder);
router.post('/razorpay/verify', authenticateCustomer, verifyRazorpayPayment);

module.exports = router;

