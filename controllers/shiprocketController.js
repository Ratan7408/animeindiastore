const Order = require('../models/Order');
const shiprocketService = require('../services/shiprocketService');

/**
 * Verify Shiprocket credentials and connectivity (admin)
 * GET /api/shiprocket/verify – returns success if login works
 */
exports.verify = async (req, res) => {
  try {
    const token = await shiprocketService.getToken();
    res.json({
      success: true,
      message: 'Shiprocket is connected. Credentials are valid.',
      tokenReceived: !!token
    });
  } catch (error) {
    console.error('Shiprocket verify error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Shiprocket verification failed',
      hint: 'Check SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD in .env'
    });
  }
};

/**
 * Create shipment in Shiprocket for an order (shared logic – no HTTP).
 * Used by createShipment (admin) and by auto-ship when order is confirmed.
 * Updates order with tracking + SHIPPED when AWB is obtained.
 * @param {Object} order - Mongoose order doc
 * @param {number} [courierId] - Optional courier_id for assign AWB
 * @returns {Promise<{ awbAssigned, awbNumber, courierName, shiprocketOrderId }>}
 */
async function createShipmentForOrder(order, courierId = null) {
  let shiprocketOrderId = order.shiprocketOrderId;
  let shiprocketShipmentId = order.shiprocketShipmentId;

  if (order.orderStatus === 'CANCELLED' || order.orderStatus === 'RETURNED') {
    throw new Error('Cannot create shipment for cancelled or returned order');
  }

  if (shiprocketOrderId && (shiprocketShipmentId == null || shiprocketShipmentId === '')) {
    const details = await shiprocketService.getOrderDetails(shiprocketOrderId);
    if (details?.shipment_id) {
      shiprocketShipmentId = details.shipment_id;
      order.shiprocketShipmentId = shiprocketShipmentId;
      await order.save();
    }
  }

  let createResult = null;
  if (!shiprocketOrderId) {
    createResult = await shiprocketService.createOrder(order);
    const srOrderId = createResult.order_id ?? createResult.data?.order_id ?? createResult.id;
    const srShipmentId =
      createResult.shipment_id ??
      createResult.data?.shipment_id ??
      createResult.shipments?.[0]?.id ??
      createResult.data?.shipments?.[0]?.id ??
      (Array.isArray(createResult.shipments) && createResult.shipments[0] ? createResult.shipments[0].shipment_id : null);
    if (!srOrderId) throw new Error(createResult.message || 'Failed to create order in Shiprocket');
    shiprocketOrderId = srOrderId;
    shiprocketShipmentId = srShipmentId ?? shiprocketShipmentId;
    order.shiprocketOrderId = shiprocketOrderId;
    if (shiprocketShipmentId != null) order.shiprocketShipmentId = shiprocketShipmentId;
    await order.save();
    const hasAwbFromCreate = !!(createResult.awb_code ?? createResult.data?.awb_code);
    if (!hasAwbFromCreate) await new Promise(r => setTimeout(r, 2500));
  }

  let awbAssigned = false;
  let awbNumber = null;
  let courierName = null;
  const awbFromCreate = createResult?.awb_code ?? createResult?.data?.awb_code;
  if (awbFromCreate) {
    awbNumber = awbFromCreate;
    courierName = createResult?.courier_name ?? createResult?.data?.courier_name ?? 'Shiprocket';
    awbAssigned = true;
  }

  if (!awbAssigned) {
    try {
      // Try assign/awb with only order_id + shipment_id first (Shiprocket may auto-assign).
      const assignWithoutCourier = await shiprocketService.assignAWBWithOptionalCourier(shiprocketOrderId, shiprocketShipmentId);
      if (assignWithoutCourier?.awb_code) {
        awbNumber = assignWithoutCourier.awb_code;
        courierName = assignWithoutCourier.courier_name || 'Shiprocket';
        awbAssigned = true;
      }
      const orderCouriers = assignWithoutCourier?.data?.available_courier_companies ?? assignWithoutCourier?.available_courier_companies ?? (Array.isArray(assignWithoutCourier?.data) ? assignWithoutCourier.data : []);
      if (!awbAssigned && orderCouriers.length > 0) {
        const first = orderCouriers[0];
        const cid = first.id ?? first.courier_company_id ?? first.courier_id;
        if (cid != null) {
          const assignResult = await shiprocketService.assignAWB(shiprocketOrderId, cid, shiprocketShipmentId);
          awbNumber = assignResult?.awb_code || assignResult?.awb || assignResult?.tracking_data?.awb;
          courierName = assignResult?.courier_name || first.name || first.courier_name || 'Shiprocket';
          awbAssigned = !!awbNumber;
        }
      }
      if (!awbAssigned) {
        const deliveryPincode = order.shippingAddress?.pincode || '';
        const totalQty = (order.items || []).reduce((s, i) => s + (i.quantity || 1), 0);
        const weight = Math.max(0.5, Math.min(30, totalQty * 0.5));
        const serviceability = await shiprocketService.checkServiceability(deliveryPincode, weight);
        const raw = serviceability?.data;
        const availableCouriers = Array.isArray(raw)
          ? raw
          : (raw?.available_courier_companies || raw?.data || serviceability?.available_courier_companies || []);
        const courierToUse = courierId
          ? availableCouriers.find(c => c.id == courierId || c.courier_id == courierId || c.courier_company_id == courierId)
          : availableCouriers[0];
        if (courierToUse) {
          // Try rate id (id) first, then courier_company_id – per Shiprocket API docs.
          const cid = courierToUse.id ?? courierToUse.courier_company_id ?? courierToUse.courier_id;
          if (cid != null) {
            const assignResult = await shiprocketService.assignAWB(
              shiprocketOrderId,
              cid,
              shiprocketShipmentId
            );
            awbNumber = assignResult.awb_code || assignResult.awb || assignResult.tracking_data?.awb;
            courierName = assignResult.courier_name || courierToUse.name || courierToUse.courier_name || 'Shiprocket';
            awbAssigned = !!awbNumber;
          }
        }
      }
    } catch (assignErr) {
      const res = assignErr.response;
      console.error('Shiprocket assign AWB error:', res?.status, res?.data || assignErr.message);
      if (res?.data && typeof res.data === 'object') {
        console.error('Shiprocket full response:', JSON.stringify(res.data));
      }
    }
  }

  // If AWB still not assigned, sync from Shiprocket once (try numeric id then orderNumber).
  if (!awbAssigned && shiprocketOrderId) {
    setImmediate(() => {
      const trySync = (full) => {
        if (!full) return;
        const awb = full.awb_code ?? full.data?.awb_code ?? full.shipments?.[0]?.awb_code ?? full.shipments?.[0]?.awb ?? full.data?.shipments?.[0]?.awb_code ?? full.data?.shipments?.[0]?.awb;
        if (awb) {
          order.trackingNumber = String(awb).trim();
          order.shippingProvider = ((full.courier_name ?? full.data?.courier_name ?? full.shipments?.[0]?.courier_name ?? full.data?.shipments?.[0]?.courier_name) || 'Shiprocket').trim();
          order.orderStatus = 'SHIPPED';
          order.shippedAt = new Date();
          order.save().then(() => {
            console.log('[Shiprocket→User] post-create sync: AWB saved for order', order._id, order.trackingNumber);
          }).catch(() => {});
        }
      };
      shiprocketService.getOrderFull(shiprocketOrderId).then((full) => {
        if (full) return trySync(full);
        if (order.orderNumber) {
          return shiprocketService.getOrderFull(order.orderNumber).then(trySync);
        }
      }).catch(() => {});
    });
  }

  if (awbAssigned && awbNumber) {
    order.trackingNumber = awbNumber;
    order.shippingProvider = courierName || 'Shiprocket';
    order.orderStatus = 'SHIPPED';
    order.shippedAt = new Date();
    await order.save();
  }

  return { awbAssigned, awbNumber, courierName, shiprocketOrderId };
}

