const mongoose = require('mongoose');

const returnItemSchema = new mongoose.Schema({
  orderItem: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  quantity: {
    type: Number,
    required: true
  },
  size: {
    type: String,
    enum: ['XS', 'S', 'M', 'L', 'XL', 'XXL']
  },
  reason: String
});

const returnSchema = new mongoose.Schema({
  returnNumber: {
    type: String,
    unique: true,
    required: true
  },
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true
  },
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true
  },
  items: [returnItemSchema],
  reason: {
    type: String,
    required: true
  },
  description: String,
  images: [String],
  status: {
    type: String,
    enum: ['PENDING', 'APPROVED', 'REJECTED', 'PROCESSING', 'COMPLETED'],
    default: 'PENDING'
  },
  refundAmount: {
    type: Number,
    default: 0
  },
  refundStatus: {
    type: String,
    enum: ['PENDING', 'INITIATED', 'PROCESSING', 'COMPLETED', 'FAILED'],
    default: 'PENDING'
  },
  refundMethod: {
    type: String,
    enum: ['ORIGINAL', 'WALLET']
  },
  refundTransactionId: String,
  adminNotes: String,
  internalNotes: String,
  approvedAt: Date,
  rejectedAt: Date,
  rejectedReason: String,
  completedAt: Date
}, {
  timestamps: true
});

// Generate return number
returnSchema.pre('save', async function(next) {
  if (!this.returnNumber) {
    try {
      const count = await this.constructor.countDocuments();
      this.returnNumber = `RET${Date.now()}${String(count + 1).padStart(4, '0')}`;
    } catch (err) {
      next(err);
      return;
    }
  }
  next();
});

// Indexes
// Note: returnNumber index is automatically created by unique: true
returnSchema.index({ order: 1 });
returnSchema.index({ customer: 1 });
returnSchema.index({ status: 1 });

module.exports = mongoose.model('Return', returnSchema);

