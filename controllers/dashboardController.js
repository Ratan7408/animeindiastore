const Order = require('../models/Order');
const Product = require('../models/Product');
const Customer = require('../models/Customer');
const Payment = require('../models/Payment');
const Review = require('../models/Review');
const Return = require('../models/Return');
const Settings = require('../models/Settings');
const ExcelJS = require('exceljs');

// @desc    Get dashboard statistics
// @route   GET /api/dashboard/stats
// @access  Private/Admin
exports.getDashboardStats = async (req, res) => {
  try {
    // Check if mongoose is connected
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState !== 1) {
      return res.status(500).json({
        success: false,
        message: 'Database not connected',
        error: 'MongoDB connection is not ready'
      });
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const monthAgo = new Date(today);
    monthAgo.setMonth(monthAgo.getMonth() - 1);

    // Revenue: only successful payments (PAID); exclude cancelled and returned orders
    const revenueMatch = {
      paymentStatus: 'PAID',
      orderStatus: { $nin: ['CANCELLED', 'RETURNED'] }
    };
    const [dailyRevenue, weeklyRevenue, monthlyRevenue, totalRevenue] = await Promise.all([
      Order.aggregate([
        { $match: { createdAt: { $gte: today }, ...revenueMatch } },
        { $group: { _id: null, total: { $sum: '$total' } } }
      ]),
      Order.aggregate([
        { $match: { createdAt: { $gte: weekAgo }, ...revenueMatch } },
        { $group: { _id: null, total: { $sum: '$total' } } }
      ]),
      Order.aggregate([
        { $match: { createdAt: { $gte: monthAgo }, ...revenueMatch } },
        { $group: { _id: null, total: { $sum: '$total' } } }
      ]),
      Order.aggregate([
        { $match: revenueMatch },
        { $group: { _id: null, total: { $sum: '$total' } } }
      ])
    ]);

    // Order counts
    const [
      totalOrders,
      pendingOrders,
      shippedOrders,
      deliveredOrders,
      returnedOrders,
      cancelledOrders
    ] = await Promise.all([
      Order.countDocuments(),
      Order.countDocuments({ orderStatus: 'PENDING' }),
      Order.countDocuments({ orderStatus: 'SHIPPED' }),
      Order.countDocuments({ orderStatus: 'DELIVERED' }),
      Order.countDocuments({ orderStatus: 'RETURNED' }),
      Order.countDocuments({ orderStatus: 'CANCELLED' })
    ]);

    // Product statistics (low stock uses threshold from Settings)
    const settings = await Settings.getSettings();
    const lowStockThreshold = Math.max(0, parseInt(settings.lowStockThreshold, 10) || 10);
    const [
      totalProducts,
      inStockProducts,
      outOfStockProducts,
      lowStockProducts
    ] = await Promise.all([
      Product.countDocuments(),
      Product.countDocuments({ stockStatus: 'IN_STOCK', isActive: true }),
      Product.countDocuments({ stockStatus: 'OUT_OF_STOCK' }),
      Product.countDocuments({ stockQuantity: { $lte: lowStockThreshold, $gt: 0 }, isActive: true })
    ]);

    // Customer statistics
    const [
      totalCustomers,
      newCustomersToday,
      newCustomersWeek,
      newCustomersMonth
    ] = await Promise.all([
      Customer.countDocuments(),
      Customer.countDocuments({ createdAt: { $gte: today } }),
      Customer.countDocuments({ createdAt: { $gte: weekAgo } }),
      Customer.countDocuments({ createdAt: { $gte: monthAgo } })
    ]);

    // Abandoned carts (orders in PENDING status for more than 24 hours)
    const abandonedCartsDate = new Date();
    abandonedCartsDate.setHours(abandonedCartsDate.getHours() - 24);
    const abandonedCarts = await Order.countDocuments({
      orderStatus: 'PENDING',
      createdAt: { $lt: abandonedCartsDate }
    });

    // Pending return requests (admin notification)
    const pendingReturns = await Return.countDocuments({ status: 'PENDING' });

    // Best selling products (last 30 days) - only paid, non-cancelled/returned
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const bestSellingProducts = await Order.aggregate([
      { $match: { createdAt: { $gte: thirtyDaysAgo }, ...revenueMatch } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.product',
          totalQuantity: { $sum: '$items.quantity' },
          totalRevenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } }
        }
      },
      { $sort: { totalQuantity: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: '_id',
          as: 'product'
        }
      },
      { $unwind: '$product' },
      {
        $project: {
          productId: '$_id',
          productName: '$product.name',
          productImage: { $arrayElemAt: ['$product.images', 0] },
          totalQuantity: 1,
          totalRevenue: 1
        }
      }
    ]);

    // Revenue trends (last 7 days)
    const revenueTrends = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      const dayRevenue = await Order.aggregate([
        {
          $match: {
            createdAt: { $gte: date, $lt: nextDate },
            ...revenueMatch
          }
        },
        { $group: { _id: null, total: { $sum: '$total' } } }
      ]);

      revenueTrends.push({
        date: date.toISOString().split('T')[0],
        revenue: dayRevenue[0]?.total || 0
      });
    }

    res.json({
      success: true,
      data: {
        revenue: {
          daily: dailyRevenue[0]?.total || 0,
          weekly: weeklyRevenue[0]?.total || 0,
          monthly: monthlyRevenue[0]?.total || 0,
          total: totalRevenue[0]?.total || 0,
          trends: revenueTrends
        },
        orders: {
          total: totalOrders,
          pending: pendingOrders,
          shipped: shippedOrders,
          delivered: deliveredOrders,
          returned: returnedOrders,
          cancelled: cancelledOrders
        },
        products: {
          total: totalProducts,
          inStock: inStockProducts,
          outOfStock: outOfStockProducts,
          lowStock: lowStockProducts
        },
        customers: {
          total: totalCustomers,
          newToday: newCustomersToday,
          newThisWeek: newCustomersWeek,
          newThisMonth: newCustomersMonth,
          abandonedCarts: abandonedCarts
        },
        pendingReturns,
        bestSellingProducts: bestSellingProducts
      }
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching dashboard statistics',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

// @desc    Get recent orders
// @route   GET /api/dashboard/recent-orders
// @access  Private/Admin
exports.getRecentOrders = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const orders = await Order.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('customer', 'name email phone')
      .select('orderNumber customer orderStatus total paymentStatus createdAt');

    res.json({
      success: true,
      count: orders.length,
      data: orders
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching recent orders',
      error: error.message
    });
  }
};

