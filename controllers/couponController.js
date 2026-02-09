const Coupon = require('../models/Coupon');
const AuditLog = require('../models/AuditLog');

// @desc    Get all coupons
// @route   GET /api/coupons
// @access  Private/Admin
exports.getAllCoupons = async (req, res) => {
  try {
    const { isActive, search, page = 1, limit = 50 } = req.query;
    const query = {};

    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    if (search) {
      query.$or = [
        { code: { $regex: search, $options: 'i' } },
        { name: { $regex: search, $options: 'i' } }
      ];
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const coupons = await Coupon.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const total = await Coupon.countDocuments(query);

    res.json({
      success: true,
      count: coupons.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
      data: coupons
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching coupons',
      error: error.message
    });
  }
};

// @desc    Create coupon
// @route   POST /api/coupons
// @access  Private/Admin
exports.createCoupon = async (req, res) => {
  try {
    const coupon = await Coupon.create(req.body);

    // Log audit
    await AuditLog.create({
      admin: req.admin._id,
      action: 'CREATE',
      entityType: 'COUPON',
      entityId: coupon._id,
      changes: req.body,
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.status(201).json({
      success: true,
      message: 'Coupon created successfully',
      data: coupon
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Coupon code already exists'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error creating coupon',
      error: error.message
    });
  }
};

// @desc    Update coupon
// @route   PUT /api/coupons/:id
// @access  Private/Admin
exports.updateCoupon = async (req, res) => {
  try {
    const coupon = await Coupon.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: 'Coupon not found'
      });
    }

    // Log audit
    await AuditLog.create({
      admin: req.admin._id,
      action: 'UPDATE',
      entityType: 'COUPON',
      entityId: coupon._id,
      changes: req.body,
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.json({
      success: true,
      message: 'Coupon updated successfully',
      data: coupon
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating coupon',
      error: error.message
    });
  }
};

// @desc    Delete coupon
// @route   DELETE /api/coupons/:id
// @access  Private/Admin
exports.deleteCoupon = async (req, res) => {
  try {
    const coupon = await Coupon.findByIdAndDelete(req.params.id);

    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: 'Coupon not found'
      });
    }

    // Log audit
    await AuditLog.create({
      admin: req.admin._id,
      action: 'DELETE',
      entityType: 'COUPON',
      entityId: req.params.id,
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.json({
      success: true,
      message: 'Coupon deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting coupon',
      error: error.message
    });
  }
};

// @desc    Get active coupons (public)
// @route   GET /api/coupons/active
// @access  Public
exports.getActiveCoupons = async (req, res) => {
  try {
    const now = new Date();
    
    const coupons = await Coupon.find({
      isActive: true,
      showOnProductPage: true,
      $or: [
        { validUntil: null }, // No expiration
        { validUntil: { $gte: now } } // Not expired yet
      ],
      validFrom: { $lte: now }
    }).select('code name description discountType discountValue minCartValue minQuantity maxDiscount');

    res.json({
      success: true,
      count: coupons.length,
      data: coupons
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching active coupons',
      error: error.message
    });
  }
};

// @desc    Validate coupon code
// @route   POST /api/coupons/validate
// @access  Public
exports.validateCoupon = async (req, res) => {
  try {
    const { code, cartValue, cartItems } = req.body;

    if (!code) {
      return res.status(400).json({
        success: false,
        message: 'Coupon code is required'
      });
    }

    const coupon = await Coupon.findOne({ 
      code: code.toUpperCase(),
      isActive: true
    });

    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: 'Invalid coupon code'
      });
    }

    const now = new Date();

    // Check if coupon has started
    if (coupon.validFrom && coupon.validFrom > now) {
      return res.status(400).json({
        success: false,
        message: 'Coupon is not yet active'
      });
    }

    // Check if coupon has expired (only if validUntil is set)
    if (coupon.validUntil && coupon.validUntil < now) {
      return res.status(400).json({
        success: false,
        message: 'Coupon has expired'
      });
    }

    // Check usage limit
    if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
      return res.status(400).json({
        success: false,
        message: 'Coupon usage limit reached'
      });
    }

    // Check minimum cart value
    if (cartValue < coupon.minCartValue) {
      return res.status(400).json({
        success: false,
        message: `Minimum cart value of ₹${coupon.minCartValue} required`
      });
    }

    // Check minimum quantity for quantity-based discounts
    if (coupon.minQuantity > 1) {
      const totalQuantity = cartItems ? cartItems.reduce((sum, item) => sum + (item.quantity || 1), 0) : 1;
      if (totalQuantity < coupon.minQuantity) {
        return res.status(400).json({
          success: false,
          message: `Buy at least ${coupon.minQuantity} items to use this coupon`
        });
      }
    }

    // Calculate discount
    let discountAmount = 0;
    if (coupon.discountType === 'FLAT') {
      discountAmount = coupon.discountValue;
    } else if (coupon.discountType === 'PERCENTAGE' || coupon.discountType === 'BUY_X_GET_Y') {
      discountAmount = (cartValue * coupon.discountValue) / 100;
      if (coupon.maxDiscount && discountAmount > coupon.maxDiscount) {
        discountAmount = coupon.maxDiscount;
      }
    }

    res.json({
      success: true,
      message: 'Coupon is valid',
      data: {
        coupon: {
          code: coupon.code,
          name: coupon.name,
          description: coupon.description,
          discountType: coupon.discountType,
          discountValue: coupon.discountValue
        },
        discountAmount: Math.round(discountAmount * 100) / 100
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error validating coupon',
      error: error.message
    });
  }
};

module.exports = exports;
