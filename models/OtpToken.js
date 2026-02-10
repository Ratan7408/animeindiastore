const mongoose = require('mongoose');

const otpTokenSchema = new mongoose.Schema(
  {
    identifier: {
      type: String,
      required: true,
      index: true
    }, // email or phone (normalized)
    code: {
      type: String,
      required: true
    },
    purpose: {
      type: String,
      enum: ['LOGIN', 'REGISTER', 'PASSWORD_RESET'],
      default: 'LOGIN',
      index: true
    },
    expiresAt: {
      type: Date,
      required: true
      // TTL index is defined below with otpTokenSchema.index(...)
    },
    attempts: {
      type: Number,
      default: 0
    }
  },
  {
    timestamps: true
  }
);

// TTL index (Mongo will auto-delete expired docs)
otpTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('OtpToken', otpTokenSchema);

