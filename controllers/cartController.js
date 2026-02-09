const Customer = require('../models/Customer');

/**
 * Sync cart for logged-in customer (for abandoned cart emails).
 * POST /api/cart/sync  body: { items: [ { productId, name, price, discount, images, size, color, quantity } ] }
 */
exports.syncCart = async (req, res) => {
  try {
    if (!req.customer || !req.customer._id) {
      return res.status(401).json({ success: false, message: 'Login required to sync cart.' });
    }
    const items = req.body.items;
    const customerId = req.customer._id;

    const customer = await Customer.findById(customerId).select('cartSnapshot cartUpdatedAt abandonedCartEmailSentAt');
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found.' });
    }

    const now = new Date();
    const snapshot = Array.isArray(items) && items.length > 0
      ? items.map(item => ({
          productId: item.productId || item.product?._id,
          name: item.name || item.product?.name,
          price: item.price != null ? item.price : item.product?.price,
          discount: item.discount != null ? item.discount : (item.product?.discount || 0),
          images: item.images || item.product?.images,
          size: item.size || '',
          color: item.color || '',
          quantity: Math.max(1, parseInt(item.quantity, 10) || 1)
        }))
      : null;

    customer.cartSnapshot = snapshot;
    customer.cartUpdatedAt = snapshot ? now : null;
    if (snapshot) {
      customer.abandonedCartEmailSentAt = null;
    }
    await customer.save();

    return res.json({
      success: true,
      message: snapshot ? 'Cart synced.' : 'Cart cleared.',
      data: { cartUpdatedAt: customer.cartUpdatedAt }
    });
  } catch (error) {
    console.error('Cart sync error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to sync cart.',
      error: error.message
    });
  }
};
