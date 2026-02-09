const Customer = require('../models/Customer');
const jwt = require('jsonwebtoken');
const { sendMail } = require('../utils/emailService');
const OtpToken = require('../models/OtpToken');

// Generate JWT Token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production', {
    expiresIn: process.env.JWT_EXPIRE || '7d'
  });
};

// @desc    Customer login
// @route   POST /api/auth/customer/login
// @access  Public
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    // Normalize email (lowercase and trim)
    const normalizedEmail = email.toLowerCase().trim();

    // Check if customer exists
    const customer = await Customer.findOne({ email: normalizedEmail }).select('+password');
    
    if (!customer) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Check if customer has a password (some customers might be guest accounts)
    if (!customer.password) {
      return res.status(401).json({
        success: false,
        message: 'Please set a password for your account or register a new account'
      });
    }

    // Verify password
    const isPasswordValid = await customer.comparePassword(password);
    
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Generate token
    const token = generateToken(customer._id);

    res.json({
      success: true,
      message: 'Login successful',
      token,
      data: {
        id: customer._id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone
      }
    });
  } catch (error) {
    console.error('Customer login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login error',
      error: error.message
    });
  }
};

// @desc    Send login/register OTP to email
// @route   POST /api/auth/customer/send-otp
// @access  Public
exports.sendOtp = async (req, res) => {
  try {
    const { email } = req.body || {};

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Simple rate limiting per email: max 5 active OTPs
    const activeCount = await OtpToken.countDocuments({
      identifier: normalizedEmail,
      purpose: 'LOGIN',
      expiresAt: { $gt: new Date() }
    });
    if (activeCount >= 5) {
      return res.status(429).json({
        success: false,
        message: 'Too many OTP requests. Please try again later.'
      });
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await OtpToken.create({
      identifier: normalizedEmail,
      code,
      purpose: 'LOGIN',
      expiresAt
    });

    // Respond immediately; send email in background so API feels instant
    res.json({
      success: true,
      message: 'OTP sent successfully'
    });

    sendMail({
      to: normalizedEmail,
      subject: 'Your Anime India login code',
      text: `Your one-time password (OTP) is ${code}. It is valid for 10 minutes.\n\nIf you did not request this, you can ignore this email.`,
      html: `<p>Your one-time password (OTP) is <strong>${code}</strong>.</p>
             <p>It is valid for <strong>10 minutes</strong>.</p>
             <p>If you did not request this, you can safely ignore this email.</p>`
    }).catch((e) => console.warn('Error sending OTP email:', e.message));
  } catch (error) {
    console.error('Send OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Error sending OTP'
    });
  }
};

// @desc    Verify OTP and login/register customer
// @route   POST /api/auth/customer/verify-otp
// @access  Public
exports.verifyOtp = async (req, res) => {
  try {
    const { email, otp, name, phone } = req.body || {};

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Email and OTP are required'
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const token = await OtpToken.findOne({
      identifier: normalizedEmail,
      code: otp,
      purpose: 'LOGIN',
      expiresAt: { $gt: new Date() }
    });

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP'
      });
    }

    // Consume OTP
    await OtpToken.deleteMany({ identifier: normalizedEmail, purpose: 'LOGIN' });

    // Find or create customer
    let customer = await Customer.findOne({ email: normalizedEmail });

    if (!customer) {
      if (!name || !phone) {
        return res.status(400).json({
          success: false,
          message: 'Name and phone are required to create a new account'
        });
      }

      customer = await Customer.create({
        name,
        email: normalizedEmail,
        phone: phone.trim(),
        emailVerified: true
      });
    } else {
      // Optionally update missing fields
      let changed = false;
      if (!customer.phone && phone) {
        customer.phone = phone.trim();
        changed = true;
      }
      if (!customer.name && name) {
        customer.name = name;
        changed = true;
      }
      if (!customer.emailVerified) {
        customer.emailVerified = true;
        changed = true;
      }
      if (changed) {
        await customer.save();
      }
    }

    const jwtToken = generateToken(customer._id);

    res.json({
      success: true,
      message: 'Login successful',
      token: jwtToken,
      data: {
        id: customer._id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone
      }
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Error verifying OTP'
    });
  }
};

