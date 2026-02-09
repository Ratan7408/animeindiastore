const Collection = require('../models/Collection');
const AuditLog = require('../models/AuditLog');

// @desc    Get all collections (public - filters out inactive)
// @route   GET /api/collections
// @access  Public
exports.getAllCollections = async (req, res) => {
  try {
    const query = {};
    // Public users only see active collections
    if (!req.admin) {
      query.isActive = true;
    }
    
    console.log('📋 getAllCollections query:', query);
    const collections = await Collection.find(query)
      .populate('products', 'name sku images price discount stockStatus isActive')
      .sort({ displayOrder: 1, name: 1 });

    console.log('📦 Collections found:', {
      count: collections.length,
      names: collections.map(c => c.name),
      active: collections.map(c => ({ name: c.name, isActive: c.isActive }))
    });

    res.json({
      success: true,
      count: collections.length,
      data: collections
    });
  } catch (error) {
    console.error('❌ Error fetching collections:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching collections',
      error: error.message
    });
  }
};

// @desc    Get collection by slug (public)
// @route   GET /api/collections/slug/:slug
// @access  Public
exports.getCollectionBySlug = async (req, res) => {
  try {
    const collection = await Collection.findOne({ 
      slug: req.params.slug,
      isActive: true 
    }).populate('products', 'name sku images price discount stockStatus isActive');

    if (!collection) {
      return res.status(404).json({
        success: false,
        message: 'Collection not found'
      });
    }

    res.json({
      success: true,
      data: collection
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching collection',
      error: error.message
    });
  }
};

// @desc    Create collection
// @route   POST /api/collections
// @access  Private/Admin
exports.createCollection = async (req, res) => {
  try {
    const collection = await Collection.create(req.body);

    // Log audit
    await AuditLog.create({
      admin: req.admin._id,
      action: 'CREATE',
      entityType: 'COLLECTION',
      entityId: collection._id,
      changes: req.body,
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.status(201).json({
      success: true,
      message: 'Collection created successfully',
      data: collection
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Collection name or slug already exists'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error creating collection',
      error: error.message
    });
  }
};

// @desc    Update collection
// @route   PUT /api/collections/:id
// @access  Private/Admin
exports.updateCollection = async (req, res) => {
  try {
    const collection = await Collection.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate('products', 'name sku images price');

    if (!collection) {
      return res.status(404).json({
        success: false,
        message: 'Collection not found'
      });
    }

    // Log audit
    await AuditLog.create({
      admin: req.admin._id,
      action: 'UPDATE',
      entityType: 'COLLECTION',
      entityId: collection._id,
      changes: req.body,
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.json({
      success: true,
      message: 'Collection updated successfully',
      data: collection
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating collection',
      error: error.message
    });
  }
};

// @desc    Delete collection
// @route   DELETE /api/collections/:id
// @access  Private/Admin
exports.deleteCollection = async (req, res) => {
  try {
    const collection = await Collection.findByIdAndDelete(req.params.id);

    if (!collection) {
      return res.status(404).json({
        success: false,
        message: 'Collection not found'
      });
    }

    // Log audit
    await AuditLog.create({
      admin: req.admin._id,
      action: 'DELETE',
      entityType: 'COLLECTION',
      entityId: req.params.id,
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.json({
      success: true,
      message: 'Collection deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting collection',
      error: error.message
    });
  }
};

module.exports = exports;

