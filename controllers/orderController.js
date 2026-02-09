const Order = require('../models/Order');
const Product = require('../models/Product');
const Customer = require('../models/Customer');
const Payment = require('../models/Payment');
const AuditLog = require('../models/AuditLog');
const Coupon = require('../models/Coupon');
const Settings = require('../models/Settings');
const shiprocketController = require('./shiprocketController');
const shiprocketService = require('../services/shiprocketService');
const axios = require('axios');
const {
  sendNewOrderNotification,
  sendOrderConfirmationToCustomer
} = require('../utils/emailService');

/** Sync tracking from Shiprocket for one order (if in Shiprocket but no AWB yet). Used when customer views orders. */
async function syncOrderTrackingFromShiprocket(order) {
  if (!order.shiprocketOrderId || order.trackingNumber) {
    if (!order.shiprocketOrderId) {
      console.log('[Shiprocket→User] sync skip: order', order._id, 'has no shiprocketOrderId');
    } else {
      console.log('[Shiprocket→User] sync skip: order', order._id, 'already has trackingNumber=', order.trackingNumber);
    }
    return order;
  }
  console.log('[Shiprocket→User] sync start: order', order._id, 'shiprocketOrderId=', order.shiprocketOrderId, 'orderNumber=', order.orderNumber, '→ fetching from Shiprocket');
  try {
    let full = await shiprocketService.getOrderFull(order.shiprocketOrderId);
    if (!full && order.orderNumber) {
      console.log('[Shiprocket→User] sync retry: trying with orderNumber (external id)', order.orderNumber);
      full = await shiprocketService.getOrderFull(order.orderNumber);
    }
    if (!full) {
      console.log('[Shiprocket→User] sync fail: getOrderFull returned null for order', order._id);
      return order;
    }
    const fullKeys = full && typeof full === 'object' ? Object.keys(full) : [];
    let awb =
      full.awb_code ??
      full.awb ??
      full.data?.awb_code ??
      full.data?.awb ??
      full.order?.awb_code ??
      full.order?.awb ??
      full.data?.order?.awb_code ??
      full.data?.order?.awb ??
      full.shipments?.[0]?.awb_code ??
      full.shipments?.[0]?.awb ??
      full.data?.shipments?.[0]?.awb_code ??
      full.data?.shipments?.[0]?.awb;
    if (!awb && Array.isArray(full.shipments)) {
      const s = full.shipments.find(x => x?.awb_code || x?.awb);
      awb = s?.awb_code ?? s?.awb;
    }
    if (!awb && Array.isArray(full.data?.shipments)) {
      const s = full.data.shipments.find(x => x?.awb_code || x?.awb);
      awb = s?.awb_code ?? s?.awb;
    }
    if (!awb && full.order?.shipments?.[0]) {
      awb = full.order.shipments[0].awb_code ?? full.order.shipments[0].awb;
    }
    if (!awb && full.data?.order?.shipments?.[0]) {
      awb = full.data.order.shipments[0].awb_code ?? full.data.order.shipments[0].awb;
    }
    if (!awb) {
      console.log('[Shiprocket→User] sync: no AWB found in response for order', order._id, '| full topKeys=', fullKeys.join(','));
      return order;
    }
    console.log('[Shiprocket→User] sync: AWB found=', awb, '→ saving to order', order._id, '→ tracking sent to user');
    order.trackingNumber = String(awb).trim();
    const courierName =
      full.courier_name ??
      full.data?.courier_name ??
      full.shipments?.[0]?.courier_name ??
      full.data?.shipments?.[0]?.courier_name;
    order.shippingProvider = courierName ? String(courierName).trim() : 'Shiprocket';
    order.orderStatus = 'SHIPPED';
    order.shippedAt = new Date();
    await order.save();
    console.log('[Shiprocket→User] sync done: order', order._id, 'trackingNumber=', order.trackingNumber, '| user will see it on My Orders');
  } catch (err) {
    console.warn('[Shiprocket→User] sync error for order', order._id, '|', err.message);
  }
  return order;
}

