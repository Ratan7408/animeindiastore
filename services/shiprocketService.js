/**
 * Shiprocket API integration
 * Docs: https://apidocs.shiprocket.in/
 */
const axios = require('axios');

const SHIPROCKET_LOGIN_URL = process.env.SHIPROCKET_LOGIN_URL || 'https://apiv2.shiprocket.in/v1/external/auth/login';
const SHIPROCKET_BASE_URL = process.env.SHIPROCKET_BASE_URL || 'https://apiv2.shiprocket.in/v1/external';
const SHIPROCKET_EMAIL = process.env.SHIPROCKET_EMAIL;
const SHIPROCKET_PASSWORD = process.env.SHIPROCKET_PASSWORD;
/** Pickup location name – must match exactly a location in Shiprocket (Settings > Pickup Address). */
const SHIPROCKET_PICKUP_LOCATION = process.env.SHIPROCKET_PICKUP_LOCATION || 'Primary';
/** Pickup pincode for serviceability check (assign AWB needs courier_id from serviceability). */
const SHIPROCKET_PICKUP_POSTCODE = process.env.SHIPROCKET_PICKUP_POSTCODE || '110001';

let cachedToken = null;
let tokenExpiry = 0;
const TOKEN_BUFFER_MS = 60 * 1000; // refresh 1 min before expiry

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry - TOKEN_BUFFER_MS) {
    return cachedToken;
  }
  if (!SHIPROCKET_EMAIL || !SHIPROCKET_PASSWORD) {
    throw new Error('Shiprocket credentials not configured (SHIPROCKET_EMAIL, SHIPROCKET_PASSWORD)');
  }
  const { data } = await axios.post(SHIPROCKET_LOGIN_URL, {
    email: SHIPROCKET_EMAIL,
    password: SHIPROCKET_PASSWORD
  }, { headers: { 'Content-Type': 'application/json' } });
  if (!data.token) {
    throw new Error(data.message || 'Shiprocket login failed');
  }
  cachedToken = data.token;
  tokenExpiry = Date.now() + (24 * 60 * 60 * 1000); // assume 24h
  return cachedToken;
}

function getAuthHeaders(token) {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };
}

/** Normalize Indian phone to 10 digits (Shiprocket expects 10-digit mobile) */
function normalizePhone(phone) {
  if (!phone) return '';
  const s = String(phone).replace(/\D/g, '');
  if (s.length === 11 && s.startsWith('0')) return s.slice(1);
  if (s.length === 12 && s.startsWith('91')) return s.slice(2);
  return s.length >= 10 ? s.slice(-10) : s;
}

/**
 * Create adhoc order in Shiprocket from our Order model
 * @param {Object} order - Mongoose order doc (with shippingAddress, items, etc.)
 * @param {Object} pickup - Pickup address (optional; use env/default if not provided)
 * @returns {Object} Shiprocket order response { order_id, status, ... }
 */
