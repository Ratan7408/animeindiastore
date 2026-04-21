const mongoose = require('mongoose');

const eventNotificationSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  name: {
    type: String,
    default: ''
  },
  eventTitle: {
    type: String,
    required: true,
    trim: true
  },
  eventCity: {
    type: String,
    default: ''
  },
  eventDate: {
    type: Date,
    required: true
  },
  eventLink: {
    type: String,
    default: ''
  },
  confirmedAt: {
    type: Date,
    default: Date.now
  },
  reminderSentAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

eventNotificationSchema.index({ email: 1, eventTitle: 1, eventDate: 1 }, { unique: true });
eventNotificationSchema.index({ eventDate: 1, reminderSentAt: 1 });

module.exports = mongoose.model('EventNotification', eventNotificationSchema);