exports.createShipmentForOrder = createShipmentForOrder;

/**
 * Create shipment in Shiprocket for an order (admin API)
 * 1. Create order in Shiprocket (adhoc)
 * 2. Assign AWB (use first available courier or optional courier_id from body)
 * 3. Update our order with tracking + SHIPPED
 */
exports.createShipment = async (req, res) => {
  try {
    const orderId = req.params.orderId;
    const { courier_id: courierId } = req.body || {};

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const result = await createShipmentForOrder(order, courierId);

    if (!result.awbAssigned) {
      return res.status(200).json({
        success: true,
        message: 'Order created in Shiprocket. Assign AWB failed – assign courier in Shiprocket dashboard, then use Order Update to paste the AWB.',
        shiprocket_order_id: result.shiprocketOrderId,
        awb_assigned: false,
        data: {
          shiprocket_order_id: result.shiprocketOrderId,
          awb: null,
          courier: null,
          order_status: order.orderStatus,
          tracking_number: order.trackingNumber
        }
      });
    }

    res.json({
      success: true,
      message: 'Shipment created and AWB assigned',
      data: {
        shiprocket_order_id: result.shiprocketOrderId,
        awb: result.awbNumber,
        courier: result.courierName,
        order_status: order.orderStatus,
        tracking_number: order.trackingNumber
      }
    });
  } catch (error) {
    console.error('Shiprocket createShipment error:', error?.response?.data || error);
    const status = error.response?.status;
    const data = error.response?.data;
    const msg = data?.message || data?.errors ? JSON.stringify(data.errors || data) : error.message;
    const code = status === 422 ? 422 : status === 400 ? 400 : 500;
    res.status(code).json({
      success: false,
      message: status === 422 ? `Shiprocket validation: ${msg}` : (error.message || 'Failed to create shipment'),
      error: data
    });
  }
};

