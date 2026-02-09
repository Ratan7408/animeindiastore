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
  // #region agent log
  const fs = require('fs');
  const logPath = 'c:\\Users\\RATAN\\Desktop\\animeweb\\.cursor\\debug.log';
  const authHeader = req.header('Authorization');
  const logEntry = {
    location: 'auth.js:requireCustomer',
    message: 'requireCustomer middleware called',
    data: {
      hasAuthHeader: !!authHeader,
      authHeaderValue: authHeader ? authHeader.substring(0, 20) + '...' : null,
      method: req.method,
      path: req.path
    },
    timestamp: Date.now(),
    sessionId: 'debug-session',
    runId: 'run1',
    hypothesisId: 'A'
  };
  try {
    fs.appendFileSync(logPath, JSON.stringify(logEntry) + '\n');
  } catch (e) {}
  // #endregion
  
  try {
    // Try multiple ways to get the Authorization header
    const authHeader = req.header('Authorization') || req.headers.authorization || req.get('Authorization');
    const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
    
    // #region agent log
    const logEntry2 = {
      location: 'auth.js:requireCustomer',
      message: 'Token extracted',
      data: {
        hasToken: !!token,
        tokenLength: token?.length || 0,
        tokenPrefix: token ? token.substring(0, 20) + '...' : null
      },
      timestamp: Date.now(),
      sessionId: 'debug-session',
      runId: 'run1',
      hypothesisId: 'B'
    };
    try {
      fs.appendFileSync(logPath, JSON.stringify(logEntry2) + '\n');
    } catch (e) {}
    // #endregion
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Please login.'
      });
    }
    
    try {
      const jwtSecret = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production';
      const decoded = jwt.verify(token, jwtSecret);
      
      // #region agent log
      const logEntry3 = {
        location: 'auth.js:requireCustomer',
        message: 'Token decoded',
        data: {
          decodedId: decoded.id,
          decodedEmail: decoded.email || null
        },
        timestamp: Date.now(),
        sessionId: 'debug-session',
        runId: 'run1',
        hypothesisId: 'C'
      };
      try {
        fs.appendFileSync(logPath, JSON.stringify(logEntry3) + '\n');
      } catch (e) {}
      // #endregion
      
      const customer = await Customer.findById(decoded.id);
      
      // #region agent log
      const logEntry4 = {
        location: 'auth.js:requireCustomer',
        message: 'Customer lookup',
        data: {
          customerFound: !!customer,
          customerId: customer?._id?.toString() || null
        },
        timestamp: Date.now(),
        sessionId: 'debug-session',
        runId: 'run1',
        hypothesisId: 'D'
      };
      try {
        fs.appendFileSync(logPath, JSON.stringify(logEntry4) + '\n');
      } catch (e) {}
      // #endregion
      
      if (!customer) {
        return res.status(401).json({
          success: false,
          message: 'Invalid token. Customer not found.'
        });
      }
      
      req.customer = customer;
      next();
    } catch (error) {
      // #region agent log
      const logError = {
        location: 'auth.js:requireCustomer',
        message: 'Token verification failed',
        data: {
          errorMessage: error.message,
          errorName: error.name
        },
        timestamp: Date.now(),
        sessionId: 'debug-session',
        runId: 'run1',
        hypothesisId: 'E'
      };
      try {
        fs.appendFileSync(logPath, JSON.stringify(logError) + '\n');
      } catch (e) {}
      // #endregion
      
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

