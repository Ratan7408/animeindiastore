const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  admin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true
  },
  action: {
    type: String,
    required: true,
    enum: [
      'CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT',
      'APPROVE', 'REJECT', 'EXPORT', 'IMPORT', 'SETTINGS_UPDATE'
    ]
  },
  entityType: {
    type: String,
    required: true,
    enum: ['PRODUCT', 'ORDER', 'CUSTOMER', 'COUPON', 'CATEGORY', 'COLLECTION', 'REVIEW', 'RETURN', 'SETTINGS', 'ADMIN']
  },
  entityId: mongoose.Schema.Types.ObjectId,
  changes: mongoose.Schema.Types.Mixed,
  ipAddress: String,
  userAgent: String
}, {
  timestamps: true
});

// Indexes
auditLogSchema.index({ admin: 1 });
auditLogSchema.index({ action: 1 });
auditLogSchema.index({ entityType: 1 });
auditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);

