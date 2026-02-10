/**
 * Reset dashboard-related data to zero.
 *
 * This will:
 * - Delete ALL orders
 * - Delete ALL payments
 * - Delete ALL returns
 * - Delete ALL reviews
 * - (Optionally) delete customers with no orders (keeps customer list mostly clean)
 *
 * Run only when you are sure there are no real orders you care about.
 *
 * Usage (from backend folder):
 *   node scripts/resetDashboardData.js
 *   # or if you add an npm script: npm run reset:dashboard
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Order = require('../models/Order');
const Payment = require('../models/Payment');
const ReturnModel = require('../models/Return');
const Review = require('../models/Review');
const Customer = require('../models/Customer');

async function run() {
  try {
    const mongoURI = process.env.MONGODB_URI;
    if (!mongoURI) {
      throw new Error('MONGODB_URI is not set in .env');
    }

    console.log('[resetDashboardData] Connecting to MongoDB...');
    await mongoose.connect(mongoURI);
    console.log('[resetDashboardData] DB connected');

    console.log('[resetDashboardData] Deleting orders, payments, returns, reviews...');
    const [ordersRes, paymentsRes, returnsRes, reviewsRes] = await Promise.all([
      Order.deleteMany({}),
      Payment.deleteMany({}),
      ReturnModel.deleteMany({}),
      Review.deleteMany({})
    ]);

    console.log('[resetDashboardData] Deleted counts:', {
      orders: ordersRes.deletedCount,
      payments: paymentsRes.deletedCount,
      returns: returnsRes.deletedCount,
      reviews: reviewsRes.deletedCount
    });

    console.log('[resetDashboardData] Deleting customers with no orders (optional clean-up)...');
    // Remove customers that have never placed an order (no real history)
    const customersWithOrders = await Order.distinct('customer');
    const customersRes = await Customer.deleteMany({
      _id: { $nin: customersWithOrders }
    });

    console.log('[resetDashboardData] Deleted customers with no orders:', customersRes.deletedCount);

    console.log('[resetDashboardData] Done. Dashboard stats should now be 0.');
  } catch (err) {
    console.error('[resetDashboardData] Error:', err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    process.exit();
  }
}

run();

