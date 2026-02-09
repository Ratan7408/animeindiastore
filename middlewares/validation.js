const { body, validationResult } = require('express-validator');

// Validation middleware
exports.validate = (validations) => {
  return async (req, res, next) => {
    try {
      await Promise.all(validations.map(validation => validation.run(req)));
      
      const errors = validationResult(req);
      if (errors.isEmpty()) {
        return next();
      }
      
      const errorList = errors.array();
      console.error('❌ Product validation failed:', JSON.stringify(errorList, null, 2));
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errorList
      });
    } catch (error) {
      console.error('❌ Validation middleware error:', error);
      return res.status(500).json({
        success: false,
        message: 'Validation error',
        error: error.message
      });
    }
  };
};

// Product validation rules
exports.productValidation = [
  body('name')
    .trim()
    .notEmpty().withMessage('Product name is required')
    .isLength({ max: 200 }).withMessage('Product name cannot exceed 200 characters'),
  body('price')
    .isFloat({ min: 0 }).withMessage('Price must be a positive number'),
  body('discount')
    .optional()
    .isFloat({ min: 0, max: 100 }).withMessage('Discount must be between 0 and 100'),
  // Category is now optional - can use legacy category OR new animeSeries/productTypes
  body('category')
    .optional()
    .trim(),
  body('animeSeries')
    .optional()
    .customSanitizer((value) => {
      // Try to parse if it's a string
      if (typeof value === 'string' && value.trim().length > 0) {
        try {
          return JSON.parse(value);
        } catch (e) {
          return value;
        }
      }
      return value;
    })
    .custom((value) => {
      // If provided, should be a valid array
      if (value) {
        if (!Array.isArray(value)) {
          return false;
        }
        // Validate enum values
        const validSeries = ['Attack on Titan', 'Jujutsu Kaisen', 'One Piece', 'Naruto', 'Demon Slayer', 'Berserk'];
        return value.every(series => validSeries.includes(series));
      }
      return true;
    })
    .withMessage('animeSeries must be a valid array of anime series'),
  body('productTypes')
    .optional()
    .customSanitizer((value) => {
      // Try to parse if it's a string
      if (typeof value === 'string' && value.trim().length > 0) {
        try {
          return JSON.parse(value);
        } catch (e) {
          return value;
        }
      }
      return value;
    })
    .custom((value) => {
      // If provided, should be a valid array
      if (value) {
        if (!Array.isArray(value)) {
          return false;
        }
        // Validate enum values
        const validTypes = ['Regular Tshirt', 'Oversized', 'long sleeves', 'Hoodies', 'Action Figures', 'Posters', 'Wigs'];
        return value.every(type => validTypes.includes(type));
      }
      return true;
    })
    .withMessage('productTypes must be a valid array of product types'),
  // Custom validation: require either category OR productTypes (animeSeries is optional)
  body().custom((value, { req }) => {
    try {
      const hasCategory = req.body.category && typeof req.body.category === 'string' && req.body.category.trim().length > 0;
      
      // Parse productTypes - might be string (before sanitization) or array (after)
      let productTypes = req.body.productTypes;
      if (typeof productTypes === 'string' && productTypes.trim().length > 0) {
        try {
          productTypes = JSON.parse(productTypes);
        } catch (e) {
          productTypes = null;
        }
      }
      const hasProductTypes = Array.isArray(productTypes) && productTypes.length > 0;
      
      // Only require productTypes (animeSeries is optional)
      if (!hasCategory && !hasProductTypes) {
        throw new Error('Either category OR productTypes must be provided');
      }
      return true;
    } catch (error) {
      // Re-throw validation errors
      if (error.message && error.message.includes('must be provided')) {
        throw error;
      }
      // For other errors, log and allow through (let controller handle it)
      console.error('Validation custom check error:', error);
      return true;
    }
  }),
  body('stockQuantity')
    .isInt({ min: 0 }).withMessage('Stock quantity must be a non-negative integer'),
  body('sku')
    .trim()
    .notEmpty().withMessage('SKU is required'),
  body('description')
    .optional()
    .trim()
];

// Admin login validation
exports.loginValidation = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Please provide a valid email'),
  body('password')
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 4 }).withMessage('Password must be at least 4 characters')
];

// Admin registration validation
exports.registerValidation = [
  body('name')
    .trim()
    .notEmpty().withMessage('Name is required'),
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Please provide a valid email'),
  body('password')
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
];

