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
  },
  // Homepage hero slider (desktop) – up to 8 banner image URLs
  homepageHeroBanner1: String,
  homepageHeroBanner2: String,
  homepageHeroBanner3: String,
  homepageHeroBanner4: String,
  homepageHeroBanner5: String,
  homepageHeroBanner6: String,
  homepageHeroBanner7: String,
  homepageHeroBanner8: String,
  // Optional link per desktop banner (e.g. /oversized, /posters) – where clicking the banner goes
  homepageHeroBanner1Link: String,
  homepageHeroBanner2Link: String,
  homepageHeroBanner3Link: String,
  homepageHeroBanner4Link: String,
  homepageHeroBanner5Link: String,
  homepageHeroBanner6Link: String,
  homepageHeroBanner7Link: String,
  homepageHeroBanner8Link: String,
  // Homepage hero slider (mobile/phones) – up to 8 banner image URLs
  homepageHeroBannerMobile1: String,
  homepageHeroBannerMobile2: String,
  homepageHeroBannerMobile3: String,
  homepageHeroBannerMobile4: String,
  homepageHeroBannerMobile5: String,
  homepageHeroBannerMobile6: String,
  homepageHeroBannerMobile7: String,
  homepageHeroBannerMobile8: String,
  // Optional link per mobile banner
  homepageHeroBannerMobile1Link: String,
  homepageHeroBannerMobile2Link: String,
  homepageHeroBannerMobile3Link: String,
  homepageHeroBannerMobile4Link: String,
  homepageHeroBannerMobile5Link: String,
  homepageHeroBannerMobile6Link: String,
  homepageHeroBannerMobile7Link: String,
  homepageHeroBannerMobile8Link: String
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

