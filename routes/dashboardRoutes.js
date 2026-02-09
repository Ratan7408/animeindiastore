const express = require('express');
const router = express.Router();
const {
  getDashboardStats,
  getRecentOrders,
  getLowStockAlerts,
  getChartData,
  exportDashboardExcel
} = require('../controllers/dashboardController');
const { authenticate, isAdmin } = require('../middlewares/auth');
const { adminLimiter } = require('../middlewares/rateLimiter');

router.get('/stats', authenticate, isAdmin, adminLimiter, getDashboardStats);
router.get('/charts', authenticate, isAdmin, adminLimiter, getChartData);
router.get('/recent-orders', authenticate, isAdmin, adminLimiter, getRecentOrders);
router.get('/low-stock', authenticate, isAdmin, adminLimiter, getLowStockAlerts);
router.get('/export-excel', authenticate, isAdmin, adminLimiter, exportDashboardExcel);

module.exports = router;

