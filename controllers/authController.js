const Admin = require('../models/Admin');
const jwt = require('jsonwebtoken');

// Generate JWT Token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production', {
    expiresIn: process.env.JWT_EXPIRE || '7d'
  });
};

// @desc    Admin login
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Normalize email (lowercase and trim)
    const normalizedEmail = email?.toLowerCase().trim();

    console.log('🔐 Login attempt:', { email: normalizedEmail, passwordLength: password?.length });

    // Check if admin exists
    const admin = await Admin.findOne({ email: normalizedEmail }).select('+password');
    
    if (!admin) {
      console.log('❌ Admin not found for email:', email);
      // Check if any admin exists
      const adminCount = await Admin.countDocuments();
      console.log('📊 Total admins in database:', adminCount);
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    console.log('✅ Admin found:', { id: admin._id, email: admin.email, hasPassword: !!admin.password });

    // Verify password
    const isPasswordValid = await admin.comparePassword(password);
    
    console.log('🔑 Password validation result:', isPasswordValid);
    
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Update last login
    admin.lastLogin = Date.now();
    await admin.save();

    // Generate token
    const token = generateToken(admin._id);

    res.json({
      success: true,
      message: 'Login successful',
      token,
      admin: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Login error',
      error: error.message
    });
  }
};

// @desc    Get current admin (verify token)
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res) => {
  try {
    const admin = await Admin.findById(req.admin._id).select('-password');
    
    res.json({
      success: true,
      data: admin
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching admin data',
      error: error.message
    });
  }
};

// @desc    Register new admin (for initial setup)
// @route   POST /api/auth/register
// @access  Public (should be restricted in production)
exports.register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Check if admin already exists
    const existingAdmin = await Admin.findOne({ email });
    
    if (existingAdmin) {
      return res.status(400).json({
        success: false,
        message: 'Admin with this email already exists'
      });
    }

    // Create admin
    const admin = await Admin.create({
      name,
      email,
      password,
      role: 'ADMIN'
    });

    // Generate token
    const token = generateToken(admin._id);

    res.status(201).json({
      success: true,
      message: 'Admin registered successfully',
      token,
      admin: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Registration error',
      error: error.message
    });
  }
};

