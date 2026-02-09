const mongoose = require('mongoose');
const Collection = require('../models/Collection');
require('dotenv').config();

// Sample collections
const collections = [
  { 
    name: 'Featured Products', 
    description: 'Our handpicked featured products',
    isActive: true,
    displayOrder: 1
  },
  { 
    name: 'New Arrivals', 
    description: 'Latest products just arrived',
    isActive: true,
    displayOrder: 2
  },
  { 
    name: 'Best Sellers', 
    description: 'Our most popular products',
    isActive: true,
    displayOrder: 3
  },
  { 
    name: 'Sale Items', 
    description: 'Products on sale',
    isActive: true,
    displayOrder: 4
  }
];

async function seedCollections() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/animeweb');
    
    console.log('✅ Connected to MongoDB');
    
    let created = 0;
    let skipped = 0;
    
    for (const collData of collections) {
      try {
        const existing = await Collection.findOne({ name: collData.name });
        if (existing) {
          console.log(`⏭️  Collection "${collData.name}" already exists, skipping...`);
          skipped++;
        } else {
          await Collection.create(collData);
          console.log(`✅ Created collection: "${collData.name}"`);
          created++;
        }
      } catch (error) {
        if (error.code === 11000) {
          console.log(`⏭️  Collection "${collData.name}" already exists (duplicate), skipping...`);
          skipped++;
        } else {
          console.error(`❌ Error creating collection "${collData.name}":`, error.message);
        }
      }
    }
    
    console.log('\n📊 Summary:');
    console.log(`   Created: ${created} collections`);
    console.log(`   Skipped: ${skipped} collections (already exist)`);
    console.log(`   Total collections in database: ${await Collection.countDocuments()}`);
    
    // List all collections
    const allCollections = await Collection.find().sort({ displayOrder: 1, name: 1 });
    console.log('\n📋 All collections:');
    allCollections.forEach((coll, index) => {
      console.log(`   ${index + 1}. ${coll.name} (${coll.isActive ? 'Active' : 'Inactive'}) - ${coll.products?.length || 0} products`);
    });
    
    console.log('\n✅ Collection seeding completed');
    console.log('\n💡 Note: Products with FEATURED tag will automatically appear in all collections');
    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding error:', error);
    process.exit(1);
  }
}

seedCollections();

