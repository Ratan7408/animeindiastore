const { sendContactMessage } = require('../utils/emailService');
const EventNotification = require('../models/EventNotification');
const { sendEventNotifyConfirmation } = require('../utils/emailService');

// @desc    Handle public contact form submission
// @route   POST /api/public/contact
// @access  Public
exports.handleContact = async (req, res) => {
  try {
    const { firstName, lastName, email, phone, subject, message } = req.body || {};

    if (!email || !message) {
      return res.status(400).json({
        success: false,
        message: 'Email and message are required'
      });
    }

    await sendContactMessage({
      name: `${firstName || ''} ${lastName || ''}`.trim(),
      email,
      phone,
      subject,
      message
    });

    res.json({
      success: true,
      message: 'Message sent successfully'
    });
  } catch (error) {
    console.error('Contact form error:', error.message || error);
    if (error.response) console.error('SMTP response:', error.response);
    res.status(500).json({
      success: false,
      message: 'Error sending message'
    });
  }
};

// @desc    Subscribe for event reminder
// @route   POST /api/public/events/notify
// @access  Public (guest or logged-in customer)
exports.notifyForEvent = async (req, res) => {
  try {
    const payload = req.body || {};
    const eventTitle = String(payload.eventTitle || '').trim();
    const eventCity = String(payload.eventCity || '').trim();
    const eventLink = String(payload.eventLink || '').trim();
    const inputEmail = String(payload.email || '').trim().toLowerCase();
    const email = (req.customer?.email || inputEmail || '').trim().toLowerCase();
    const name = String(req.customer?.name || payload.name || '').trim();
    const eventDateRaw = payload.eventDate;
    const eventDate = eventDateRaw ? new Date(eventDateRaw) : null;

    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Valid email is required' });
    }
    if (!eventTitle) {
      return res.status(400).json({ success: false, message: 'Event title is required' });
    }
    if (!eventDate || Number.isNaN(eventDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Valid event date is required' });
    }

    const normalizedDate = new Date(eventDate);
    normalizedDate.setHours(0, 0, 0, 0);

    const existing = await EventNotification.findOne({
      email,
      eventTitle,
      eventDate: normalizedDate
    });

    if (existing) {
      return res.json({
        success: true,
        message: 'You are already subscribed for this event reminder.'
      });
    }

    await EventNotification.create({
      email,
      name,
      eventTitle,
      eventCity,
      eventDate: normalizedDate,
      eventLink
    });

    try {
      await sendEventNotifyConfirmation({
        to: email,
        name,
        eventTitle,
        eventDate: normalizedDate,
        eventCity
      });
    } catch (mailErr) {
      console.warn('Event confirmation email failed:', mailErr.message || mailErr);
    }

    return res.json({
      success: true,
      message: 'Subscribed successfully. You will be notified for this event.'
    });
  } catch (error) {
    console.error('notifyForEvent error:', error.message || error);
    return res.status(500).json({
      success: false,
      message: 'Could not subscribe for event notification'
    });
  }
};

module.exports = exports;