// @desc    Customer register
// @route   POST /api/auth/customer/register
// @access  Public
exports.register = async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, and password are required'
      });
    }

    // Normalize email
    const normalizedEmail = email.toLowerCase().trim();

    // Check if customer already exists
    const existingCustomer = await Customer.findOne({ email: normalizedEmail });
    
    if (existingCustomer) {
      // If customer exists but has no password, update it
      if (!existingCustomer.password) {
        existingCustomer.password = password;
        existingCustomer.name = name;
        if (phone) existingCustomer.phone = phone;
        await existingCustomer.save();

        const token = generateToken(existingCustomer._id);
        return res.status(200).json({
          success: true,
          message: 'Account created successfully',
          token,
          data: {
            id: existingCustomer._id,
            name: existingCustomer.name,
            email: existingCustomer.email,
            phone: existingCustomer.phone
          }
        });
      }

      return res.status(400).json({
        success: false,
        message: 'Customer with this email already exists. Please login instead.'
      });
    }

    // Create new customer
    const customer = await Customer.create({
      name,
      email: normalizedEmail,
      password,
      phone: phone || ''
    });

    // Generate token
    const token = generateToken(customer._id);

    // Fire-and-forget welcome email
    try {
      await sendMail({
        to: customer.email,
        subject: 'Welcome to Anime India Store',
        text: `Hi ${customer.name || ''},\n\nThank you for creating an account at Anime India Store.\n\nYou can now sign in any time to track orders, manage addresses, and view your wishlist.\n\nThanks,\nAnime India Team`,
        html: `<p>Hi ${customer.name || ''},</p>
               <p>Thank you for creating an account at <strong>Anime India Store</strong>.</p>
               <p>You can now sign in any time to track orders, manage addresses, and view your wishlist.</p>
               <p>Thanks,<br>Anime India Team</p>`
      });
    } catch (e) {
      console.warn('Welcome email failed:', e.message);
    }

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      token,
      data: {
        id: customer._id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone
      }
    });
  } catch (error) {
    console.error('Customer registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration error',
      error: error.message
    });
  }
};

// @desc    Get current customer (verify token)
// @route   GET /api/auth/customer/me
// @access  Private/Customer
exports.getMe = async (req, res) => {
  try {
    const customer = await Customer.findById(req.customer._id).select('-password');
    
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }
    
    res.json({
      success: true,
      data: customer
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching customer data',
      error: error.message
    });
  }
};

// @desc    Update current customer profile (name, phone, dateOfBirth, gender; email cannot be changed)
// @route   PUT /api/auth/customer/me
// @access  Private/Customer
exports.updateProfile = async (req, res) => {
  try {
    const { name, phone, dateOfBirth, gender } = req.body;
    const customer = await Customer.findById(req.customer._id);

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    if (name !== undefined && name !== null) customer.name = String(name).trim();
    if (phone !== undefined && phone !== null) customer.phone = String(phone).trim();
    if (dateOfBirth !== undefined && dateOfBirth !== null && dateOfBirth !== '') {
      customer.dateOfBirth = new Date(dateOfBirth);
    } else if (dateOfBirth === '' || dateOfBirth === null) {
      customer.dateOfBirth = null;
    }
    if (gender !== undefined && (gender === 'MALE' || gender === 'FEMALE' || gender === 'OTHER')) {
      customer.gender = gender;
    } else if (gender === '' || gender === null) {
      customer.gender = null;
    }

    await customer.save();

    const updated = await Customer.findById(customer._id).select('-password');
    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: updated
    });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error updating profile',
      error: error.message
    });
  }
};

// @desc    Update current customer addresses (replace full list)
// @route   PUT /api/auth/customer/me/addresses
// @access  Private/Customer
exports.updateAddresses = async (req, res) => {
  try {
    let { addresses } = req.body;
    const customer = await Customer.findById(req.customer._id);

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    if (typeof addresses === 'string') {
      try {
        addresses = JSON.parse(addresses);
      } catch (e) {
        return res.status(400).json({
          success: false,
          message: 'addresses must be a valid JSON array'
        });
      }
    }

    if (!Array.isArray(addresses)) {
      return res.status(400).json({
        success: false,
        message: 'addresses must be an array'
      });
    }

    const normalized = [];
    for (let i = 0; i < addresses.length; i++) {
      const a = addresses[i];
      if (!a || typeof a !== 'object' || Array.isArray(a)) continue;
      normalized.push({
        name: a.name != null ? String(a.name).trim() : '',
        phone: a.phone != null ? String(a.phone).trim() : '',
        address: a.address != null ? String(a.address).trim() : '',
        city: a.city != null ? String(a.city).trim() : '',
        state: a.state != null ? String(a.state).trim() : '',
        pincode: a.pincode != null ? String(a.pincode).trim() : '',
        country: a.country != null ? String(a.country).trim() : '',
        landmark: a.landmark != null ? String(a.landmark).trim() : '',
        type: a.type != null ? String(a.type).trim() : 'HOME',
        isDefault: Boolean(a.isDefault)
      });
    }

    customer.addresses.splice(0, customer.addresses.length);
    normalized.forEach((item) => customer.addresses.push(item));
    await customer.save();

    const updated = await Customer.findById(customer._id).select('-password');
    res.json({
      success: true,
      message: 'Addresses updated successfully',
      data: updated
    });
  } catch (error) {
    console.error('Update addresses error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error updating addresses',
      error: error.message
    });
  }
};

