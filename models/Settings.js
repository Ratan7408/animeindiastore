const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  siteName: {
    type: String,
    default: 'AnimeWeb'
  },
  siteLogo: String,
  currency: {
    type: String,
    default: 'INR',
    enum: ['INR', 'USD', 'EUR']
  },
  currencySymbol: {
    type: String,
    default: '₹'
  },
  taxRate: {
    type: Number,
    default: 0
  },
  shippingCharges: {
    type: Number,
    default: 0
  },
  freeShippingThreshold: {
    type: Number,
    default: 0
  },
  codEnabled: {
    type: Boolean,
    default: true
  },
  codCharges: {
    type: Number,
    default: 0
  },
  paymentGateways: {
    razorpay: {
      enabled: { type: Boolean, default: false },
      keyId: String,
      keySecret: String
    },
    stripe: {
      enabled: { type: Boolean, default: false },
      publishableKey: String,
      secretKey: String
    }
  },
  maintenanceMode: {
    type: Boolean,
    default: false
  },
  maintenanceMessage: String,
  lowStockThreshold: {
    type: Number,
    default: 10
  },
  emailNotifications: {
    orderPlaced: { type: Boolean, default: true },
    orderShipped: { type: Boolean, default: true },
    orderDelivered: { type: Boolean, default: true },
    lowStock: { type: Boolean, default: true },
    paymentFailed: { type: Boolean, default: true }
  },
  smsNotifications: {
    orderPlaced: { type: Boolean, default: false },
    orderShipped: { type: Boolean, default: false },
    orderDelivered: { type: Boolean, default: false }
  }
}, {
  timestamps: true
});

// Ensure only one settings document exists
settingsSchema.statics.getSettings = async function() {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({});
  }
  return settings;
};

module.exports = mongoose.model('Settings', settingsSchema);

