const mongoose = require('mongoose');
const Category = require('../models/Category');
const Product = require('../models/Product');
require('dotenv').config();

async function deleteTshirtCategory() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/animeweb');
    
    console.log('✅ Connected to MongoDB');
    
    // Find the Tshirt category
    const tshirtCategory = await Category.findOne({ name: 'Tshirt' });
    
    if (!tshirtCategory) {
      console.log('ℹ️  "Tshirt" category not found in database');
      
      // Also check for variations
      const variations = await Category.find({ 
        $or: [
          { name: /^tshirt$/i },
          { name: /^t-shirt$/i },
          { name: /^t shirt$/i }
        ]
      });
      
      if (variations.length > 0) {
        console.log(`\n⚠️  Found ${variations.length} similar category(ies):`);
        variations.forEach(cat => {
          console.log(`   - "${cat.name}" (ID: ${cat._id})`);
        });
        console.log('\nDeleting similar categories...');
        for (const cat of variations) {
          await Category.findByIdAndDelete(cat._id);
          console.log(`✅ Deleted: "${cat.name}"`);
        }
      } else {
        console.log('✅ No "Tshirt" category or variations found');
      }
    } else {
      console.log(`\n📋 Found "Tshirt" category:`);
      console.log(`   ID: ${tshirtCategory._id}`);
      console.log(`   Name: ${tshirtCategory.name}`);
      console.log(`   Slug: ${tshirtCategory.slug}`);
      console.log(`   Active: ${tshirtCategory.isActive}`);
      
      // Check if any products use this category
      const productsUsingCategory = await Product.countDocuments({ 
        category: tshirtCategory._id 
      });
      
      if (productsUsingCategory > 0) {
        console.log(`\n⚠️  Warning: ${productsUsingCategory} product(s) are using this category`);
        console.log('   Products will need to be updated to use a different category');
      }
      
      // Delete the category
      await Category.findByIdAndDelete(tshirtCategory._id);
      console.log('\n✅ Successfully deleted "Tshirt" category from database');
    }
    
    // List all remaining categories
    const allCategories = await Category.find().sort({ name: 1 });
    console.log(`\n📋 Remaining categories (${allCategories.length}):`);
    if (allCategories.length === 0) {
      console.log('   No categories found');
    } else {
      allCategories.forEach((cat, index) => {
        console.log(`   ${index + 1}. ${cat.name} (${cat.isActive ? 'Active' : 'Inactive'})`);
      });
    }
    
    console.log('\n✅ Operation completed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

deleteTshirtCategory();

