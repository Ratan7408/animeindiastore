const Customer = require('../models/Customer');
const Order = require('../models/Order');
const AuditLog = require('../models/AuditLog');

// @desc    Get all customers
// @route   GET /api/customers
// @access  Private/Admin
exports.getAllCustomers = async (req, res) => {
  try {
    const {
      search,
      isBlocked,
      page = 1,
      limit = 50,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const query = {};

    if (isBlocked !== undefined) {
      query.isBlocked = isBlocked === 'true';
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
      ];
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    const customers = await Customer.find(query)
      .sort(sort)
      .skip(skip)
      .limit(limitNum)
      .select('-password');

    const total = await Customer.countDocuments(query);

    res.json({
      success: true,
      count: customers.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
      data: customers
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching customers',
      error: error.message
    });
  }
};

// @desc    Get single customer
// @route   GET /api/customers/:id
// @access  Private/Admin
exports.getCustomer = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id).select('-password');
    
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    // Get customer orders
    const orders = await Order.find({ customer: customer._id })
      .sort({ createdAt: -1 })
      .limit(10)
      .select('orderNumber orderStatus total createdAt');

    res.json({
      success: true,
      data: {
        customer,
        recentOrders: orders
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching customer',
      error: error.message
    });
  }
};

// @desc    Block/Unblock customer
// @route   PUT /api/customers/:id/block
// @access  Private/Admin
exports.toggleBlockCustomer = async (req, res) => {
  try {
    const { isBlocked, reason } = req.body;
    const customer = await Customer.findById(req.params.id);
    
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    customer.isBlocked = isBlocked;
    if (reason) customer.blockedReason = reason;
    await customer.save();

    // Log audit
    await AuditLog.create({
      admin: req.admin._id,
      action: isBlocked ? 'UPDATE' : 'UPDATE',
      entityType: 'CUSTOMER',
      entityId: customer._id,
      changes: { isBlocked: { from: !isBlocked, to: isBlocked } },
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.json({
      success: true,
      message: `Customer ${isBlocked ? 'blocked' : 'unblocked'} successfully`,
      data: customer
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating customer',
      error: error.message
    });
  }
};

// @desc    Get customer order history
// @route   GET /api/customers/:id/orders
// @access  Private/Admin
exports.getCustomerOrders = async (req, res) => {
  try {
    const orders = await Order.find({ customer: req.params.id })
      .sort({ createdAt: -1 })
      .populate('items.product', 'name sku images');

    res.json({
      success: true,
      count: orders.length,
      data: orders
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching customer orders',
      error: error.message
    });
  }
};

// @desc    Export customers to CSV
// @route   GET /api/customers/export
// @access  Private/Admin
exports.exportCustomers = async (req, res) => {
  try {
    const customers = await Customer.find().select('-password -addresses');
    
    const csvHeader = 'Name,Email,Phone,Total Orders,Total Spent,Wallet Balance,Status,Joined Date\n';
    const csvRows = customers.map(c => {
      const status = c.isBlocked ? 'Blocked' : 'Active';
      return `"${c.name}","${c.email}","${c.phone}",${c.totalOrders},${c.totalSpent},${c.walletBalance},"${status}","${c.createdAt.toISOString()}"`;
    }).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=customers.csv');
    res.send(csvHeader + csvRows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error exporting customers',
      error: error.message
    });
  }
};

module.exports = exports;
