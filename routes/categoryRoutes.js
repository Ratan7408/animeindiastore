const express = require('express');
const router = express.Router();
const {
  getAllCategories,
  getCategoryBySlug,
  createCategory,
  updateCategory,
  deleteCategory
} = require('../controllers/categoryController');
const { authenticate, isAdmin, optionalAuth } = require('../middlewares/auth');
const { adminLimiter } = require('../middlewares/rateLimiter');

// Public routes (with optional auth to show all categories to admins)
router.get('/', optionalAuth, getAllCategories);
router.get('/slug/:slug', getCategoryBySlug);

// Admin routes
router.post('/', authenticate, isAdmin, adminLimiter, createCategory);
router.put('/:id', authenticate, isAdmin, adminLimiter, updateCategory);
router.delete('/:id', authenticate, isAdmin, adminLimiter, deleteCategory);

module.exports = router;