async function createOrder(order, pickup = null) {
  const token = await getToken();
  const addr = order.shippingAddress || {};
  const nameParts = (addr.name || '').trim().split(/\s+/);
  const firstName = (addr.firstName || nameParts[0] || 'Customer').trim().slice(0, 50);
  const lastName = (addr.lastName || nameParts.slice(1).join(' ') || '').trim().slice(0, 50);
  const phone = normalizePhone(addr.phone);
  const email = (addr.email || order.customer?.email || '').trim() || 'noreply@example.com';
  const addressLine1 = (addr.address || addr.street || '').trim().slice(0, 200) || 'Address';
  const city = (addr.city || '').trim().slice(0, 50) || 'City';
  const state = (addr.state || '').trim().slice(0, 50) || 'State';
  const pincode = String(addr.pincode || '').replace(/\D/g, '').slice(0, 6) || '000000';
  const country = (addr.country || 'India').trim();

  const orderItems = (order.items || []).map(item => {
    const price = Math.max(0, Number(item.price) || 0);
    return {
      name: (item.name || 'Product').toString().slice(0, 100),
      sku: (item.sku || 'SKU').toString().slice(0, 50),
      units: Math.max(1, parseInt(item.quantity, 10) || 1),
      unit_price: price,
      selling_price: price,
      is_document: 0
    };
  });

  if (orderItems.length === 0) {
    orderItems.push({ name: 'Product', sku: 'NA', units: 1, unit_price: 0, selling_price: 0, is_document: 0 });
  }

  const totalQty = order.items.reduce((s, i) => s + (i.quantity || 1), 0);
  const weight = Math.max(0.5, Math.min(30, totalQty * 0.5));

  const payload = {
    order_id: order.orderNumber,
    order_date: new Date(order.createdAt || Date.now()).toISOString().split('T')[0],
    channel_id: '',
    billing_customer_name: firstName,
    billing_last_name: lastName || '-',
    billing_address: addressLine1,
    billing_address_2: (addr.landmark || '').trim().slice(0, 100),
    billing_city: city,
    billing_pincode: pincode,
    billing_state: state,
    billing_country: country,
    billing_email: email,
    billing_phone: phone || '9999999999',
    shipping_customer_name: firstName,
    shipping_last_name: lastName || '-',
    shipping_address: addressLine1,
    shipping_address_2: (addr.landmark || '').trim().slice(0, 100),
    shipping_city: city,
    shipping_pincode: pincode,
    shipping_state: state,
    shipping_country: country,
    shipping_email: email,
    shipping_phone: phone || '9999999999',
    order_items: orderItems,
    payment_method: order.paymentMethod === 'COD' ? 'COD' : 'Prepaid',
    sub_total: Math.max(0, Number(order.subtotal) || 0),
    length: 15,
    width: 15,
    height: 10,
    breadth: 15,
    weight: weight,
    shipping_is_billing: '1',
    pickup_location: (pickup && pickup.name) ? pickup.name : SHIPROCKET_PICKUP_LOCATION
  };

  if (pickup && pickup.address) {
    payload.vendor_details = {
      email: pickup.email || SHIPROCKET_EMAIL,
      phone: pickup.phone || '',
      name: pickup.name || 'Store',
      address: pickup.address,
      city: pickup.city || '',
      state: pickup.state || '',
      country: pickup.country || 'India',
      pin_code: String(pickup.pincode || '')
    };
  }

  const { data } = await axios.post(
    `${SHIPROCKET_BASE_URL}/orders/create/adhoc`,
    payload,
    { headers: getAuthHeaders(token) }
  );
  return data;
}

/**
 * Check serviceability: get available couriers and courier_id for pickup→delivery.
 * Shiprocket assign/awb requires courier_id; the list comes from serviceability, not assign/awb.
 * @param {string} deliveryPostcode - Destination pincode (e.g. order shipping pincode)
 * @param {number} weight - Weight in kg
 * @param {string} [pickupPostcode] - Pickup pincode (default from env)
 * @param {number} [cod] - 1 = COD, 0 = Prepaid
 * @returns {Promise<{ data?: { available_courier_companies?: Array<{ id?: number, courier_id?: number, name?: string }> } }>}
 */
async function checkServiceability(deliveryPostcode, weight = 0.5, pickupPostcode = SHIPROCKET_PICKUP_POSTCODE, cod = 1) {
  const token = await getToken();
  const pickup = String(pickupPostcode || SHIPROCKET_PICKUP_POSTCODE).replace(/\D/g, '').slice(0, 6) || '110001';
  const delivery = String(deliveryPostcode || '').replace(/\D/g, '').slice(0, 6) || '110001';
  const { data } = await axios.get(
    `${SHIPROCKET_BASE_URL}/courier/serviceability/`,
    {
      params: {
        pickup_postcode: pickup,
        delivery_postcode: delivery,
        weight: Math.max(0.1, Number(weight) || 0.5),
        cod: cod ? 1 : 0,
        mode: 'Surface'
      },
      headers: getAuthHeaders(token)
    }
  );
  return data;
}

/**
 * Fetch order details from Shiprocket to get shipment_id (for orders created before we stored it).
 * Tries GET /orders/view/{order_id}. Returns { shipment_id } or null.
 * @param {number} orderId - Shiprocket order_id
 * @returns {Promise<{ shipment_id: number } | null>}
 */
async function getOrderDetails(orderId) {
  const full = await getOrderFull(orderId);
  if (!full) return null;
  const shipmentId =
    full.shipment_id ??
    full.data?.shipment_id ??
    full.shipments?.[0]?.id ??
    full.data?.shipments?.[0]?.id ??
    (full.shipments?.[0] ? full.shipments[0].shipment_id : null);
  if (shipmentId != null) return { shipment_id: Number(shipmentId) };
  return null;
}

