/**
 * Abandoned cart email job.
 * Run via cron every 1–2 hours: node scripts/abandonedCartEmails.js
 * Or: cd backend && node scripts/abandonedCartEmails.js
 *
 * Sends one email per customer whose cart was updated 2–24 hours ago and who hasn't been sent a reminder yet.
 * Requires: MONGODB_URI, email env vars (EMAIL_FROM, EMAIL_PASSWORD, etc.)
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Customer = require('../models/Customer');
const Order = require('../models/Order');
const { sendAbandonedCartEmail } = require('../utils/emailService');

const DELAY_HOURS_MIN = Number(process.env.ABANDONED_CART_DELAY_HOURS_MIN) || 2;
const DELAY_HOURS_MAX = Number(process.env.ABANDONED_CART_DELAY_HOURS_MAX) || 24;

async function run() {
  try {
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/animeweb';
    await mongoose.connect(mongoURI);
    console.log('[abandoned-cart] DB connected');

    const now = new Date();
    const minDate = new Date(now.getTime() - DELAY_HOURS_MAX * 60 * 60 * 1000);
    const maxDate = new Date(now.getTime() - DELAY_HOURS_MIN * 60 * 60 * 1000);

    const customers = await Customer.find({
      'cartSnapshot.0': { $exists: true },
      cartUpdatedAt: { $gte: minDate, $lte: maxDate },
      $or: [{ abandonedCartEmailSentAt: null }, { abandonedCartEmailSentAt: { $exists: false } }]
    }).select('name email cartSnapshot cartUpdatedAt');

    let sent = 0;
    const cartUrl = (process.env.STORE_FRONTEND_URL || 'https://store.animeindia.org').replace(/\/$/, '') + '/cart';

    for (const c of customers) {
      const items = Array.isArray(c.cartSnapshot) ? c.cartSnapshot : [];
      if (items.length === 0) continue;

      const placedOrderAfterCart = await Order.findOne({
        customer: c._id,
        createdAt: { $gt: c.cartUpdatedAt }
      });
      if (placedOrderAfterCart) {
        c.abandonedCartEmailSentAt = new Date();
        await c.save({ validateBeforeSave: false });
        continue;
      }

      try {
        await sendAbandonedCartEmail({
          to: c.email,
          customerName: c.name || 'there',
          items: items.map(i => ({
            name: i.name,
            price: i.price,
            quantity: i.quantity,
            image: i.images && i.images[0],
            images: i.images
          })),
          cartUrl
        });
        c.abandonedCartEmailSentAt = new Date();
        await c.save({ validateBeforeSave: false });
        sent++;
        console.log('[abandoned-cart] Sent to', c.email);
      } catch (err) {
        console.error('[abandoned-cart] Failed for', c.email, err.message);
      }
    }

    console.log('[abandoned-cart] Done. Sent', sent, 'emails.');
  } catch (err) {
    console.error('[abandoned-cart] Error:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

run();
