const mongoose = require('mongoose');
const Admin = require('../models/Admin');
require('dotenv').config();

// Sample products data (you can modify this)
const sampleProducts = [
  {
    name: 'Sunflower Beige Oversized Hoodie',
    description: 'Comfortable oversized hoodie in beige color with sunflower design',
    price: 3799,
    discount: 29,
    category: 'Hoodies',
    images: ['/uploads/sample-hoodie-1.jpg'],
    stockQuantity: 50,
    stockStatus: 'IN_STOCK',
    sku: 'HOOD-SUN-BEI-001',
    isActive: true
  },
  {
    name: 'Blazing Wild Relaxed Fit T-Shirt',
    description: 'Relaxed fit t-shirt with wild design',
    price: 1299,
    discount: 0,
    category: 'T-shirts',
    images: ['/uploads/sample-tshirt-1.jpg'],
    stockQuantity: 100,
    stockStatus: 'IN_STOCK',
    sku: 'TSH-BLA-WIL-001',
    isActive: true
  },
  {
    name: 'Limitless Socks Glory',
    description: 'Premium quality socks pack',
    price: 349,
    discount: 0,
    category: 'Socks',
    images: ['/uploads/sample-socks-1.jpg'],
    stockQuantity: 0,
    stockStatus: 'OUT_OF_STOCK',
    sku: 'SOC-LIM-GLO-001',
    isActive: true
  }
];

async function seedDatabase() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/animeweb');
    
    console.log('✅ Connected to MongoDB');

    // Reset admin users and create a single default admin
    const defaultAdminEmail = 'admin@store.animeindia.org';
    const defaultAdminPassword = 'Console3,Animate0';

    // WARNING: In this project we treat seeding as a dev-only operation.
    // This will remove ALL existing admins and recreate the default one.
    await Admin.deleteMany({});

    const admin = await Admin.create({
      name: 'Admin User',
      email: defaultAdminEmail,
      password: defaultAdminPassword, // Will be hashed automatically
      role: 'ADMIN'
    });
    console.log('✅ Default admin (re)created:');
    console.log(`   Email: ${defaultAdminEmail}`);
    console.log(`   Password: ${defaultAdminPassword}`);

    // Seed products (optional - uncomment if needed)
    // const Product = require('../models/Product');
    // await Product.deleteMany({});
    // await Product.insertMany(sampleProducts);
    // console.log('✅ Sample products seeded');

    console.log('✅ Database seeding completed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding error:', error);
    process.exit(1);
  }
}

seedDatabase();

