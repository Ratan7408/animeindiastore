const Order = require('../models/Order');
const shiprocketService = require('../services/shiprocketService');

/**
 * Shiprocket webhook: Settings → API / Webhooks → URL = POST {BACKEND_URL}/api/shiprocket/webhook
 * Token in dashboard = same value as SHIPROCKET_WEBHOOK_SECRET (sent as X-Api-Key or Authorization Bearer).
 */

function verifyShiprocketWebhookSecret(req) {
  const secret = process.env.SHIPROCKET_WEBHOOK_SECRET;
  if (!secret || String(secret).trim() === '') {
    return true;
  }
  const auth = req.headers.authorization;
  const bearer = auth && /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, '').trim() : '';
  const fromHeader =
    req.headers['x-api-key'] ||
    req.headers['x-shiprocket-secret'] ||
    bearer ||
    '';
  const fromQuery = req.query && req.query.secret != null ? String(req.query.secret) : '';
  const ok = fromHeader === secret || fromQuery === secret;
  return ok;
}

function normalizeWebhookPayload(body) {
  const b = body && typeof body === 'object' ? body : {};
  const nested = b.data && typeof b.data === 'object' ? b.data : {};
  const merge = { ...nested, ...b };
  const orderId = merge.order_id ?? merge.orderId ?? merge.sr_order_id;
  const shipmentId = merge.shipment_id ?? merge.shipmentId;
  const channelOrderId =
    merge.channel_order_id ?? merge.retailer_order_number ?? merge.order;
  const statusRaw =
    merge.status ??
    merge.shipment_status ??
    merge.current_status ??
    merge.current_status_name ??
    merge.shipment_status_name;
  const awb =
    merge.awb_code ??
    merge.awb ??
    merge.tracking_number ??
    merge.tracking_no;
  const courier = merge.courier_name ?? merge.courier;
  return {
    orderId: orderId != null ? orderId : null,
    shipmentId: shipmentId != null ? shipmentId : null,
    channelOrderId: channelOrderId != null ? String(channelOrderId).trim() : '',
    statusRaw: statusRaw != null ? String(statusRaw).trim() : '',
    awb: awb != null ? String(awb).trim() : '',
    courier: courier != null ? String(courier).trim() : ''
  };
}

function mapShiprocketStatusToOrderStatus(statusRaw) {
  if (!statusRaw || typeof statusRaw !== 'string') return null;
  const s = statusRaw.trim().toLowerCase();
  if (s.includes('deliver') && !s.includes('undeliver')) return 'DELIVERED';
  if (s.includes('cancel')) return 'CANCELLED';
  if (s.includes('rto') || s.includes('return to origin') || s === 'returned' || s.includes('reverse')) {
    return 'RETURNED';
  }
  if (
    s.includes('ship') ||
    s.includes('dispatch') ||
    s.includes('transit') ||
    s.includes('picked') ||
    s.includes('pickup') ||
    s.includes('manifest') ||
    s.includes('out for delivery') ||
    s.includes('ofd') ||
    s.includes('in transit')
  ) {
    return 'SHIPPED';
  }
  if (s.includes('confirm') || s.includes('process') || s.includes('new order') || s.includes('pack')) {
    return 'CONFIRMED';
  }
  if (s.includes('pending')) return 'PENDING';
  return null;
}

function shouldApplyOrderStatus(current, next) {
  if (!next) return false;
  if (next === 'CANCELLED' || next === 'RETURNED') return true;
  if (current === 'CANCELLED' || current === 'RETURNED') return false;
  if (current === 'DELIVERED' && next !== 'RETURNED' && next !== 'CANCELLED') return false;
  const rank = { PENDING: 1, CONFIRMED: 2, SHIPPED: 3, DELIVERED: 4 };
  return (rank[next] || 0) >= (rank[current] || 0);
}

async function findOrderForWebhook({ orderId, shipmentId, channelOrderId }) {
  const sid = shipmentId != null ? String(shipmentId).trim() : '';
  if (sid && /^\d+$/.test(sid)) {
    const o = await Order.findOne({ shiprocketShipmentId: Number(sid) });
    if (o) return o;
  }
  const oid = orderId != null ? String(orderId).trim() : '';
  if (oid && /^\d+$/.test(oid)) {
    const num = Number(oid);
    const o = await Order.findOne({ shiprocketOrderId: num });
    if (o) return o;
  }
  if (oid) {
    const o = await Order.findOne({ orderNumber: oid });
    if (o) return o;
  }
  if (channelOrderId) {
    const o = await Order.findOne({ orderNumber: channelOrderId });
    if (o) return o;
  }
  return null;
}

/**
 * POST /api/shiprocket/webhook — Shiprocket pushes shipment status; updates local order for admin panel.
 * No JWT: secured by SHIPROCKET_WEBHOOK_SECRET when set.
 */
exports.webhook = async (req, res) => {
  try {
    if (!verifyShiprocketWebhookSecret(req)) {
      return res.status(401).json({ success: false, message: 'Invalid or missing webhook secret' });
    }
    const payload = normalizeWebhookPayload(req.body);
    const mapped = mapShiprocketStatusToOrderStatus(payload.statusRaw);

    if (!payload.orderId && !payload.shipmentId && !payload.channelOrderId) {
      return res.status(400).json({
        success: false,
        message: 'Payload must include order_id, shipment_id, or channel_order_id'
      });
    }

    const order = await findOrderForWebhook(payload);
    if (!order) {
      console.warn('[Shiprocket webhook] No local order match', {
        orderId: payload.orderId,
        shipmentId: payload.shipmentId,
        channelOrderId: payload.channelOrderId || undefined
      });
      return res.status(200).json({
        success: true,
        matched: false,
        message: 'Received — no matching order in database'
      });
    }

    let changed = false;
    if (payload.awb) {
      order.trackingNumber = payload.awb;
      changed = true;
    }
    if (payload.courier) {
      order.shippingProvider = payload.courier;
      changed = true;
    }
    if (mapped && shouldApplyOrderStatus(order.orderStatus, mapped)) {
      if (order.orderStatus !== mapped) {
        order.orderStatus = mapped;
        changed = true;
      }
      if (mapped === 'SHIPPED' && !order.shippedAt) {
        order.shippedAt = new Date();
        changed = true;
      }
      if (mapped === 'DELIVERED') {
        order.deliveredAt = order.deliveredAt || new Date();
        changed = true;
      }
      if (mapped === 'CANCELLED' && !order.cancelledAt) {
        order.cancelledAt = new Date();
        changed = true;
      }
    }

    if (changed) {
      await order.save();
    }

    return res.status(200).json({
      success: true,
      matched: true,
      orderId: order._id,
      orderNumber: order.orderNumber,
      orderStatus: order.orderStatus,
      updated: changed
    });
  } catch (error) {
    console.error('Shiprocket webhook error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Webhook processing failed'
    });
  }
};

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
        // Prepaid vs COD changes serviceability / courier list — was defaulting to COD=1 and breaking prepaid
        const codFlag = order.paymentMethod === 'COD' ? 1 : 0;
        const serviceability = await shiprocketService.checkServiceability(deliveryPincode, weight, undefined, codFlag);
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
