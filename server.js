const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
require('dotenv').config();

const app = express();

// CORS: always allow localhost (for local dev); in production also allow CORS_ORIGINS
const corsOrigins = process.env.CORS_ORIGINS;
const allowedList = corsOrigins && corsOrigins.trim()
  ? corsOrigins.split(',').map(s => s.trim()).filter(Boolean)
  : [];
const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (/^https?:\/\/localhost(:\d+)?$/i.test(origin)) return cb(null, true);
    if (allowedList.length && allowedList.includes(origin)) return cb(null, true);
    if (allowedList.length) return cb(null, false);
    return cb(null, true);
  },
  credentials: true
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Serve uploaded files from frontend/public/uploads (where new uploads are stored)
// This allows both frontend and admin panel to access images
const uploadsPath = path.join(__dirname, '../frontend/public/uploads');
app.use('/uploads', express.static(uploadsPath));

// Root route
app.get('/', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'AnimeWeb API Server',
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      products: '/api/products',
      auth: '/api/auth',
      dashboard: '/api/dashboard'
    }
  });
});

// Public content (no auth – for frontend to show admin-managed content)
const contentController = require('./controllers/contentController');
const settingsController = require('./controllers/settingsController');
const publicController = require('./controllers/publicController');
app.get('/api/public/content/:type', contentController.getPublicContentByType);
app.get('/api/public/maintenance', settingsController.getPublicMaintenance);
app.get('/api/public/checkout-settings', settingsController.getPublicCheckoutSettings);
app.post('/api/public/contact', publicController.handleContact);

// Routes
app.use('/api/products', require('./routes/productRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/dashboard', require('./routes/dashboardRoutes'));
app.use('/api/orders', require('./routes/orderRoutes'));
app.use('/api/customers', require('./routes/customerRoutes'));
app.use('/api/coupons', require('./routes/couponRoutes'));
app.use('/api/categories', require('./routes/categoryRoutes'));
app.use('/api/collections', require('./routes/collectionRoutes'));
app.use('/api/reviews', require('./routes/reviewRoutes'));
app.use('/api/returns', require('./routes/returnRoutes'));
app.use('/api/content', require('./routes/contentRoutes'));
app.use('/api/settings', require('./routes/settingsRoutes'));
app.use('/api/payments', require('./routes/paymentRoutes'));
app.use('/api/cart', require('./routes/cartRoutes'));
app.use('/api/shiprocket', require('./routes/shiprocketRoutes'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

// 404 - no route matched (must be after all routes)
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found` });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Connect to MongoDB
const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/animeweb';
    
    await mongoose.connect(mongoURI);
    console.log('✅ MongoDB connected successfully');
    
    // Start server
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    
    // Provide helpful error messages
    if (error.message.includes('IP') || error.message.includes('whitelist')) {
      console.error('\n📋 MongoDB Atlas IP Whitelist Issue:');
      console.error('   1. Go to: https://cloud.mongodb.com/');
      console.error('   2. Select your cluster → Network Access');
      console.error('   3. Click "Add IP Address"');
      console.error('   4. Click "Add Current IP Address" (or use 0.0.0.0/0 for all IPs - less secure)');
      console.error('   5. Wait 1-2 minutes for changes to take effect');
      console.error('   6. Restart the server\n');
    } else if (error.message.includes('authentication')) {
      console.error('\n📋 MongoDB Authentication Issue:');
      console.error('   - Check your MONGODB_URI in .env file');
      console.error('   - Verify username and password are correct');
      console.error('   - Ensure database user has proper permissions\n');
    } else if (!process.env.MONGODB_URI) {
      console.error('\n📋 Missing MongoDB Configuration:');
      console.error('   - Create a .env file in the backend directory');
      console.error('   - Add: MONGODB_URI=your_connection_string');
      console.error('   - See SETUP.md for more details\n');
    }
    
    process.exit(1);
  }
};

connectDB();

module.exports = app;

