const Review = require('../models/Review');
const Product = require('../models/Product');
const AuditLog = require('../models/AuditLog');

// @desc    Get all reviews
// @route   GET /api/reviews
// @access  Private/Admin
exports.getAllReviews = async (req, res) => {
  try {
    const {
      productId,
      isApproved,
      isHidden,
      rating,
      page = 1,
      limit = 50
    } = req.query;

    const query = {};

    if (productId) {
      query.product = productId;
    }

    if (isApproved !== undefined) {
      query.isApproved = isApproved === 'true';
    }

    if (isHidden !== undefined) {
      query.isHidden = isHidden === 'true';
    }

    if (rating) {
      query.rating = parseInt(rating);
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const reviews = await Review.find(query)
      .populate('product', 'name sku images')
      .populate('customer', 'name email')
      .populate('order', 'orderNumber')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const total = await Review.countDocuments(query);

    res.json({
      success: true,
      count: reviews.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
      data: reviews
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching reviews',
      error: error.message
    });
  }
};

// @desc    Approve/Reject review
// @route   PUT /api/reviews/:id/approve
// @access  Private/Admin
exports.approveReview = async (req, res) => {
  try {
    const { isApproved } = req.body;
    const review = await Review.findById(req.params.id);

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    review.isApproved = isApproved;
    await review.save();

    // Log audit
    await AuditLog.create({
      admin: req.admin._id,
      action: isApproved ? 'APPROVE' : 'REJECT',
      entityType: 'REVIEW',
      entityId: review._id,
      changes: { isApproved },
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.json({
      success: true,
      message: `Review ${isApproved ? 'approved' : 'rejected'} successfully`,
      data: review
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating review',
      error: error.message
    });
  }
};

// @desc    Hide/Unhide review
// @route   PUT /api/reviews/:id/hide
// @access  Private/Admin
exports.toggleHideReview = async (req, res) => {
  try {
    const { isHidden } = req.body;
    const review = await Review.findByIdAndUpdate(
      req.params.id,
      { isHidden },
      { new: true }
    );

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    // Log audit
    await AuditLog.create({
      admin: req.admin._id,
      action: 'UPDATE',
      entityType: 'REVIEW',
      entityId: review._id,
      changes: { isHidden },
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.json({
      success: true,
      message: `Review ${isHidden ? 'hidden' : 'unhidden'} successfully`,
      data: review
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating review',
      error: error.message
    });
  }
};

// @desc    Add admin response to review
// @route   PUT /api/reviews/:id/response
// @access  Private/Admin
exports.addAdminResponse = async (req, res) => {
  try {
    const { text } = req.body;
    const review = await Review.findById(req.params.id);

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    review.adminResponse = {
      text,
      respondedBy: req.admin._id,
      respondedAt: new Date()
    };

    await review.save();

    res.json({
      success: true,
      message: 'Admin response added successfully',
      data: review
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error adding admin response',
      error: error.message
    });
  }
};

// @desc    Delete review
// @route   DELETE /api/reviews/:id
// @access  Private/Admin
exports.deleteReview = async (req, res) => {
  try {
    const review = await Review.findByIdAndDelete(req.params.id);

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    // Log audit
    await AuditLog.create({
      admin: req.admin._id,
      action: 'DELETE',
      entityType: 'REVIEW',
      entityId: req.params.id,
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.json({
      success: true,
      message: 'Review deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting review',
      error: error.message
    });
  }
};

module.exports = exports;