// @desc    Get chart data for admin dashboard (orders & revenue over time, status breakdown)
// @route   GET /api/dashboard/charts
// @access  Private/Admin
exports.getChartData = async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days, 10) || 30, 90);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - days);

    // Orders per day (last N days)
    const ordersByDay = await Order.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Revenue per day: only successful payments; exclude cancelled and returned
    const revenueByDay = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
          paymentStatus: 'PAID',
          orderStatus: { $nin: ['CANCELLED', 'RETURNED'] }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          revenue: { $sum: '$total' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Fill missing days with 0
    const dateToCount = new Map(ordersByDay.map((d) => [d._id, d.count]));
    const dateToRevenue = new Map(revenueByDay.map((d) => [d._id, d.revenue]));
    const labels = [];
    const orderCounts = [];
    const revenues = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      labels.push(key);
      orderCounts.push(dateToCount.get(key) || 0);
      revenues.push(dateToRevenue.get(key) || 0);
    }

    // Order status breakdown (all time for pie chart)
    const orderStatusBreakdown = await Order.aggregate([
      { $group: { _id: '$orderStatus', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    res.json({
      success: true,
      data: {
        labels,
        ordersByDay: orderCounts,
        revenueByDay: revenues,
        orderStatusBreakdown: orderStatusBreakdown.map((s) => ({
          status: s._id || 'UNKNOWN',
          count: s.count
        }))
      }
    });
  } catch (error) {
    console.error('Chart data error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching chart data',
      error: error.message
    });
  }
};

// @desc    Get low stock alerts
// @route   GET /api/dashboard/low-stock
// @access  Private/Admin
exports.getLowStockAlerts = async (req, res) => {
  try {
    let threshold = parseInt(req.query.threshold, 10);
    if (Number.isNaN(threshold) || threshold < 0) {
      const settings = await Settings.getSettings();
      threshold = Math.max(0, parseInt(settings.lowStockThreshold, 10) || 10);
    }
    const products = await Product.find({
      stockQuantity: { $lte: threshold, $gt: 0 },
      isActive: true
    })
      .sort({ stockQuantity: 1 })
      .limit(20)
      .select('name sku stockQuantity stockStatus images');

    res.json({
      success: true,
      count: products.length,
      data: products
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching low stock alerts',
      error: error.message
    });
  }
};

// @desc    Export dashboard & product money data as Excel
// @route   GET /api/dashboard/export-excel
// @access  Private/Admin
exports.exportDashboardExcel = async (req, res) => {
  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState !== 1) {
      return res.status(500).json({
        success: false,
        message: 'Database not connected'
      });
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const monthAgo = new Date(today);
    monthAgo.setMonth(monthAgo.getMonth() - 1);
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Revenue: only successful payments; exclude cancelled and returned orders
    const revenueMatchExport = {
      paymentStatus: 'PAID',
      orderStatus: { $nin: ['CANCELLED', 'RETURNED'] }
    };
    const [dailyRevenue, weeklyRevenue, monthlyRevenue, totalRevenue] = await Promise.all([
      Order.aggregate([
        { $match: { createdAt: { $gte: today }, ...revenueMatchExport } },
        { $group: { _id: null, total: { $sum: '$total' } } }
      ]),
      Order.aggregate([
        { $match: { createdAt: { $gte: weekAgo }, ...revenueMatchExport } },
        { $group: { _id: null, total: { $sum: '$total' } } }
      ]),
      Order.aggregate([
        { $match: { createdAt: { $gte: monthAgo }, ...revenueMatchExport } },
        { $group: { _id: null, total: { $sum: '$total' } } }
      ]),
      Order.aggregate([
        { $match: revenueMatchExport },
        { $group: { _id: null, total: { $sum: '$total' } } }
      ])
    ]);

    const [
      totalOrders,
      pendingOrders,
      shippedOrders,
      deliveredOrders,
      returnedOrders,
      cancelledOrders
    ] = await Promise.all([
      Order.countDocuments(),
      Order.countDocuments({ orderStatus: 'PENDING' }),
      Order.countDocuments({ orderStatus: 'SHIPPED' }),
      Order.countDocuments({ orderStatus: 'DELIVERED' }),
      Order.countDocuments({ orderStatus: 'RETURNED' }),
      Order.countDocuments({ orderStatus: 'CANCELLED' })
    ]);

    const settings = await Settings.getSettings();
    const lowStockThreshold = Math.max(0, parseInt(settings.lowStockThreshold, 10) || 10);
    const [
      totalProducts,
      inStockProducts,
      outOfStockProducts,
      lowStockProducts
    ] = await Promise.all([
      Product.countDocuments(),
      Product.countDocuments({ stockStatus: 'IN_STOCK', isActive: true }),
      Product.countDocuments({ stockStatus: 'OUT_OF_STOCK' }),
      Product.countDocuments({ stockQuantity: { $lte: lowStockThreshold, $gt: 0 }, isActive: true })
    ]);

    const [
      totalCustomers,
      newCustomersToday,
      newCustomersWeek,
      newCustomersMonth
    ] = await Promise.all([
      Customer.countDocuments(),
      Customer.countDocuments({ createdAt: { $gte: today } }),
      Customer.countDocuments({ createdAt: { $gte: weekAgo } }),
      Customer.countDocuments({ createdAt: { $gte: monthAgo } })
    ]);

    const abandonedCartsDate = new Date();
    abandonedCartsDate.setHours(abandonedCartsDate.getHours() - 24);
    const abandonedCarts = await Order.countDocuments({
      orderStatus: 'PENDING',
      createdAt: { $lt: abandonedCartsDate }
    });
    const pendingReturns = await Return.countDocuments({ status: 'PENDING' });

    // Summary sheet
    const summaryData = [
      { Metric: 'Daily Revenue (₹)', Value: dailyRevenue[0]?.total ?? 0 },
      { Metric: 'Weekly Revenue (₹)', Value: weeklyRevenue[0]?.total ?? 0 },
      { Metric: 'Monthly Revenue (₹)', Value: monthlyRevenue[0]?.total ?? 0 },
      { Metric: 'Total Revenue (₹)', Value: totalRevenue[0]?.total ?? 0 },
      { Metric: '', Value: '' },
      { Metric: 'Total Orders', Value: totalOrders },
      { Metric: 'Pending Orders', Value: pendingOrders },
      { Metric: 'Shipped Orders', Value: shippedOrders },
      { Metric: 'Delivered Orders', Value: deliveredOrders },
      { Metric: 'Returned Orders', Value: returnedOrders },
      { Metric: 'Cancelled Orders', Value: cancelledOrders },
      { Metric: '', Value: '' },
      { Metric: 'Total Products', Value: totalProducts },
      { Metric: 'In Stock', Value: inStockProducts },
      { Metric: 'Out of Stock', Value: outOfStockProducts },
      { Metric: 'Low Stock', Value: lowStockProducts },
      { Metric: '', Value: '' },
      { Metric: 'Total Customers', Value: totalCustomers },
      { Metric: 'New Today', Value: newCustomersToday },
      { Metric: 'New This Week', Value: newCustomersWeek },
      { Metric: 'New This Month', Value: newCustomersMonth },
      { Metric: 'Abandoned Carts', Value: abandonedCarts },
      { Metric: 'Pending Returns', Value: pendingReturns }
    ];

    // Orders sheet (recent orders with full details, limit 10000)
    const orders = await Order.find()
      .sort({ createdAt: -1 })
      .limit(10000)
      .populate('customer', 'name email phone')
      .lean();

    const ordersRows = orders.map(o => ({
      'Order #': o.orderNumber,
      'Date': o.createdAt ? new Date(o.createdAt).toISOString().split('T')[0] : '',
      'Customer Name': o.customer?.name ?? (o.shippingAddress?.name ?? ''),
      'Customer Email': o.customer?.email ?? (o.shippingAddress?.email ?? ''),
      'Customer Phone': o.customer?.phone ?? (o.shippingAddress?.phone ?? ''),
      'Subtotal (₹)': o.subtotal ?? 0,
      'Shipping (₹)': o.shippingCharges ?? 0,
      'Discount (₹)': o.discount ?? 0,
      'Total (₹)': o.total ?? 0,
      'Payment Status': o.paymentStatus ?? '',
      'Order Status': o.orderStatus ?? '',
      'Payment Method': o.paymentMethod ?? ''
    }));

    // Product sales sheet (last 30 days) - only paid, non-cancelled/returned
    const productSales = await Order.aggregate([
      { $match: { createdAt: { $gte: thirtyDaysAgo }, ...revenueMatchExport } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.product',
          productName: { $first: '$items.name' },
          totalQuantity: { $sum: '$items.quantity' },
          totalRevenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } }
        }
      },
      { $sort: { totalQuantity: -1 } },
      { $limit: 500 },
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: '_id',
          as: 'product'
        }
      },
      { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          productId: '$_id',
          productName: { $ifNull: ['$product.name', '$productName'] },
          totalQuantity: 1,
          totalRevenue: 1
        }
      }
    ]);

    const productSalesRows = productSales.map(p => ({
      'Product ID': String(p.productId),
      'Product Name': p.productName || 'N/A',
      'Quantity Sold': p.totalQuantity,
      'Revenue (₹)': p.totalRevenue
    }));

    const workbook = new ExcelJS.Workbook();

    const addSheetFromRows = (wb, sheetName, rows) => {
      const sheet = wb.addWorksheet(sheetName);
      if (!rows.length) return sheet;
      const headers = Object.keys(rows[0]);
      sheet.addRow(headers);
      rows.forEach(obj => sheet.addRow(headers.map(h => obj[h])));
      return sheet;
    };

    addSheetFromRows(workbook, 'Summary', summaryData);
    addSheetFromRows(workbook, 'Orders', ordersRows.length ? ordersRows : [{ 'Order #': 'No orders' }]);
    addSheetFromRows(workbook, 'Product Sales', productSalesRows.length ? productSalesRows : [{ 'Product Name': 'No sales data' }]);

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `dashboard-report-${today.toISOString().split('T')[0]}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(buffer));
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error exporting dashboard Excel',
      error: error.message
    });
  }
};

module.exports = exports;
