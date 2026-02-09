const Return = require('../models/Return');
const Order = require('../models/Order');
const Payment = require('../models/Payment');
const Product = require('../models/Product');
const AuditLog = require('../models/AuditLog');

const RETURN_WINDOW_DAYS = 7;

// @desc    Create return request (customer)
// @route   POST /api/returns
// @access  Private/Customer
exports.createReturn = async (req, res) => {
  try {
    const customerId = req.customer?._id;
    if (!customerId) {
      return res.status(401).json({
        success: false,
        message: 'Please login to request a return'
      });
    }

    const { orderId, items, reason, description } = req.body;

    if (!orderId || !items || !Array.isArray(items) || items.length === 0 || !reason) {
      return res.status(400).json({
        success: false,
        message: 'Order ID, at least one item, and reason are required'
      });
    }

    // Don't populate items.product so orderItem.product is always ObjectId (avoids null if product deleted)
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    if (order.customer.toString() !== customerId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You can only request returns for your own orders'
      });
    }

    if (order.orderStatus !== 'DELIVERED') {
      return res.status(400).json({
        success: false,
        message: 'Returns are only allowed for delivered orders'
      });
    }

    const deliveredAt = order.deliveredAt || order.updatedAt;
    const returnWindowEnd = new Date(deliveredAt);
    returnWindowEnd.setDate(returnWindowEnd.getDate() + RETURN_WINDOW_DAYS);
    if (new Date() > returnWindowEnd) {
      return res.status(400).json({
        success: false,
        message: `Return window has ended. Returns must be requested within ${RETURN_WINDOW_DAYS} days of delivery`
      });
    }

    const existingReturn = await Return.findOne({
      order: orderId,
      status: { $in: ['PENDING', 'APPROVED', 'PROCESSING'] }
    });
    if (existingReturn) {
      return res.status(400).json({
        success: false,
        message: 'A return request for this order already exists'
      });
    }

    let refundAmount = 0;
    const returnItems = [];

    if (!order.items || !Array.isArray(order.items) || order.items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Order has no items'
      });
    }

    for (const reqItem of items) {
      const orderItemId = reqItem.orderItemId && String(reqItem.orderItemId).trim();
      if (!orderItemId) continue;
      const orderItem = order.items.id(orderItemId);
      if (!orderItem) {
        return res.status(400).json({
          success: false,
          message: `Invalid order item: ${reqItem.orderItemId}`
        });
      }
      const qty = Math.min(parseInt(reqItem.quantity, 10) || orderItem.quantity, orderItem.quantity);
      if (qty < 1) continue;

      const itemPrice = orderItem.price * (1 - (orderItem.discount || 0) / 100);
      refundAmount += itemPrice * qty;

      const productId = orderItem.product && typeof orderItem.product === 'object' && orderItem.product._id
        ? orderItem.product._id
        : orderItem.product;
      if (!productId) continue; // skip if product ref missing
      returnItems.push({
        orderItem: orderItem._id,
        product: productId,
        quantity: qty,
        size: orderItem.size || undefined,
        reason: reqItem.reason || undefined
      });
    }

    if (returnItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please select at least one item with quantity to return'
      });
    }

    // Generate returnNumber before creating document (required by schema; pre-save runs after validation)
    const count = await Return.countDocuments();
    const returnNumber = `RET${Date.now()}${String(count + 1).padStart(4, '0')}`;

    const returnRequest = new Return({
      returnNumber,
      order: orderId,
      customer: customerId,
      items: returnItems,
      reason: reason.trim(),
      description: description ? description.trim() : undefined,
      refundAmount: Math.round(refundAmount)
    });

    await returnRequest.save();

    const populated = await Return.findById(returnRequest._id)
      .populate('order', 'orderNumber total')
      .populate('items.product', 'name sku images');

    res.status(201).json({
      success: true,
      message: 'Return request submitted successfully. We will review it shortly.',
      data: populated
    });
  } catch (error) {
    console.error('createReturn error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating return request',
      error: error.message
    });
  }
};

// @desc    Get my return requests (customer)
// @route   GET /api/returns/my-returns
// @access  Private/Customer
exports.getMyReturns = async (req, res) => {
  try {
    const customerId = req.customer?._id;
    if (!customerId) {
      return res.status(401).json({
        success: false,
        message: 'Please login to view your returns'
      });
    }

    const returns = await Return.find({ customer: customerId })
      .populate('order', 'orderNumber total')
      .populate('items.product', 'name sku images')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: returns.length,
      data: returns
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching your returns',
      error: error.message
    });
  }
};

