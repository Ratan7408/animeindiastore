const express = require('express');
const router = express.Router();
const { syncCart } = require('../controllers/cartController');
const { requireCustomer } = require('../middlewares/auth');

router.post('/sync', requireCustomer, syncCart);

module.exports = router;
