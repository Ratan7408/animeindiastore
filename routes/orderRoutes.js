const express = require('express');
const router = express.Router();
const {
  createOrder,
  getMyOrders,
  getMyOrder,
  getOrderConfirmation,
  getAllOrders,
  getOrder,
  updateOrderStatus,
  markOrderAsPaid,
  deleteOrder,
  getOrderStats
} = require('../controllers/orderController');
const { createCustomerReview } = require('../controllers/reviewController');
const { uploadReviewImages, handleUploadError } = require('../middlewares/upload');
const { authenticate, isAdmin, authenticateCustomer, requireCustomer } = require('../middlewares/auth');
const { adminLimiter } = require('../middlewares/rateLimiter');

// Customer routes
router.post('/', authenticateCustomer, createOrder);
router.get('/confirmation/:id', getOrderConfirmation); // Public: for order confirmation page (guest + logged-in)
router.get('/my-orders', requireCustomer, getMyOrders);
router.get('/my-orders/:id', requireCustomer, getMyOrder);
router.post(
  '/reviews',
  requireCustomer,
  (req, res, next) => {
    uploadReviewImages(req, res, (err) => {
      if (err) return handleUploadError(err, req, res, next);
      next();
    });
  },
  createCustomerReview
);

// Admin routes
router.get('/', authenticate, isAdmin, adminLimiter, getAllOrders);
router.get('/stats', authenticate, isAdmin, adminLimiter, getOrderStats);
router.get('/:id', authenticate, isAdmin, adminLimiter, getOrder);
router.put('/:id/status', authenticate, isAdmin, adminLimiter, updateOrderStatus);
router.put('/:id/mark-paid', authenticate, isAdmin, adminLimiter, markOrderAsPaid);
router.delete('/:id', authenticate, isAdmin, adminLimiter, deleteOrder);

module.exports = router;

