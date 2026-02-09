const Content = require('../models/Content');
const AuditLog = require('../models/AuditLog');

// @desc    Get all content
// @route   GET /api/content
// @access  Private/Admin
exports.getAllContent = async (req, res) => {
  try {
    const content = await Content.find().sort({ type: 1 });

    res.json({
      success: true,
      count: content.length,
      data: content
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching content',
      error: error.message
    });
  }
};

// @desc    Get content by type
// @route   GET /api/content/:type
// @access  Private/Admin
exports.getContentByType = async (req, res) => {
  try {
    const content = await Content.findOne({ type: req.params.type.toUpperCase() });

    if (!content) {
      return res.status(404).json({
        success: false,
        message: 'Content not found'
      });
    }

    res.json({
      success: true,
      data: content
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching content',
      error: error.message
    });
  }
};

// @desc    Get content by type (public – no auth, for frontend)
// @route   GET /api/public/content/:type
// @access  Public
exports.getPublicContentByType = async (req, res) => {
  try {
    const type = req.params.type.toUpperCase();
    const allowed = ['BANNER', 'FAQ', 'POLICY', 'CONTACT', 'FOOTER', 'PROMOTIONAL_TEXT'];
    if (!allowed.includes(type)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid content type'
      });
    }

    const content = await Content.findOne({ type, isActive: true });

    if (!content) {
      return res.json({
        success: true,
        data: null,
        message: 'No content found'
      });
    }

    res.json({
      success: true,
      data: content
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching content',
      error: error.message
    });
  }
};

// @desc    Create or update content
// @route   POST /api/content
// @route   PUT /api/content/:type
// @access  Private/Admin
exports.createOrUpdateContent = async (req, res) => {
  try {
    const { type, ...contentData } = req.body;
    const contentType = type.toUpperCase();

    let content = await Content.findOne({ type: contentType });

    if (content) {
      // Update existing
      Object.assign(content, contentData);
      await content.save();
    } else {
      // Create new
      content = await Content.create({ type: contentType, ...contentData });
    }

    // Log audit
    await AuditLog.create({
      admin: req.admin._id,
      action: content.isNew ? 'CREATE' : 'UPDATE',
      entityType: 'CONTENT',
      entityId: content._id,
      changes: contentData,
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.json({
      success: true,
      message: `Content ${content.isNew ? 'created' : 'updated'} successfully`,
      data: content
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error saving content',
      error: error.message
    });
  }
};

// @desc    Update banner
// @route   PUT /api/content/:type/banners
// @access  Private/Admin
exports.updateBanners = async (req, res) => {
  try {
    const { type } = req.params;
    const { banners } = req.body;

    let content = await Content.findOne({ type: type.toUpperCase() });

    if (!content) {
      content = await Content.create({ type: type.toUpperCase() });
    }

    content.banners = banners;
    await content.save();

    // Log audit
    await AuditLog.create({
      admin: req.admin._id,
      action: 'UPDATE',
      entityType: 'CONTENT',
      entityId: content._id,
      changes: { banners },
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.json({
      success: true,
      message: 'Banners updated successfully',
      data: content
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating banners',
      error: error.message
    });
  }
};

// @desc    Delete content
// @route   DELETE /api/content/:type
// @access  Private/Admin
exports.deleteContent = async (req, res) => {
  try {
    const content = await Content.findOneAndDelete({ type: req.params.type.toUpperCase() });

    if (!content) {
      return res.status(404).json({
        success: false,
        message: 'Content not found'
      });
    }

    // Log audit
    await AuditLog.create({
      admin: req.admin._id,
      action: 'DELETE',
      entityType: 'CONTENT',
      entityId: req.params.type,
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.json({
      success: true,
      message: 'Content deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting content',
      error: error.message
    });
  }
};

module.exports = exports;

