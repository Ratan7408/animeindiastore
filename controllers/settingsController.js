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

