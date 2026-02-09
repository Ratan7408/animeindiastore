const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true
  },
  name: {
    type: String,
    required: true
  },
  description: String,
  discountType: {
    type: String,
    enum: ['PERCENTAGE', 'FLAT', 'BUY_X_GET_Y'],
    required: true
  },
  discountValue: {
    type: Number,
    required: true,
    min: 0
  },
  minCartValue: {
    type: Number,
    default: 0
  },
  minQuantity: {
    type: Number,
    default: 1 // For quantity-based offers like "Buy 2 get 20% off"
  },
  maxDiscount: Number, // For percentage discounts
  validFrom: {
    type: Date,
    default: Date.now
  },
  validUntil: {
    type: Date,
    default: null // null = no expiration
  },
  usageLimit: {
    type: Number,
    default: null // null = unlimited
  },
  usedCount: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  },
  applicableCategories: [String],
  applicableProducts: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product'
  }],
  firstOrderOnly: {
    type: Boolean,
    default: false
  },
  showOnProductPage: {
    type: Boolean,
    default: true // Show this coupon in "Available Offers" section
  }
}, {
  timestamps: true
});

// Indexes
// Note: code index is automatically created by unique: true
couponSchema.index({ isActive: 1 });
couponSchema.index({ validFrom: 1, validUntil: 1 });

module.exports = mongoose.model('Coupon', couponSchema);
