const Settings = require('../models/Settings');
const AuditLog = require('../models/AuditLog');

// @desc    Get public checkout settings (shipping, free-ship threshold – no auth)
// @route   GET /api/public/checkout-settings
// @access  Public
exports.getPublicCheckoutSettings = async (req, res) => {
  try {
    const settings = await Settings.getSettings();
    const shippingCharges = Math.max(0, Number(settings.shippingCharges) || 0);
    const freeShippingThreshold = Math.max(0, Number(settings.freeShippingThreshold) || 0);
    res.json({
      success: true,
      data: { shippingCharges, freeShippingThreshold }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      data: { shippingCharges: 0, freeShippingThreshold: 0 }
    });
  }
};

// @desc    Get public homepage hero banner URLs (no auth – desktop + mobile)
// @route   GET /api/public/banners
// @access  Public
exports.getPublicBanners = async (req, res) => {
  try {
    const settings = await Settings.getSettings();
    const data = {};
    for (let i = 1; i <= 8; i++) {
      data[`banner${i}`] = settings[`homepageHeroBanner${i}`] || null;
      data[`mobileBanner${i}`] = settings[`homepageHeroBannerMobile${i}`] || null;
    }
    res.json({ success: true, data });
  } catch (error) {
    const data = {};
    for (let i = 1; i <= 8; i++) {
      data[`banner${i}`] = null;
      data[`mobileBanner${i}`] = null;
    }
    res.status(500).json({ success: true, data });
  }
};

// @desc    Get public maintenance status (no auth – for frontend to show maintenance page)
// @route   GET /api/public/maintenance
// @access  Public
exports.getPublicMaintenance = async (req, res) => {
  try {
    const settings = await Settings.getSettings();
    res.json({
      success: true,
      maintenanceMode: !!settings.maintenanceMode,
      maintenanceMessage: settings.maintenanceMessage || 'We\'ll be back soon!'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      maintenanceMode: false,
      maintenanceMessage: ''
    });
  }
};

// @desc    Get settings
// @route   GET /api/settings
// @access  Private/Admin
exports.getSettings = async (req, res) => {
  try {
    const settings = await Settings.getSettings();

    res.json({
      success: true,
      data: settings
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching settings',
      error: error.message
    });
  }
};

// Allowed banner slots: desktop 1–8, mobile 1–8 (mobile1..mobile8). Never default – require explicit slot.
const HERO_BANNER_SLOTS = {};
for (let i = 1; i <= 8; i++) {
  HERO_BANNER_SLOTS[String(i)] = `homepageHeroBanner${i}`;
  HERO_BANNER_SLOTS[`mobile${i}`] = `homepageHeroBannerMobile${i}`;
}

// @desc    Upload homepage hero banner image (slot: 1-8 for laptop, mobile1-mobile8 for phone)
// @route   POST /api/settings/upload-hero-banner?slot=1|2|...|8|mobile1|...|mobile8
// @access  Private/Admin
exports.uploadHeroBanner = async (req, res) => {
  try {
    if (!req.file || !req.file.filename) {
      return res.status(400).json({
        success: false,
        message: 'No image file uploaded'
      });
    }
    // Slot must be explicit (query preferred so it is never lost with multipart)
    const rawSlot = (req.query && req.query.slot) || (req.body && req.body.slot);
    const slot = rawSlot != null ? String(rawSlot).toLowerCase().trim() : '';
    const field = HERO_BANNER_SLOTS[slot];
    if (!field) {
      return res.status(400).json({
        success: false,
        message: 'Missing or invalid slot. Use ?slot=1 to 8 for laptop, ?slot=mobile1 to mobile8 for phone.'
      });
    }
    const url = '/uploads/' + req.file.filename;
    const settings = await Settings.getSettings();
    settings[field] = url;
    await settings.save();

    await AuditLog.create({
      admin: req.admin._id,
      action: 'SETTINGS_UPDATE',
      entityType: 'SETTINGS',
      entityId: settings._id,
      changes: { [field]: url },
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.json({
      success: true,
      message: `Hero banner ${slot} updated`,
      data: { url }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error uploading banner',
      error: error.message
    });
  }
};

// @desc    Update settings
// @route   PUT /api/settings
// @access  Private/SuperAdmin
exports.updateSettings = async (req, res) => {
  try {
    let settings = await Settings.findOne();

    if (!settings) {
      settings = await Settings.create({});
    }

    // Update settings
    Object.keys(req.body).forEach(key => {
      if (req.body[key] !== undefined) {
        settings[key] = req.body[key];
      }
    });

    await settings.save();

    // Log audit
    await AuditLog.create({
      admin: req.admin._id,
      action: 'SETTINGS_UPDATE',
      entityType: 'SETTINGS',
      entityId: settings._id,
      changes: req.body,
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.json({
      success: true,
      message: 'Settings updated successfully',
      data: settings
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating settings',
      error: error.message
    });
  }
};

module.exports = exports;

