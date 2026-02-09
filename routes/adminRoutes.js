const express = require('express');
const router = express.Router();
const { authenticate, isAdmin } = require('../middlewares/auth');

// Placeholder for future admin-specific routes
router.get('/test', authenticate, isAdmin, (req, res) => {
  res.json({
    success: true,
    message: 'Admin route is working',
    admin: req.admin
  });
});

module.exports = router;

