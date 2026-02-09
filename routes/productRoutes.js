const express = require('express');
const router = express.Router();
const {
  getAllProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  bulkDeleteProducts,
  bulkUpdateStock,
  bulkUpdateSizeStock,
  getOutOfStockProducts,
  getCategoriesForYouSlots
} = require('../controllers/productController');
const { authenticate, isAdmin, optionalAuth } = require('../middlewares/auth');
const { uploadSingle, uploadMultiple, handleUploadError } = require('../middlewares/upload');
const { validate, productValidation } = require('../middlewares/validation');
const { apiLimiter, adminLimiter } = require('../middlewares/rateLimiter');

// Public routes (optionalAuth: admin token lets admin see inactive products)
router.get('/', apiLimiter, optionalAuth, getAllProducts);
router.get('/out-of-stock', authenticate, isAdmin, getOutOfStockProducts);
router.get('/categories-for-you-slots', authenticate, isAdmin, getCategoriesForYouSlots);
router.get('/slug/:slug', apiLimiter, getProduct); // Must be before /:id
router.get('/:id', apiLimiter, getProduct);

// Admin routes
router.post(
  '/',
  authenticate,
  isAdmin,
  adminLimiter,
  uploadMultiple,
  handleUploadError,
  validate(productValidation),
  createProduct
);

router.put(
  '/:id',
  authenticate,
  isAdmin,
  adminLimiter,
  uploadMultiple,
  handleUploadError,
  updateProduct
);

router.delete(
  '/:id',
  authenticate,
  isAdmin,
  adminLimiter,
  deleteProduct
);

// Bulk operations
router.post(
  '/bulk-delete',
  authenticate,
  isAdmin,
  adminLimiter,
  bulkDeleteProducts
);

router.post(
  '/bulk-stock-update',
  authenticate,
  isAdmin,
  adminLimiter,
  bulkUpdateStock
);

router.post(
  '/bulk-size-stock-update',
  authenticate,
  isAdmin,
  adminLimiter,
  bulkUpdateSizeStock
);

module.exports = router;

