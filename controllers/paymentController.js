const Payment = require('../models/Payment');
const Order = require('../models/Order');
const AuditLog = require('../models/AuditLog');
const axios = require('axios');
const crypto = require('crypto');
const { sendOrderConfirmationToCustomer, sendNewOrderNotification } = require('../utils/emailService');

// @desc    Get all payments
// @route   GET /api/payments
// @access  Private/Admin
exports.getAllPayments = async (req, res) => {
  try {
    const {
      status,
      paymentMethod,
      paymentGateway,
      startDate,
      endDate,
      page = 1,
      limit = 50
    } = req.query;

    const query = {};

    if (status) {
      query.status = status;
    }

    if (paymentMethod) {
      query.paymentMethod = paymentMethod;
    }

    if (paymentGateway) {
      query.paymentGateway = paymentGateway;
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const payments = await Payment.find(query)
      .populate('order', 'orderNumber total')
      .populate('customer', 'name email phone')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const total = await Payment.countDocuments(query);

    res.json({
      success: true,
      count: payments.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
      data: payments
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching payments',
      error: error.message
    });
  }
};

// @desc    Get payment statistics
// @route   GET /api/payments/stats
// @access  Private/Admin
exports.getPaymentStats = async (req, res) => {
  try {
    const { period = 'all' } = req.query;

    let dateFilter = {};
    if (period === 'today') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      dateFilter = { createdAt: { $gte: today } };
    } else if (period === 'week') {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      dateFilter = { createdAt: { $gte: weekAgo } };
    } else if (period === 'month') {
      const monthAgo = new Date();
      monthAgo.setMonth(monthAgo.getMonth() - 1);
      dateFilter = { createdAt: { $gte: monthAgo } };
    }

    const [
      totalPayments,
      successfulPayments,
      failedPayments,
      pendingPayments,
      totalAmount,
      successfulAmount,
      codPayments,
      onlinePayments
    ] = await Promise.all([
      Payment.countDocuments(dateFilter),
      Payment.countDocuments({ ...dateFilter, status: 'SUCCESS' }),
      Payment.countDocuments({ ...dateFilter, status: 'FAILED' }),
      Payment.countDocuments({ ...dateFilter, status: 'PENDING' }),
      Payment.aggregate([
        { $match: dateFilter },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]),
      Payment.aggregate([
        { $match: { ...dateFilter, status: 'SUCCESS' } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]),
      Payment.countDocuments({ ...dateFilter, paymentMethod: 'COD' }),
      Payment.countDocuments({ ...dateFilter, paymentMethod: 'ONLINE' })
    ]);

    res.json({
      success: true,
      data: {
        totalPayments,
        byStatus: {
          success: successfulPayments,
          failed: failedPayments,
          pending: pendingPayments
        },
        totalAmount: totalAmount[0]?.total || 0,
        successfulAmount: successfulAmount[0]?.total || 0,
        byMethod: {
          cod: codPayments,
          online: onlinePayments
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching payment statistics',
      error: error.message
    });
  }
};

// @desc    Update refund status
// @route   PUT /api/payments/:id/refund
// @access  Private/Admin
exports.updateRefundStatus = async (req, res) => {
  try {
    const { refundStatus, refundAmount, refundTransactionId, refundMethod } = req.body;
    const payment = await Payment.findById(req.params.id);

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    if (refundStatus) {
      payment.refundStatus = refundStatus;
    }

    if (refundAmount !== undefined) {
      payment.refundAmount = refundAmount;
    }

    if (refundTransactionId) {
      payment.refundTransactionId = refundTransactionId;
    }

    if (refundMethod) {
      payment.refundMethod = refundMethod;
    }

    if (refundStatus === 'COMPLETED') {
      payment.status = 'REFUNDED';
      payment.refundedAt = new Date();
    }

    await payment.save();

    // Log audit
    await AuditLog.create({
      admin: req.admin._id,
      action: 'UPDATE',
      entityType: 'PAYMENT',
      entityId: payment._id,
      changes: { refundStatus, refundAmount },
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.json({
      success: true,
      message: 'Refund status updated successfully',
      data: payment
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating refund status',
      error: error.message
    });
  }
};

// @desc    Create Razorpay order for an existing order
// @route   POST /api/payments/razorpay/create-order
// @access  Private/Customer
exports.createRazorpayOrder = async (req, res) => {
  try {
    const { orderId } = req.body;
    const customerId = req.customer?._id;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: 'orderId is required'
      });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Ensure the order belongs to the current customer (if logged in)
    if (customerId && order.customer.toString() !== customerId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You are not allowed to pay for this order'
      });
    }

    if (order.paymentStatus === 'PAID') {
      return res.status(400).json({
        success: false,
        message: 'Order is already paid'
      });
    }

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      return res.status(500).json({
        success: false,
        message: 'Razorpay keys are not configured'
      });
    }

    const amountPaise = Math.round(order.total * 100); // Razorpay expects amount in paise

    const razorpayOrderPayload = {
      amount: amountPaise,
      currency: 'INR',
      receipt: order.orderNumber || `order_${order._id}`,
      payment_capture: 1,
      notes: {
        orderId: String(order._id),
        customerId: order.customer ? String(order.customer) : undefined
      }
    };

    const rpResponse = await axios.post(
      'https://api.razorpay.com/v1/orders',
      razorpayOrderPayload,
      {
        auth: {
          username: keyId,
          password: keySecret
        }
      }
    );

    const rpOrder = rpResponse.data;

    // Update payment record with Razorpay info
    let payment = await Payment.findOne({ order: order._id });
    if (!payment) {
      payment = await Payment.create({
        order: order._id,
        customer: order.customer,
        amount: order.total,
        paymentMethod: 'ONLINE',
        paymentGateway: 'RAZORPAY',
        status: 'PENDING',
        gatewayResponse: {
          razorpayOrder: rpOrder
        }
      });
    } else {
      payment.paymentMethod = 'ONLINE';
      payment.paymentGateway = 'RAZORPAY';
      payment.status = 'PENDING';
      payment.gatewayResponse = {
        ...(payment.gatewayResponse || {}),
        razorpayOrder: rpOrder
      };
      await payment.save();
    }

    res.json({
      success: true,
      message: 'Razorpay order created successfully',
      data: {
        key: keyId,
        razorpayOrderId: rpOrder.id,
        amount: rpOrder.amount,
        currency: rpOrder.currency,
        orderId: order._id,
        orderNumber: order.orderNumber,
        customer: {
          name: order.shippingAddress?.name,
          email: order.shippingAddress?.email,
          phone: order.shippingAddress?.phone
        }
      }
    });
  } catch (error) {
    console.error('Error creating Razorpay order:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error creating Razorpay order',
      error: error.message
    });
  }
};