/** Automatically refund Razorpay payment when an order is cancelled (full refund). */
async function refundRazorpayPaymentIfNeeded(order, req) {
  try {
    // Only consider fully paid online orders
    if (order.paymentStatus !== 'PAID' || order.paymentMethod !== 'ONLINE') {
      return;
    }

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
      console.warn('[Razorpay Refund] Keys not configured, skipping refund for order', order._id);
      return;
    }

    const payment = await Payment.findOne({
      order: order._id,
      paymentGateway: 'RAZORPAY'
    });

    if (!payment) {
      console.warn('[Razorpay Refund] No Razorpay payment record found for order', order._id);
      return;
    }

    // Already refunded or in process
    if (payment.status === 'REFUNDED' || payment.refundStatus === 'COMPLETED') {
      return;
    }

    if (!payment.transactionId) {
      console.warn('[Razorpay Refund] Missing Razorpay payment id (transactionId) for payment', payment._id);
      return;
    }

    const amountPaise = Math.round((payment.amount || order.total || 0) * 100);
    if (!amountPaise || amountPaise <= 0) {
      console.warn('[Razorpay Refund] Invalid refund amount for payment', payment._id);
      return;
    }

    console.log('[Razorpay Refund] Initiating refund for order', order._id, 'payment', payment.transactionId, 'amount', amountPaise);

    const rpRes = await axios.post(
      `https://api.razorpay.com/v1/payments/${payment.transactionId}/refund`,
      { amount: amountPaise },
      {
        auth: {
          username: keyId,
          password: keySecret
        },
        timeout: 15000
      }
    );

    const refund = rpRes.data;

    payment.refundStatus = 'COMPLETED';
    payment.status = 'REFUNDED';
    payment.refundAmount = (amountPaise / 100);
    payment.refundTransactionId = refund.id;
    payment.refundedAt = new Date();
    await payment.save();

    // Mark order payment status as refunded as well
    order.paymentStatus = 'REFUNDED';
    await order.save();

    // Log audit entry (non-blocking)
    try {
      await AuditLog.create({
        admin: req && req.admin ? req.admin._id : null,
        action: 'UPDATE',
        entityType: 'PAYMENT',
        entityId: payment._id,
        changes: { refundStatus: 'COMPLETED', status: 'REFUNDED', refundAmount: payment.refundAmount },
        ipAddress: req ? req.ip : '',
        userAgent: req ? req.get('user-agent') : ''
      });
    } catch {
      // Ignore audit failures
    }

    console.log('[Razorpay Refund] Refund completed for order', order._id, 'payment', payment._id);
  } catch (err) {
    console.error('[Razorpay Refund] Error processing refund for order', order._id, '|', err.message);
  }
}

