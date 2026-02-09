const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
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
  transactionId: {
    type: String,
    unique: true,
    sparse: true
  },
  amount: {
    type: Number,
    required: true
  },
  paymentMethod: {
    type: String,
    enum: ['COD', 'ONLINE', 'WALLET'],
    required: true
  },
  paymentGateway: {
    type: String,
    enum: ['RAZORPAY', 'STRIPE', 'PAYPAL', 'COD', 'WALLET'],
    default: 'COD'
  },
  status: {
    type: String,
    enum: ['PENDING', 'SUCCESS', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED'],
    default: 'PENDING'
  },
  gatewayResponse: mongoose.Schema.Types.Mixed,
  refundAmount: {
    type: Number,
    default: 0
  },
  refundTransactionId: String,
  refundStatus: {
    type: String,
    enum: ['NONE', 'INITIATED', 'PROCESSING', 'COMPLETED', 'FAILED'],
    default: 'NONE'
  },
  refundMethod: {
    type: String,
    enum: ['ORIGINAL', 'WALLET']
  },
  paidAt: Date,
  refundedAt: Date,
  notes: String
}, {
  timestamps: true
});

// Indexes
// Note: transactionId index is automatically created by unique: true
paymentSchema.index({ order: 1 });
paymentSchema.index({ customer: 1 });
paymentSchema.index({ status: 1 });
paymentSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Payment', paymentSchema);

