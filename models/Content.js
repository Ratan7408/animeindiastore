const mongoose = require('mongoose');

const bannerSchema = new mongoose.Schema({
  title: String,
  image: {
    type: String,
    required: true
  },
  link: String,
  linkText: String,
  isActive: {
    type: Boolean,
    default: true
  },
  displayOrder: {
    type: Number,
    default: 0
  },
  startDate: Date,
  endDate: Date
});

const contentSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['BANNER', 'FAQ', 'POLICY', 'CONTACT', 'FOOTER', 'PROMOTIONAL_TEXT'],
    required: true,
    unique: true
  },
  banners: [bannerSchema],
  title: String,
  content: String,
  htmlContent: String,
  contactInfo: {
    email: String,
    phone: String,
    address: String,
    socialMedia: {
      facebook: String,
      instagram: String,
      twitter: String,
      youtube: String
    }
  },
  footerLinks: [{
    title: String,
    url: String,
    displayOrder: Number
  }],
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes
// Note: type index is automatically created by unique: true

module.exports = mongoose.model('Content', contentSchema);