// @desc    Create new order
// @route   POST /api/orders
// @access  Private/Customer
exports.createOrder = async (req, res) => {
  try {
    const { items, shippingAddress, paymentMethod, couponCode } = req.body;
    const customerId = req.customer?._id;

    // Validate required fields
    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Order must contain at least one item'
      });
    }

    if (!shippingAddress || typeof shippingAddress !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'Shipping address is required'
      });
    }

    const email = (shippingAddress.email || '').toString().trim();
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Shipping address email is required'
      });
    }

    // Normalize product id (accept product or productId, string or object with _id)
    const getProductId = (item) => {
      const p = item.product;
      const id = item.productId;
      if (p && typeof p === 'object' && p._id) return p._id.toString();
      if (p && typeof p === 'string') return p.trim();
      if (id && typeof id === 'string') return id.trim();
      if (id && typeof id === 'object' && id._id) return id._id.toString();
      return null;
    };

    // Calculate order totals
    let subtotal = 0;
    const orderItems = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const productId = getProductId(item);
      if (!productId || !/^[a-fA-F0-9]{24}$/.test(productId)) {
        return res.status(400).json({
          success: false,
          message: `Item ${i + 1}: valid product ID is required`
        });
      }
      const product = await Product.findById(productId);
      if (!product) {
        return res.status(400).json({
          success: false,
          message: `Product not found (ID: ${productId}). It may have been removed. Please refresh the cart and try again.`
        });
      }

      const quantity = Math.max(1, parseInt(Number(item.quantity), 10) || 1);
      if (!Number.isFinite(quantity) || quantity < 1) {
        return res.status(400).json({
          success: false,
          message: `Invalid quantity for ${product.name}`
        });
      }

      const itemPrice = item.price || (product.discount > 0
        ? Math.round(product.price * (1 - product.discount / 100))
        : product.price);

      const itemTotal = itemPrice * quantity;
      subtotal += itemTotal;

      // Get product image (use color-specific if available)
      let productImage = product.images && product.images[0] ? product.images[0] : null;
      if (item.color && product.imagesByColor && product.imagesByColor.get(item.color)) {
        const colorImages = product.imagesByColor.get(item.color);
        if (colorImages && colorImages.length > 0) {
          productImage = colorImages[0];
        }
      }

      orderItems.push({
        product: product._id,
        name: item.productName || product.name,
        sku: product.sku || 'N/A',
        price: itemPrice,
        discount: item.discount || product.discount || 0,
        quantity,
        size: item.size,
        color: item.color,
        image: productImage
      });

      // Update stock
      // Check stock - use size-specific stock if available and > 0, otherwise fall back to general stockQuantity
      let stockAvailable = product.stockQuantity || 0;
      let stockToUpdate = 'stockQuantity';
      let useSizeSpecificStock = false;
      
      if (item.size && product.stockBySize) {
        // stockBySize is an object, not a Map
        const sizeStock = product.stockBySize[item.size];
        
        // Only use size-specific stock if it's explicitly set and greater than 0
        // If it's 0 or undefined, fall back to general stockQuantity
        if (sizeStock !== undefined && sizeStock !== null && sizeStock > 0) {
          stockAvailable = sizeStock;
          stockToUpdate = 'stockBySize';
          useSizeSpecificStock = true;
        }
      }
      
      // Final stock check
      if (stockAvailable < quantity) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for ${product.name}${item.size ? ` - Size ${item.size}` : ''}. Available: ${stockAvailable}, Required: ${quantity}`
        });
      }
      
      // Update stock
      if (useSizeSpecificStock && item.size) {
        product.stockBySize[item.size] = stockAvailable - quantity;
      }
      // Always update general stockQuantity as well
      product.stockQuantity = (product.stockQuantity || 0) - quantity;
      
      await product.save();
    }

    // Calculate shipping from admin settings (free above threshold)
    const settings = await Settings.getSettings();
    const settingsShipping = Math.max(0, Number(settings.shippingCharges) || 0);
    const freeThreshold = Math.max(0, Number(settings.freeShippingThreshold) || 0);
    const shippingCharges = (freeThreshold > 0 && subtotal >= freeThreshold) ? 0 : settingsShipping;

    // Apply coupon if provided
    let discount = 0;
    let appliedCoupon = null;
    if (couponCode) {
      const coupon = await Coupon.findOne({ code: couponCode.toUpperCase(), isActive: true });
      if (coupon) {
        const now = new Date();
        // Check if coupon has started
        const hasStarted = !coupon.validFrom || coupon.validFrom <= now;
        // Check if coupon has expired (only if validUntil is set)
        const notExpired = !coupon.validUntil || coupon.validUntil >= now;
        
        if (hasStarted && notExpired) {
          // Check usage limit
          if (coupon.usageLimit === null || coupon.usedCount < coupon.usageLimit) {
            // Check minimum cart value
            if (subtotal >= coupon.minCartValue) {
              if (coupon.discountType === 'PERCENTAGE') {
                discount = subtotal * (coupon.discountValue / 100);
                if (coupon.maxDiscount && discount > coupon.maxDiscount) {
                  discount = coupon.maxDiscount;
                }
              } else {
                discount = coupon.discountValue;
              }
              discount = Math.min(discount, subtotal);
              appliedCoupon = coupon;
            }
          }
        }
      }
    }

    // Calculate total
    const total = Math.max(0, subtotal - discount + shippingCharges);

    // Create or get customer
    let customer;
    if (customerId) {
      customer = await Customer.findById(customerId);
    } else {
      // Create guest customer from shipping address
      // Use case-insensitive email search
      customer = await Customer.findOne({ 
        email: { $regex: new RegExp(`^${shippingAddress.email}$`, 'i') }
      });
      
      if (!customer) {
        try {
          customer = await Customer.create({
            name: `${shippingAddress.firstName} ${shippingAddress.lastName}`.trim(),
            email: shippingAddress.email.toLowerCase().trim(),
            phone: shippingAddress.phone
          });
        } catch (createError) {
          // If creation fails (e.g., duplicate email), try to find again
          customer = await Customer.findOne({ 
            email: { $regex: new RegExp(`^${shippingAddress.email}$`, 'i') }
          });
          
          if (!customer) {
            throw createError; // Re-throw if still not found
          }
        }
      }
    }

    // Format shipping address
    const formattedShippingAddress = {
      name: `${shippingAddress.firstName} ${shippingAddress.lastName}`.trim(),
      firstName: shippingAddress.firstName,
      lastName: shippingAddress.lastName,
      email: shippingAddress.email,
      phone: shippingAddress.phone,
      address: shippingAddress.street || shippingAddress.address,
      street: shippingAddress.street || shippingAddress.address,
      city: shippingAddress.city,
      state: shippingAddress.state,
      pincode: shippingAddress.pincode,
      country: shippingAddress.country || 'India',
      type: shippingAddress.type || 'HOME',
      landmark: shippingAddress.landmark || ''
    };

    // Generate order number before creating order
    const orderCount = await Order.countDocuments();
    const orderNumber = `ORD${Date.now()}${String(orderCount + 1).padStart(4, '0')}`;
    
    // Ensure shippingAddress is a plain object (not a Mongoose document)
    const shippingAddressData = {
      name: formattedShippingAddress.name,
      firstName: formattedShippingAddress.firstName,
      lastName: formattedShippingAddress.lastName,
      email: formattedShippingAddress.email,
      phone: formattedShippingAddress.phone,
      address: formattedShippingAddress.address,
      street: formattedShippingAddress.street,
      city: formattedShippingAddress.city,
      state: formattedShippingAddress.state,
      pincode: formattedShippingAddress.pincode,
      country: formattedShippingAddress.country || 'India',
      type: formattedShippingAddress.type,
      landmark: formattedShippingAddress.landmark || ''
    };
    
    const order = await Order.create({
      orderNumber: orderNumber,
      customer: customer._id,
      items: orderItems,
      shippingAddress: shippingAddressData,
      subtotal,
      shippingCharges,
      discount,
      couponCode: appliedCoupon ? appliedCoupon.code : null,
      total,
      paymentMethod: paymentMethod || 'COD',
      paymentStatus: paymentMethod === 'COD' ? 'PENDING' : 'PENDING',
      orderStatus: 'PENDING'
    });

    // Create payment record
    await Payment.create({
      order: order._id,
      customer: customer._id,
      amount: total,
      paymentMethod: paymentMethod || 'COD',
      status: paymentMethod === 'COD' ? 'PENDING' : 'PENDING'
    });

    // Populate order for response
    const populatedOrder = await Order.findById(order._id)
      .populate('customer', 'name email phone')
      .populate('items.product', 'name sku images imagesByColor');

    // Build order for customer email: ensure each item has image from order we just created
    const emailOrderObj = populatedOrder.toObject();
    emailOrderObj.items = (emailOrderObj.items || []).map((it, i) => ({
      ...it,
      image: it.image || (orderItems[i] && orderItems[i].image) || undefined
    }));

    // Emails only for COD here. For ONLINE, send nothing until payment is successful (see paymentController.verifyRazorpayPayment).
    if (paymentMethod === 'COD') {
      try {
        await sendNewOrderNotification({
          ...populatedOrder.toObject(),
          paymentMethod: 'COD',
          paymentStatus: 'PENDING'
        });
        await sendOrderConfirmationToCustomer({
          ...emailOrderObj,
          paymentMethod: 'COD',
          paymentStatus: 'PENDING'
        });
      } catch (e) {
        console.warn('Order email failed:', e.message);
      }
    }

    res.status(201).json({
      success: true,
      message: 'Order placed successfully',
      data: populatedOrder
    });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating order',
      error: error.message
    });
  }
};

// @desc    Get customer's orders
// @route   GET /api/orders/my-orders
// @access  Private/Customer
exports.getMyOrders = async (req, res) => {
  // #region agent log
  const fs = require('fs');
  const logPath = 'c:\\Users\\RATAN\\Desktop\\animeweb\\.cursor\\debug.log';
  const logEntry = {
    location: 'orderController.js:250',
    message: 'getMyOrders called',
    data: {
      hasCustomer: !!req.customer,
      customerId: req.customer?._id?.toString() || null,
      customerEmail: req.customer?.email || null
    },
    timestamp: Date.now(),
    sessionId: 'debug-session',
    runId: 'run1',
    hypothesisId: 'A'
  };
  try {
    fs.appendFileSync(logPath, JSON.stringify(logEntry) + '\n');
  } catch (e) {}
  // #endregion
  
  try {
    if (!req.customer || !req.customer._id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Please login to view your orders.'
      });
    }
    
    const customerId = req.customer._id;
    
    // #region agent log
    const logEntry2 = {
      location: 'orderController.js:270',
      message: 'Querying orders',
      data: {
        customerId: customerId.toString(),
        query: { customer: customerId }
      },
      timestamp: Date.now(),
      sessionId: 'debug-session',
      runId: 'run1',
      hypothesisId: 'B'
    };
    try {
      fs.appendFileSync(logPath, JSON.stringify(logEntry2) + '\n');
    } catch (e) {}
    // #endregion
    
    const orders = await Order.find({ customer: customerId })
      .populate('items.product', 'name sku images imagesByColor')
      .sort({ createdAt: -1 });

    // Sync tracking from Shiprocket for orders that are in Shiprocket but don't have AWB yet (e.g. admin assigned in dashboard)
    const toSync = orders.filter(o => o.shiprocketOrderId && !o.trackingNumber);
    if (toSync.length > 0) {
      console.log('[Shiprocket→User] getMyOrders: customer viewing orders → syncing', toSync.length, 'order(s) from Shiprocket (AWB→user)');
    }
    await Promise.allSettled(toSync.map(o => syncOrderTrackingFromShiprocket(o)));

    // #region agent log
    const logEntry3 = {
      location: 'orderController.js:280',
      message: 'Orders found',
      data: {
        ordersCount: orders.length,
        orderIds: orders.map(o => o._id.toString())
      },
      timestamp: Date.now(),
      sessionId: 'debug-session',
      runId: 'run1',
      hypothesisId: 'C'
    };
    try {
      fs.appendFileSync(logPath, JSON.stringify(logEntry3) + '\n');
    } catch (e) {}
    // #endregion

    res.json({
      success: true,
      count: orders.length,
      data: orders
    });
  } catch (error) {
    // #region agent log
    const logError = {
      location: 'orderController.js:295',
      message: 'Error in getMyOrders',
      data: {
        errorMessage: error.message,
        errorStack: error.stack,
        errorName: error.name
      },
      timestamp: Date.now(),
      sessionId: 'debug-session',
      runId: 'run1',
      hypothesisId: 'D'
    };
    try {
      fs.appendFileSync(logPath, JSON.stringify(logError) + '\n');
    } catch (e) {}
    // #endregion
    
    console.error('Error fetching customer orders:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching orders',
      error: error.message
    });
  }
};

// @desc    Get all orders
// @route   GET /api/orders
// @access  Private/Admin
exports.getAllOrders = async (req, res) => {
  try {
    const {
      status,
      paymentStatus,
      paymentMethod,
      startDate,
      endDate,
      search,
      page = 1,
      limit = 50,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const query = {};

    if (status) {
      query.orderStatus = status;
    }

    if (paymentStatus) {
      query.paymentStatus = paymentStatus;
    }

    if (paymentMethod) {
      query.paymentMethod = paymentMethod;
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    if (search) {
      query.$or = [
        { orderNumber: { $regex: search, $options: 'i' } },
        { 'shippingAddress.name': { $regex: search, $options: 'i' } },
        { 'shippingAddress.phone': { $regex: search, $options: 'i' } }
      ];
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    const orders = await Order.find(query)
      .populate('customer', 'name email phone')
      .populate('items.product', 'name sku images imagesByColor')
      .sort(sort)
      .skip(skip)
      .limit(limitNum);

    const total = await Order.countDocuments(query);

    res.json({
      success: true,
      count: orders.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
      data: orders
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching orders',
      error: error.message
    });
  }
};

// @desc    Get customer's single order
// @route   GET /api/orders/my-orders/:id
// @access  Private/Customer
exports.getMyOrder = async (req, res) => {
  try {
    if (!req.customer || !req.customer._id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Please login to view your order.'
      });
    }
    
    const order = await Order.findById(req.params.id)
      .populate('items.product', 'name sku images imagesByColor');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }
    
    // Verify the order belongs to the customer
    if (order.customer.toString() !== req.customer._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view this order'
      });
    }

    // Sync tracking from Shiprocket if order is in Shiprocket but we don't have AWB yet (e.g. admin assigned in dashboard)
    if (order.shiprocketOrderId && !order.trackingNumber) {
      console.log('[Shiprocket→User] getMyOrder: customer viewing order', order._id, '→ syncing from Shiprocket');
    }
    await syncOrderTrackingFromShiprocket(order);

    res.json({
      success: true,
      data: order
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching order',
      error: error.message
    });
  }
};

// @desc    Get single order
// @route   GET /api/orders/:id
// @access  Private/Admin
exports.getOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('customer')
      .populate('items.product', 'name sku images imagesByColor');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    res.json({
      success: true,
      data: order
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching order',
      error: error.message
    });
  }
};

// @desc    Update order status
// @route   PUT /api/orders/:id/status
// @access  Private/Admin
exports.updateOrderStatus = async (req, res) => {
  try {
    const { status, trackingNumber, shippingProvider, notes, internalNotes } = req.body;

    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const oldStatus = order.orderStatus;
    order.orderStatus = status;

    if (status === 'SHIPPED') {
      order.shippedAt = new Date();
      if (trackingNumber) order.trackingNumber = trackingNumber;
      if (shippingProvider) order.shippingProvider = shippingProvider;
    }

    if (status === 'DELIVERED') {
      order.deliveredAt = new Date();
    }

    if (status === 'CANCELLED') {
      order.cancelledAt = new Date();
      order.cancelledReason = req.body.cancelledReason || '';
      
      // Restore stock
      for (const item of order.items) {
        const product = await Product.findById(item.product);
        if (product) {
          if (item.size && product.stockBySize) {
            product.stockBySize[item.size] = (product.stockBySize[item.size] || 0) + item.quantity;
          }
          product.stockQuantity = (product.stockQuantity || 0) + item.quantity;
          await product.save();
        }
      }

      // Auto-refund Razorpay payment (if applicable)
      await refundRazorpayPaymentIfNeeded(order, req);
    }

    if (notes) order.notes = notes;
    if (internalNotes) order.internalNotes = internalNotes;

    await order.save();

    // When admin confirms order: auto-create shipment in Shiprocket and get tracking (no manual AWB paste)
    if (status === 'CONFIRMED' && !order.shiprocketOrderId && order.orderStatus !== 'CANCELLED' && order.orderStatus !== 'RETURNED') {
      setImmediate(() => {
        shiprocketController.createShipmentForOrder(order).then((result) => {
          if (result.awbAssigned) {
            console.log('Auto Shiprocket: order', order._id, 'AWB', result.awbNumber);
          }
        }).catch((err) => {
          console.error('Auto Shiprocket create shipment error:', err.message);
        });
      });
    }

    // Log audit
    await AuditLog.create({
      admin: req.admin._id,
      action: 'UPDATE',
      entityType: 'ORDER',
      entityId: order._id,
      changes: { orderStatus: { from: oldStatus, to: status } },
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.json({
      success: true,
      message: 'Order status updated successfully',
      data: order
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating order status',
      error: error.message
    });
  }
};

// @desc    Mark COD order as paid
// @route   PUT /api/orders/:id/mark-paid
// @access  Private/Admin
exports.markOrderAsPaid = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    if (order.paymentMethod !== 'COD') {
      return res.status(400).json({
        success: false,
        message: 'Only COD orders can be marked as paid'
      });
    }

    order.paymentStatus = 'PAID';
    await order.save();

    // Update payment record
    let payment = await Payment.findOne({ order: order._id });
    if (payment) {
      payment.status = 'SUCCESS';
      payment.paidAt = new Date();
      await payment.save();
    } else {
      payment = await Payment.create({
        order: order._id,
        customer: order.customer,
        amount: order.total,
        paymentMethod: 'COD',
        status: 'SUCCESS',
        paidAt: new Date()
      });
    }

    // Log audit
    await AuditLog.create({
      admin: req.admin._id,
      action: 'UPDATE',
      entityType: 'ORDER',
      entityId: order._id,
      changes: { paymentStatus: { from: 'PENDING', to: 'PAID' } },
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.json({
      success: true,
      message: 'Order marked as paid successfully',
      data: order
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error marking order as paid',
      error: error.message
    });
  }
};

// @desc    Get order statistics
// @route   GET /api/orders/stats
// @access  Private/Admin
exports.getOrderStats = async (req, res) => {
  try {
    const { period = 'all' } = req.query; // all, today, week, month

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
      totalOrders,
      pendingOrders,
      confirmedOrders,
      shippedOrders,
      deliveredOrders,
      returnedOrders,
      cancelledOrders,
      totalRevenue,
      codOrders,
      onlineOrders
    ] = await Promise.all([
      Order.countDocuments(dateFilter),
      Order.countDocuments({ ...dateFilter, orderStatus: 'PENDING' }),
      Order.countDocuments({ ...dateFilter, orderStatus: 'CONFIRMED' }),
      Order.countDocuments({ ...dateFilter, orderStatus: 'SHIPPED' }),
      Order.countDocuments({ ...dateFilter, orderStatus: 'DELIVERED' }),
      Order.countDocuments({ ...dateFilter, orderStatus: 'RETURNED' }),
      Order.countDocuments({ ...dateFilter, orderStatus: 'CANCELLED' }),
      Order.aggregate([
        { $match: { ...dateFilter, paymentStatus: 'PAID' } },
        { $group: { _id: null, total: { $sum: '$total' } } }
      ]),
      Order.countDocuments({ ...dateFilter, paymentMethod: 'COD' }),
      Order.countDocuments({ ...dateFilter, paymentMethod: 'ONLINE' })
    ]);

    res.json({
      success: true,
      data: {
        totalOrders,
        byStatus: {
          pending: pendingOrders,
          confirmed: confirmedOrders,
          shipped: shippedOrders,
          delivered: deliveredOrders,
          returned: returnedOrders,
          cancelled: cancelledOrders
        },
        totalRevenue: totalRevenue[0]?.total || 0,
        byPaymentMethod: {
          cod: codOrders,
          online: onlineOrders
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching order statistics',
      error: error.message
    });
  }
};

module.exports = exports;