/**
 * GET order from Shiprocket – tries multiple endpoint paths (view API often 404).
 * Returns full data so caller can read awb_code from order or shipments.
 * @param {string|number} orderId - Shiprocket order_id or our orderNumber
 * @returns {Promise<Object | null>} Full order object or null
 */
async function getOrderFull(orderId) {
  const token = await getToken();
  const oid = orderId == null ? '' : String(orderId).trim();
  if (!oid) return null;
  const paths = [
    `orders/view/${encodeURIComponent(oid)}`,
    `orders/${encodeURIComponent(oid)}`,
    `order/view/${encodeURIComponent(oid)}`,
    `order/${encodeURIComponent(oid)}`
  ];
  for (const path of paths) {
    try {
      const { data } = await axios.get(
        `${SHIPROCKET_BASE_URL}/${path}`,
        { headers: getAuthHeaders(token) }
      );
      if (data) {
        const topKeys = Object.keys(data);
        const hasShipments = Array.isArray(data.shipments) ? data.shipments.length : (data.data?.shipments?.length ?? 0);
        const firstShipment = data.shipments?.[0] ?? data.data?.shipments?.[0];
        const shipKeys = firstShipment ? Object.keys(firstShipment) : [];
        console.log('[Shiprocket→User] getOrderFull OK | path=', path, '| topKeys=', topKeys.join(','), '| shipmentsCount=', hasShipments, '| firstShipmentKeys=', shipKeys.join(','));
        if (firstShipment && (firstShipment.awb_code || firstShipment.awb)) {
          console.log('[Shiprocket→User] getOrderFull AWB in shipment:', firstShipment.awb_code || firstShipment.awb);
        } else if (data.awb_code || data.awb) {
          console.log('[Shiprocket→User] getOrderFull AWB at top:', data.awb_code || data.awb);
        } else {
          console.log('[Shiprocket→User] getOrderFull no AWB in usual places – check response shape if tracking not syncing');
        }
        return data;
      }
    } catch (err) {
      const status = err.response?.status;
      if (status === 404) {
        console.log('[Shiprocket→User] getOrderFull 404 on path=', path, '→ try next');
        continue;
      }
      console.warn('[Shiprocket→User] getOrderFull failed | path=', path, '| status=', status, '| message=', err.response?.data?.message || err.message);
      return null;
    }
  }
  console.log('[Shiprocket→User] getOrderFull trying list API fallback');
  return getOrderFullViaList(oid);
}

/**
 * Fetch order by listing orders and finding match (Shiprocket external API may not expose single-order view).
 * Tries GET /orders with query params, finds order by id or order_id.
 */
async function getOrderFullViaList(orderIdOrOrderNumber) {
  const token = await getToken();
  const search = orderIdOrOrderNumber == null ? '' : String(orderIdOrOrderNumber).trim();
  if (!search) return null;
  const numericId = /^\d+$/.test(search) ? parseInt(search, 10) : null;
  const paths = [
    { url: `${SHIPROCKET_BASE_URL}/orders`, params: { page: 1, per_page: 100 } },
    { url: `${SHIPROCKET_BASE_URL}/orders`, params: {} },
    { url: `${SHIPROCKET_BASE_URL}/orders`, params: { order_id: search } },
    { url: `${SHIPROCKET_BASE_URL}/channel/orders`, params: { page: 1 } }
  ];
  for (const { url, params } of paths) {
    try {
      const { data } = await axios.get(url, {
        params,
        headers: getAuthHeaders(token)
      });
      const list = Array.isArray(data)
        ? data
        : data?.data
          ? (Array.isArray(data.data) ? data.data : data.data?.orders || data.data?.data || [])
          : data?.orders || [];
      const orders = Array.isArray(list) ? list : [];
      const found = orders.find((o) => {
        const id = o.id ?? o.order_id ?? o.order?.id ?? o.order?.order_id;
        const sid = String(id ?? '').trim();
        return sid === search || o.id == search || o.order_id == search || (numericId != null && (Number(o.id) === numericId || Number(o.order_id) === numericId));
      });
      if (found) {
        const flat = found.order ? { ...found.order, ...found } : found;
        console.log('[Shiprocket→User] getOrderFullViaList found order | keys=', Object.keys(flat).join(','));
        return flat;
      }
      if (orders.length > 0) {
        console.log('[Shiprocket→User] getOrderFullViaList list returned', orders.length, 'orders, no match for', search);
      }
    } catch (err) {
      if (err.response?.status === 404 || err.response?.status === 401) {
        continue;
      }
      console.log('[Shiprocket→User] getOrderFullViaList', url, err.response?.status || err.message);
    }
  }
  return null;
}