// @desc    Get all returns
// @route   GET /api/returns
// @access  Private/Admin
exports.getAllReturns = async (req, res) => {
  try {
    const {
      status,
      orderId,
      customerId,
      page = 1,
      limit = 50
    } = req.query;

    const query = {};

    if (status) {
      query.status = status;
    }

    if (orderId) {
      query.order = orderId;
    }

    if (customerId) {
      query.customer = customerId;
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const returns = await Return.find(query)
      .populate('order', 'orderNumber total')
      .populate('customer', 'name email phone')
      .populate('items.product', 'name sku images')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const total = await Return.countDocuments(query);

    res.json({
      success: true,
      count: returns.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
      data: returns
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching returns',
      error: error.message
    });
  }
};

// @desc    Get single return
// @route   GET /api/returns/:id
// @access  Private/Admin
exports.getReturn = async (req, res) => {
  try {
    const returnRequest = await Return.findById(req.params.id)
      .populate('order')
      .populate('customer')
      .populate('items.product');

    if (!returnRequest) {
      return res.status(404).json({
        success: false,
        message: 'Return request not found'
      });
    }

    res.json({
      success: true,
      data: returnRequest
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching return',
      error: error.message
    });
  }
};

// @desc    Approve return
// @route   PUT /api/returns/:id/approve
// @access  Private/Admin
exports.approveReturn = async (req, res) => {
  try {
    const returnRequest = await Return.findById(req.params.id)
      .populate('order');

    if (!returnRequest) {
      return res.status(404).json({
        success: false,
        message: 'Return request not found'
      });
    }

    if (returnRequest.status !== 'PENDING') {
      return res.status(400).json({
        success: false,
        message: 'Return request is not pending'
      });
    }

    returnRequest.status = 'APPROVED';
    returnRequest.approvedAt = new Date();
    if (req.body.adminNotes) {
      returnRequest.adminNotes = req.body.adminNotes;
    }

    // Restore stock
    for (const item of returnRequest.items) {
      const product = await Product.findById(item.product);
      if (product) {
        if (item.size && product.stockBySize) {
          product.stockBySize[item.size] = (product.stockBySize[item.size] || 0) + item.quantity;
        }
        product.stockQuantity = (product.stockQuantity || 0) + item.quantity;
        await product.save();
      }
    }

    await returnRequest.save();

    // Log audit
    await AuditLog.create({
      admin: req.admin._id,
      action: 'APPROVE',
      entityType: 'RETURN',
      entityId: returnRequest._id,
      changes: { status: { from: 'PENDING', to: 'APPROVED' } },
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.json({
      success: true,
      message: 'Return approved successfully',
      data: returnRequest
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error approving return',
      error: error.message
    });
  }
};

// @desc    Reject return
// @route   PUT /api/returns/:id/reject
// @access  Private/Admin
exports.rejectReturn = async (req, res) => {
  try {
    const { reason } = req.body;
    const returnRequest = await Return.findById(req.params.id);

    if (!returnRequest) {
      return res.status(404).json({
        success: false,
        message: 'Return request not found'
      });
    }

    if (returnRequest.status !== 'PENDING') {
      return res.status(400).json({
        success: false,
        message: 'Return request is not pending'
      });
    }

    returnRequest.status = 'REJECTED';
    returnRequest.rejectedAt = new Date();
    returnRequest.rejectedReason = reason || 'Return request rejected';

    await returnRequest.save();

    // Log audit
    await AuditLog.create({
      admin: req.admin._id,
      action: 'REJECT',
      entityType: 'RETURN',
      entityId: returnRequest._id,
      changes: { status: { from: 'PENDING', to: 'REJECTED' } },
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.json({
      success: true,
      message: 'Return rejected successfully',
      data: returnRequest
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error rejecting return',
      error: error.message
    });
  }
};

// @desc    Update refund status
// @route   PUT /api/returns/:id/refund
// @access  Private/Admin
exports.updateRefundStatus = async (req, res) => {
  try {
    const { refundStatus, refundMethod, refundTransactionId, refundAmount } = req.body;
    const returnRequest = await Return.findById(req.params.id)
      .populate('order');

    if (!returnRequest) {
      return res.status(404).json({
        success: false,
        message: 'Return request not found'
      });
    }

    if (refundStatus) {
      returnRequest.refundStatus = refundStatus;
    }

    if (refundMethod) {
      returnRequest.refundMethod = refundMethod;
    }

    if (refundTransactionId) {
      returnRequest.refundTransactionId = refundTransactionId;
    }

    if (refundAmount !== undefined) {
      returnRequest.refundAmount = refundAmount;
    }

    if (refundStatus === 'COMPLETED') {
      returnRequest.completedAt = new Date();
      returnRequest.status = 'COMPLETED';

      // Update payment record
      const payment = await Payment.findOne({ order: returnRequest.order._id });
      if (payment) {
        payment.refundAmount = (payment.refundAmount || 0) + returnRequest.refundAmount;
        payment.refundStatus = 'COMPLETED';
        payment.refundedAt = new Date();
        await payment.save();
      }
    }

    await returnRequest.save();

    // Log audit
    await AuditLog.create({
      admin: req.admin._id,
      action: 'UPDATE',
      entityType: 'RETURN',
      entityId: returnRequest._id,
      changes: { refundStatus, refundMethod },
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.json({
      success: true,
      message: 'Refund status updated successfully',
      data: returnRequest
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating refund status',
      error: error.message
    });
  }
};

module.exports = exports;

