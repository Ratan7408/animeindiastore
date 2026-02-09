const express = require('express');
const router = express.Router();
const {
  getAllCustomers,
  getCustomer,
  toggleBlockCustomer,
  getCustomerOrders,
  exportCustomers
} = require('../controllers/customerController');
const { authenticate, isAdmin } = require('../middlewares/auth');
const { adminLimiter } = require('../middlewares/rateLimiter');

router.get('/', authenticate, isAdmin, adminLimiter, getAllCustomers);
router.get('/export', authenticate, isAdmin, adminLimiter, exportCustomers);
router.get('/:id', authenticate, isAdmin, adminLimiter, getCustomer);
router.get('/:id/orders', authenticate, isAdmin, adminLimiter, getCustomerOrders);
router.put('/:id/block', authenticate, isAdmin, adminLimiter, toggleBlockCustomer);

module.exports = router;