/**
 * Get available couriers for an order (after order is created in Shiprocket)
 * POST assign/awb with order_id + shipment_id returns list of couriers (or 400 if order not ready).
 * @param {number} orderId - Shiprocket order_id
 * @param {number} [shipmentId] - Shiprocket shipment_id (from create order response)
 */
async function getCouriers(orderId, shipmentId) {
  const token = await getToken();
  const oid = typeof orderId === 'string' ? parseInt(orderId, 10) : Number(orderId);
  const body = { order_id: oid };
  if (shipmentId != null && shipmentId !== '') {
    body.shipment_id = typeof shipmentId === 'string' ? parseInt(shipmentId, 10) : Number(shipmentId);
  }
  if (process.env.NODE_ENV !== 'production') {
    console.log('Shiprocket getCouriers request body:', JSON.stringify(body));
  }
  const { data } = await axios.post(
    `${SHIPROCKET_BASE_URL}/courier/assign/awb`,
    body,
    { headers: getAuthHeaders(token) }
  );
  return data;
}

/**
 * Call assign/awb with only order_id + shipment_id (no courier_id).
 * Shiprocket may auto-assign and return awb_code, or return list of couriers.
 * @param {number} orderId - Shiprocket order_id
 * @param {number} [shipmentId] - Shiprocket shipment_id
 * @returns {Promise<{ awb_code?: string, courier_name?: string } | null>} Response or null on error
 */
async function assignAWBWithOptionalCourier(orderId, shipmentId) {
  const token = await getToken();
  const oid = typeof orderId === 'string' ? parseInt(orderId, 10) : Number(orderId);
  const body = { order_id: oid };
  if (shipmentId != null && shipmentId !== '') {
    body.shipment_id = typeof shipmentId === 'string' ? parseInt(shipmentId, 10) : Number(shipmentId);
  }
  try {
    const { data } = await axios.post(
      `${SHIPROCKET_BASE_URL}/courier/assign/awb`,
      body,
      { headers: getAuthHeaders(token) }
    );
    return data;
  } catch (err) {
    if (err.response?.status === 400 && err.response?.data) {
      return null;
    }
    throw err;
  }
}

/**
 * Assign AWB to a Shiprocket order (select courier)
 * Shiprocket API requires order_id, shipment_id (if available), and courier_id.
 * @param {number} orderId - Shiprocket order_id
 * @param {number} courierId - Courier id from getCouriers response
 * @param {number} [shipmentId] - Shiprocket shipment_id (from create order response)
 */
async function assignAWB(orderId, courierId, shipmentId) {
  const token = await getToken();
  const oid = typeof orderId === 'string' ? parseInt(orderId, 10) : Number(orderId);
  const cid = typeof courierId === 'string' ? parseInt(courierId, 10) : Number(courierId);
  const body = { order_id: oid, courier_id: cid };
  if (shipmentId != null && shipmentId !== '') {
    body.shipment_id = typeof shipmentId === 'string' ? parseInt(shipmentId, 10) : Number(shipmentId);
  }
  const { data } = await axios.post(
    `${SHIPROCKET_BASE_URL}/courier/assign/awb`,
    body,
    { headers: getAuthHeaders(token) }
  );
  return data;
}

/**
 * Track shipment by AWB
 * @param {string} awb
 */
async function track(awb) {
  const token = await getToken();
  const { data } = await axios.get(
    `${SHIPROCKET_BASE_URL}/courier/track/awb/${encodeURIComponent(awb)}`,
    { headers: getAuthHeaders(token) }
  );
  return data;
}

module.exports = {
  getToken,
  createOrder,
  checkServiceability,
  getOrderDetails,
  getOrderFull,
  getCouriers,
  assignAWBWithOptionalCourier,
  assignAWB,
  track
};
