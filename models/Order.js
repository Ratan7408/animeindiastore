const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  name: String, // Snapshot of product name at time of order
  sku: String,
  price: {
    type: Number,
    required: true
  },
  discount: {
    type: Number,
    default: 0
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  size: {
    type: String,
    enum: ['XS', 'S', 'M', 'L', 'XL', 'XXL']
  },
  color: String,
  image: String
});

const shippingAddressSchema = new mongoose.Schema({
  name: { type: String, required: true },
  firstName: String,
  lastName: String,
  email: String,
  phone: { type: String, required: true },
  address: { type: String, required: true },
  street: String, // Alias for address
  city: { type: String, required: true },
  state: { type: String, required: true },
  pincode: { type: String, required: true },
  country: { type: String, default: 'India' },
  type: String, // HOME, WORK, OTHER
  landmark: String
}, { _id: false });

const orderSchema = new mongoose.Schema({
  orderNumber: {
    type: String,
    unique: true,
    required: true
  },
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true
  },
  items: [orderItemSchema],
  shippingAddress: {
    type: shippingAddressSchema,
    required: true
  },
  billingAddress: {
    name: String,
    phone: String,
    address: String,
    city: String,
    state: String,
    pincode: String
  },
  subtotal: {
    type: Number,
    required: true
  },
  shippingCharges: {
    type: Number,
    default: 0
  },
  discount: {
    type: Number,
    default: 0
  },
  couponCode: String,
  tax: {
    type: Number,
    default: 0
  },
  total: {
    type: Number,
    required: true
  },
  paymentMethod: {
    type: String,
    enum: ['COD', 'ONLINE', 'WALLET'],
    required: true
  },
  paymentStatus: {
    type: String,
    enum: ['PENDING', 'PAID', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED'],
    default: 'PENDING'
  },
  orderStatus: {
    type: String,
    enum: ['PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'RETURNED', 'CANCELLED'],
    default: 'PENDING'
  },
  trackingNumber: String,
  shippingProvider: String,
  shiprocketOrderId: { type: Number, default: null }, // Shiprocket order_id after create
  shiprocketShipmentId: { type: Number, default: null }, // Shiprocket shipment_id (required for assign AWB)
  notes: String,
  internalNotes: String, // For admin use only
  cancelledAt: Date,
  cancelledReason: String,
  deliveredAt: Date,
  shippedAt: Date
}, {
  timestamps: true
});

// Generate order number
orderSchema.pre('save', async function(next) {
  if (!this.orderNumber) {
    try {
      // Use mongoose.model to get the Order model
      const OrderModel = this.constructor;
      const count = await OrderModel.countDocuments();
      const timestamp = Date.now();
      const sequence = String(count + 1).padStart(4, '0');
      this.orderNumber = `ORD${timestamp}${sequence}`;
    } catch (error) {
      // Fallback if countDocuments fails - use timestamp + random
      const timestamp = Date.now();
      const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
      this.orderNumber = `ORD${timestamp}${random}`;
    }
  }
  // Ensure orderNumber is set before proceeding
  if (!this.orderNumber) {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    this.orderNumber = `ORD${timestamp}${random}`;
  }
  next();
});

// Indexes
// Note: orderNumber index is automatically created by unique: true
orderSchema.index({ customer: 1 });
orderSchema.index({ orderStatus: 1 });
orderSchema.index({ paymentStatus: 1 });
orderSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Order', orderSchema);

