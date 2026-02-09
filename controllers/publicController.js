const { sendContactMessage } = require('../utils/emailService');

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

module.exports = exports;

