const express = require('express');
const router = express.Router();
const {
  getAllCollections,
  getCollectionBySlug,
  createCollection,
  updateCollection,
  deleteCollection
} = require('../controllers/collectionController');
const { authenticate, isAdmin } = require('../middlewares/auth');
const { adminLimiter } = require('../middlewares/rateLimiter');

// Public routes
router.get('/', getAllCollections);
router.get('/slug/:slug', getCollectionBySlug);

// Admin routes
router.post('/', authenticate, isAdmin, adminLimiter, createCollection);
router.put('/:id', authenticate, isAdmin, adminLimiter, updateCollection);
router.delete('/:id', authenticate, isAdmin, adminLimiter, deleteCollection);

module.exports = router;

