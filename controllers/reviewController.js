const mongoose = require('mongoose');
const Review = require('../models/Review');
const Product = require('../models/Product');
const Order = require('../models/Order');
const AuditLog = require('../models/AuditLog');

/**
 * Customer: submit review after delivery (multipart: images[] optional).
 * POST /api/orders/reviews — requires auth; order must be DELIVERED and contain the product.
 */
exports.createCustomerReview = async (req, res) => {
  try {
    if (!req.customer?._id) {
      return res.status(401).json({ success: false, message: 'Please login to submit a review.' });
    }

    const { orderId, productId, rating, title, comment } = req.body;
    const r = parseInt(rating, 10);
    if (!orderId || !productId || !Number.isFinite(r) || r < 1 || r > 5) {
      return res.status(400).json({
        success: false,
        message: 'Order, product, and rating (1–5) are required.'
      });
    }

    if (!mongoose.Types.ObjectId.isValid(orderId) || !mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: 'Invalid order or product.' });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }
    if (order.customer.toString() !== req.customer._id.toString()) {
      return res.status(403).json({ success: false, message: 'This order does not belong to your account.' });
    }
    if (order.orderStatus !== 'DELIVERED') {
      return res.status(400).json({
        success: false,
        message: 'You can review products only after your order is delivered.'
      });
    }

    const productInOrder = order.items.some((item) => {
      const pid = item.product?.toString ? item.product.toString() : String(item.product);
      return pid === productId;
    });
    if (!productInOrder) {
      return res.status(400).json({
        success: false,
        message: 'This product was not part of this order.'
      });
    }

    const existing = await Review.findOne({
      customer: req.customer._id,
      order: orderId,
      product: productId
    });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'You already submitted a review for this product from this order.'
      });
    }

    const imagePaths = (req.files || []).map((f) => `/uploads/${f.filename}`);
    const review = await Review.create({
      product: productId,
      customer: req.customer._id,
      order: orderId,
      rating: r,
      title: (title && String(title).trim().slice(0, 200)) || '',
      comment: (comment && String(comment).trim().slice(0, 2000)) || '',
      images: imagePaths,
      isVerifiedPurchase: true,
      isApproved: false,
      isHidden: false
    });

    return res.status(201).json({
      success: true,
      message: 'Thank you! Your review will appear after our team approves it.',
      data: review
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'You already submitted a review for this product from this order.'
      });
    }
    console.error('createCustomerReview:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Could not submit review.'
    });
  }
};

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
      .populate('order', 'orderNumber shippingAddress.name shippingAddress.email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const total = await Review.countDocuments(query);
    const data = reviews.map((reviewDoc) => {
      const r = reviewDoc.toObject ? reviewDoc.toObject() : reviewDoc;
      const customerName = r.customer?.name && String(r.customer.name).trim()
        ? String(r.customer.name).trim()
        : '';
      const fallbackName = r.order?.shippingAddress?.name && String(r.order.shippingAddress.name).trim()
        ? String(r.order.shippingAddress.name).trim()
        : '';
      const fallbackEmail = r.customer?.email || r.order?.shippingAddress?.email || '';
      return {
        ...r,
        customerDisplayName: customerName || fallbackName || (fallbackEmail ? String(fallbackEmail).trim() : 'Guest Customer')
      };
    });

    res.json({
      success: true,
      count: reviews.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
      data
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

// @desc    Public: approved reviews for a product (storefront)
// @route   GET /api/public/reviews/product/:productId
// @access  Public
exports.getPublicReviewsByProduct = async (req, res) => {
  try {
    const { productId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: 'Invalid product id' });
    }
    const exists = await Product.exists({ _id: productId });
    if (!exists) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    // Storefront: only admin-approved reviews; never show pending or fake entries.
    const match = {
      product: new mongoose.Types.ObjectId(productId),
      isApproved: true,
      isHidden: { $ne: true }
    };
    const [reviews, total, agg] = await Promise.all([
      Review.find(match)
        .populate('customer', 'name')
        .populate('order', 'shippingAddress.name')
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),
      Review.countDocuments(match),
      Review.aggregate([
        { $match: match },
        { $group: { _id: null, avg: { $avg: '$rating' } } }
      ])
    ]);
    let averageRating = 0;
    if (agg.length && agg[0].avg != null) {
      averageRating = Math.round(agg[0].avg * 10) / 10;
    }
    const reviewsOut = reviews.map((r) => {
      const imgs = Array.isArray(r.images) ? r.images : [];
      const normalizedImages = imgs.map((img) => {
        if (!img || typeof img !== 'string') return '';
        const t = img.trim();
        if (!t) return '';
        if (t.startsWith('http://') || t.startsWith('https://')) return t;
        return t.startsWith('/') ? t : `/${t}`;
      }).filter(Boolean);
      return {
        _id: r._id,
        rating: r.rating,
        title: r.title || '',
        comment: r.comment || '',
        images: normalizedImages,
        isVerifiedPurchase: Boolean(r.isVerifiedPurchase),
        createdAt: r.createdAt,
        customerName: (() => {
          const customerName = r.customer?.name ? String(r.customer.name).trim() : '';
          const shippingName = r.order?.shippingAddress?.name ? String(r.order.shippingAddress.name).trim() : '';
          const picked = customerName || shippingName || 'Customer';
          return picked.split(/\s+/)[0];
        })()
      };
    });
    res.json({
      success: true,
      data: {
        total,
        averageRating,
        reviews: reviewsOut
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Error fetching reviews'
    });
  }
};

// @desc    Public: approved review summary for many products
// @route   GET /api/public/reviews/summary?productIds=id1,id2,id3
// @access  Public
exports.getPublicReviewSummaryByProducts = async (req, res) => {
  try {
    const raw = String(req.query.productIds || '').trim();
    if (!raw) {
      return res.json({ success: true, data: {} });
    }

    const ids = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .slice(0, 100);

    const validIds = ids.filter((id) => mongoose.Types.ObjectId.isValid(id));
    if (!validIds.length) {
      return res.json({ success: true, data: {} });
    }

    const objIds = validIds.map((id) => new mongoose.Types.ObjectId(id));
    const agg = await Review.aggregate([
      {
        $match: {
          product: { $in: objIds },
          isApproved: true,
          isHidden: { $ne: true }
        }
      },
      {
        $group: {
          _id: '$product',
          total: { $sum: 1 },
          averageRating: { $avg: '$rating' }
        }
      }
    ]);

    const out = {};
    validIds.forEach((id) => {
      out[id] = { total: 0, averageRating: 0 };
    });
    agg.forEach((row) => {
      const key = String(row._id);
      out[key] = {
        total: Number(row.total || 0),
        averageRating: Math.round((Number(row.averageRating || 0) + Number.EPSILON) * 10) / 10
      };
    });

    return res.json({ success: true, data: out });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Error fetching review summary'
    });
  }
};

module.exports = exports;

