const express = require('express');
const router = express.Router();
const {
  createOrder,
  getMyOrders,
  getMyOrder,
  getAllOrders,
  getOrder,
  updateOrderStatus,
  markOrderAsPaid,
  getOrderStats
} = require('../controllers/orderController');
const { authenticate, isAdmin, authenticateCustomer, requireCustomer } = require('../middlewares/auth');
const { adminLimiter } = require('../middlewares/rateLimiter');

// Customer routes
router.post('/', authenticateCustomer, createOrder);
router.get('/my-orders', requireCustomer, getMyOrders);
router.get('/my-orders/:id', requireCustomer, getMyOrder);

// Admin routes
router.get('/', authenticate, isAdmin, adminLimiter, getAllOrders);
router.get('/stats', authenticate, isAdmin, adminLimiter, getOrderStats);
router.get('/:id', authenticate, isAdmin, adminLimiter, getOrder);
router.put('/:id/status', authenticate, isAdmin, adminLimiter, updateOrderStatus);
router.put('/:id/mark-paid', authenticate, isAdmin, adminLimiter, markOrderAsPaid);

module.exports = router;

