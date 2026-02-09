const mongoose = require('mongoose');
const Category = require('../models/Category');
require('dotenv').config();

// Common categories for anime/web merchandise
const categories = [
  { name: 'T-shirts', description: 'T-shirts (Oversized, Regular, Full Sleeves)', displayOrder: 1 },
  { name: 'Hoodies', description: 'Hoodies and sweatshirts', displayOrder: 2 },
  { name: 'Action Figures', description: 'Action figures and collectibles', displayOrder: 3 },
  { name: 'Posters', description: 'Posters and wall art', displayOrder: 4 }
];

async function seedCategories() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/animeweb');
    
    console.log('✅ Connected to MongoDB');
    
    // Delete "Tshirt" category if it exists
    const tshirtDeleted = await Category.deleteOne({ name: 'Tshirt' });
    if (tshirtDeleted.deletedCount > 0) {
      console.log('✅ Deleted "Tshirt" category');
    } else {
      console.log('ℹ️  "Tshirt" category not found (may have been already deleted)');
    }
    
    // Create categories
    let created = 0;
    let skipped = 0;
    
    for (const catData of categories) {
      try {
        const existing = await Category.findOne({ name: catData.name });
        if (existing) {
          console.log(`⏭️  Category "${catData.name}" already exists, skipping...`);
          skipped++;
        } else {
          await Category.create(catData);
          console.log(`✅ Created category: "${catData.name}"`);
          created++;
        }
      } catch (error) {
        if (error.code === 11000) {
          console.log(`⏭️  Category "${catData.name}" already exists (duplicate), skipping...`);
          skipped++;
        } else {
          console.error(`❌ Error creating category "${catData.name}":`, error.message);
        }
      }
    }
    
    console.log('\n📊 Summary:');
    console.log(`   Created: ${created} categories`);
    console.log(`   Skipped: ${skipped} categories (already exist)`);
    console.log(`   Total categories in database: ${await Category.countDocuments()}`);
    
    // List all categories
    const allCategories = await Category.find().sort({ displayOrder: 1, name: 1 });
    console.log('\n📋 All categories:');
    allCategories.forEach((cat, index) => {
      console.log(`   ${index + 1}. ${cat.name} (${cat.isActive ? 'Active' : 'Inactive'})`);
    });
    
    console.log('\n✅ Category seeding completed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding error:', error);
    process.exit(1);
  }
}

seedCategories();

