const express = require('express');
const router = express.Router();
const { login, register, getMe } = require('../controllers/authController');
const { authenticate } = require('../middlewares/auth');
const { validate, loginValidation, registerValidation } = require('../middlewares/validation');
const { authLimiter } = require('../middlewares/rateLimiter');

// Admin routes
router.post('/login', authLimiter, validate(loginValidation), login);
router.post('/register', validate(registerValidation), register); // For initial setup
router.get('/me', authenticate, getMe);

// Customer routes
const customerAuth = require('../controllers/customerAuthController');
const { requireCustomer } = require('../middlewares/auth');

// Password login/register (existing)
router.post('/customer/login', customerAuth.login);
router.post('/customer/register', customerAuth.register);

// OTP-based auth
router.post('/customer/send-otp', customerAuth.sendOtp);
router.post('/customer/verify-otp', customerAuth.verifyOtp);

router.get('/customer/me', requireCustomer, customerAuth.getMe);
router.put('/customer/me', requireCustomer, customerAuth.updateProfile);
router.patch('/customer/me', requireCustomer, customerAuth.updateProfile);
router.put('/customer/me/addresses', requireCustomer, customerAuth.updateAddresses);

module.exports = router;

