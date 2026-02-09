const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const addressSchema = new mongoose.Schema({
  name: { type: String, default: '' },
  phone: { type: String, default: '' },
  address: { type: String, default: '' },
  city: { type: String, default: '' },
  state: { type: String, default: '' },
  pincode: { type: String, default: '' },
  country: { type: String, default: '' },
  landmark: { type: String, default: '' },
  type: { type: String, default: 'HOME' },
  isDefault: { type: Boolean, default: false }
}, { _id: false });

const customerSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email']
  },
  phone: {
    type: String,
    required: true,
    trim: true
  },
  dateOfBirth: { type: Date, default: null },
  gender: { type: String, enum: ['MALE', 'FEMALE', 'OTHER'], default: null },
  password: {
    type: String,
    select: false
  },
  addresses: [addressSchema],
  isBlocked: {
    type: Boolean,
    default: false
  },
  blockedReason: String,
  totalOrders: {
    type: Number,
    default: 0
  },
  totalSpent: {
    type: Number,
    default: 0
  },
  walletBalance: {
    type: Number,
    default: 0
  },
  lastOrderDate: Date,
  emailVerified: {
    type: Boolean,
    default: false
  },
  phoneVerified: {
    type: Boolean,
    default: false
  },
  // Abandoned cart: snapshot of cart items + last updated (for reminder emails)
  cartSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  cartUpdatedAt: { type: Date, default: null },
  abandonedCartEmailSentAt: { type: Date, default: null }
}, {
  timestamps: true
});

// Hash password before saving
customerSchema.pre('save', async function(next) {
  if (!this.isModified('password')) {
    return next();
  }
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
customerSchema.methods.comparePassword = async function(candidatePassword) {
  if (!this.password) {
    return false;
  }
  return await bcrypt.compare(candidatePassword, this.password);
};

// Indexes
// Note: email index is automatically created by unique: true
customerSchema.index({ phone: 1 });
customerSchema.index({ isBlocked: 1 });

module.exports = mongoose.model('Customer', customerSchema);

