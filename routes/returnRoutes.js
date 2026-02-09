const express = require('express');
const router = express.Router();
const {
  createReturn,
  getMyReturns,
  getAllReturns,
  getReturn,
  approveReturn,
  rejectReturn,
  updateRefundStatus
} = require('../controllers/returnController');
const { authenticate, isAdmin, requireCustomer } = require('../middlewares/auth');
const { adminLimiter } = require('../middlewares/rateLimiter');

// Customer routes (must be before /:id)
router.get('/my-returns', requireCustomer, getMyReturns);
router.post('/', requireCustomer, createReturn);

// Admin routes
router.get('/', authenticate, isAdmin, adminLimiter, getAllReturns);
router.get('/:id', authenticate, isAdmin, adminLimiter, getReturn);
router.put('/:id/approve', authenticate, isAdmin, adminLimiter, approveReturn);
router.put('/:id/reject', authenticate, isAdmin, adminLimiter, rejectReturn);
router.put('/:id/refund', authenticate, isAdmin, adminLimiter, updateRefundStatus);

module.exports = router;