// @desc    Verify Razorpay payment and mark order as paid
// @route   POST /api/payments/razorpay/verify
// @access  Private/Customer
exports.verifyRazorpayPayment = async (req, res) => {
  try {
    const {
      orderId,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    } = req.body;

    if (!orderId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: 'Missing required Razorpay payment details'
      });
    }

    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) {
      return res.status(500).json({
        success: false,
        message: 'Razorpay key secret is not configured'
      });
    }

    const generatedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (generatedSignature !== razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Razorpay signature'
      });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Mark order as paid
    order.paymentStatus = 'PAID';
    order.paymentMethod = 'ONLINE';
    await order.save();

    // Update or create payment record
    let payment = await Payment.findOne({ order: order._id });
    if (!payment) {
      payment = await Payment.create({
        order: order._id,
        customer: order.customer,
        amount: order.total,
        paymentMethod: 'ONLINE',
        paymentGateway: 'RAZORPAY',
        status: 'SUCCESS',
        transactionId: razorpay_payment_id,
        paidAt: new Date(),
        gatewayResponse: {
          razorpay_order_id,
          razorpay_payment_id,
          razorpay_signature
        }
      });
    } else {
      payment.paymentMethod = 'ONLINE';
      payment.paymentGateway = 'RAZORPAY';
      payment.status = 'SUCCESS';
      payment.transactionId = razorpay_payment_id;
      payment.paidAt = new Date();
      payment.gatewayResponse = {
        ...(payment.gatewayResponse || {}),
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature
      };
      await payment.save();
    }

    // Log audit for payment success
    try {
      await AuditLog.create({
        admin: null,
        action: 'CREATE',
        entityType: 'PAYMENT',
        entityId: payment._id,
        changes: { status: 'SUCCESS', paymentGateway: 'RAZORPAY' },
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      });
    } catch {
      // Non-critical
    }

    // Send emails only after successful payment: admin new-order notification + customer confirmation
    try {
      const populatedOrder = await Order.findById(order._id)
        .populate('customer', 'name email phone')
        .populate('items.product', 'name sku images imagesByColor')
        .lean();
      if (populatedOrder) {
        const orderForEmail = { ...populatedOrder, paymentMethod: 'ONLINE', paymentStatus: 'PAID' };
        await sendNewOrderNotification(orderForEmail);
        await sendOrderConfirmationToCustomer(orderForEmail);
      }
    } catch (e) {
      console.warn('Order emails after payment failed:', e.message);
    }

    res.json({
      success: true,
      message: 'Payment verified successfully',
      data: {
        orderId: order._id,
        paymentId: payment._id
      }
    });
  } catch (error) {
    console.error('Error verifying Razorpay payment:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error verifying Razorpay payment',
      error: error.message
    });
  }
};

module.exports = exports;

