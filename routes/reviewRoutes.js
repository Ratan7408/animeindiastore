const express = require('express');
const router = express.Router();
const {
  getAllReviews,
  approveReview,
  toggleHideReview,
  addAdminResponse,
  deleteReview
} = require('../controllers/reviewController');
const { authenticate, isAdmin } = require('../middlewares/auth');
const { adminLimiter } = require('../middlewares/rateLimiter');

router.get('/', authenticate, isAdmin, adminLimiter, getAllReviews);
router.put('/:id/approve', authenticate, isAdmin, adminLimiter, approveReview);
router.put('/:id/hide', authenticate, isAdmin, adminLimiter, toggleHideReview);
router.put('/:id/response', authenticate, isAdmin, adminLimiter, addAdminResponse);
router.delete('/:id', authenticate, isAdmin, adminLimiter, deleteReview);

module.exports = router;