/**
 * Track shipment by AWB (admin or customer)
 */
exports.trackShipment = async (req, res) => {
  try {
    const { awb } = req.params;
    if (!awb) {
      return res.status(400).json({ success: false, message: 'AWB required' });
    }
    const result = await shiprocketService.track(awb.trim());
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Shiprocket track error:', error);
    res.status(error.response?.status === 404 ? 404 : 500).json({
      success: false,
      message: error.response?.data?.message || error.message || 'Tracking failed',
      error: error.response?.data
    });
  }
};

/**
 * Sync tracking for the most recent order that has shiprocketOrderId.
 * POST /api/shiprocket/sync-last-order – no need to pass order id; use for quick testing.
 */
exports.syncLastOrder = async (req, res) => {
  try {
    const order = await Order.findOne({ shiprocketOrderId: { $exists: true, $ne: null } })
      .sort({ createdAt: -1 });
    if (!order) {
      return res.status(404).json({ success: false, message: 'No order found that is in Shiprocket.' });
    }
    req.params.orderId = order._id.toString();
    return exports.syncTracking(req, res);
  } catch (error) {
    console.error('Shiprocket syncLastOrder error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Sync failed',
      error: error.response?.data
    });
  }
};

/**
 * Sync tracking from Shiprocket: GET order view, if AWB present update our order.
 * Use when order is in Shiprocket but AWB was assigned in dashboard (or auto-assigned later).
 */
exports.syncTracking = async (req, res) => {
  try {
    const orderId = req.params.orderId;
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    const srId = order.shiprocketOrderId;
    if (!srId) {
      return res.status(400).json({ success: false, message: 'Order not in Shiprocket. Confirm order first to create shipment.' });
    }
    let full = await shiprocketService.getOrderFull(srId);
    if (!full && order.orderNumber) {
      full = await shiprocketService.getOrderFull(order.orderNumber);
    }
    if (!full) {
      return res.status(502).json({ success: false, message: 'Could not fetch order from Shiprocket. Try again after assigning courier in Shiprocket dashboard.' });
    }
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
    const courierName =
      full.courier_name ??
      full.data?.courier_name ??
      full.shipments?.[0]?.courier_name ??
      full.data?.shipments?.[0]?.courier_name;
    if (awb) {
      order.trackingNumber = String(awb).trim();
      if (courierName) order.shippingProvider = String(courierName).trim();
      if (order.orderStatus !== 'SHIPPED') {
        order.orderStatus = 'SHIPPED';
        order.shippedAt = new Date();
      }
      await order.save();
      return res.json({
        success: true,
        message: 'Tracking synced from Shiprocket',
        data: { trackingNumber: order.trackingNumber, courier: order.shippingProvider }
      });
    }
    res.json({
      success: true,
      message: 'No AWB yet in Shiprocket. Assign courier in Shiprocket dashboard, then sync again.',
      data: { trackingNumber: null }
    });
  } catch (error) {
    console.error('Shiprocket syncTracking error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Sync failed',
      error: error.response?.data
    });
  }
};

/**
 * Get available couriers for a Shiprocket order (admin) – for manual courier selection
 */
exports.getAvailableCouriers = async (req, res) => {
  try {
    const orderId = req.params.orderId;
    const order = await Order.findById(orderId).select('shippingAddress items');
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    const pincode = order.shippingAddress?.pincode || '';
    const totalQty = (order.items || []).reduce((s, i) => s + (i.quantity || 1), 0);
    const weight = Math.max(0.5, Math.min(30, totalQty * 0.5));
    const serviceability = await shiprocketService.checkServiceability(pincode, weight);
    const raw = serviceability?.data;
    const list = Array.isArray(raw) ? raw : (raw?.available_courier_companies || raw?.data || serviceability?.available_courier_companies || []);
    res.json({ success: true, data: list });
  } catch (error) {
    console.error('Shiprocket getCouriers error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch couriers',
      error: error.response?.data
    });
  }
};
