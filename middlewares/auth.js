const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const Customer = require('../models/Customer');

// Verify JWT token
exports.authenticate = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production');
    
    const admin = await Admin.findById(decoded.id).select('-password');
    
    if (!admin) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token. Admin not found.'
      });
    }

    req.admin = admin;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token.'
      });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired.'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Authentication error.',
      error: error.message
    });
  }
};

// Optional authentication - sets req.admin if token is valid, but doesn't fail if no token
exports.optionalAuth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production');
        const admin = await Admin.findById(decoded.id).select('-password');
        if (admin) {
          req.admin = admin;
        }
      } catch (error) {
        // Token invalid or expired, but that's okay for optional auth
        // Just continue without setting req.admin
      }
    }
    
    next();
  } catch (error) {
    // If anything fails, just continue without req.admin
    next();
  }
};

// Check if user is admin (ADMIN or SUPER_ADMIN)
exports.isAdmin = (req, res, next) => {
  if (req.admin && (req.admin.role === 'ADMIN' || req.admin.role === 'SUPER_ADMIN' || req.admin.role === 'STAFF')) {
    return next();
  }
  return res.status(403).json({
    success: false,
    message: 'Access denied. Admin privileges required.'
  });
};

// Check if user is super admin only
exports.isSuperAdmin = (req, res, next) => {
  if (req.admin && req.admin.role === 'SUPER_ADMIN') {
    return next();
  }
  return res.status(403).json({
    success: false,
    message: 'Access denied. Super admin privileges required.'
  });
};

// Role-based access control
exports.authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.admin) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. Authentication required.'
      });
    }
    
    if (!roles.includes(req.admin.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required role: ${roles.join(' or ')}.`
      });
    }
    
    next();
  };
};

// Customer authentication (optional - allows guest orders)
exports.authenticateCustomer = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production');
        const customer = await Customer.findById(decoded.id);
        if (customer) {
          req.customer = customer;
        }
      } catch (error) {
        // Token invalid, but allow guest orders
      }
    }
    
    // Always continue - allow both authenticated and guest orders
    next();
  } catch (error) {
    // If anything fails, just continue (guest order)
    next();
  }
};

// Customer authentication (required - no guest access)
exports.requireCustomer = async (req, res, next) => {
  try {
    // Try multiple ways to get the Authorization header
    const authHeader = req.header('Authorization') || req.headers.authorization || req.get('Authorization');
    const token = authHeader?.replace(/^Bearer\s+/i, '').trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Please login.'
      });
    }
    
    try {
      const jwtSecret = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production';
      const decoded = jwt.verify(token, jwtSecret);
      const customer = await Customer.findById(decoded.id);

      if (!customer) {
        return res.status(401).json({
          success: false,
          message: 'Invalid token. Customer not found.'
        });
      }
      
      req.customer = customer;
      next();
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token. Please login again.'
      });
    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Authentication error',
      error: error.message
    });
  }
};

