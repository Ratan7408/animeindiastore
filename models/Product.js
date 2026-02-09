const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Product name is required'],
    trim: true,
    maxlength: [200, 'Product name cannot exceed 200 characters']
  },
  description: {
    type: String,
    trim: true,
    default: ''
  },
  price: {
    type: Number,
    required: [true, 'Product price is required'],
    min: [0, 'Price cannot be negative']
  },
  discount: {
    type: Number,
    default: 0,
    min: [0, 'Discount cannot be negative'],
    max: [100, 'Discount cannot exceed 100%']
  },
  // Legacy single category (keep for backward compatibility)
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category'
  },
  categoryName: {
    type: String, // Keep for backward compatibility and quick access
    trim: true
  },
  // Multiple categories support
  animeSeries: [{
    type: String,
    enum: ['Attack on Titan', 'Jujutsu Kaisen', 'One Piece', 'Naruto', 'Demon Slayer', 'Berserk'],
    trim: true
  }],
  productTypes: [{
    type: String,
    enum: ['Regular Tshirt', 'Oversized', 'long sleeves', 'Hoodies', 'Action Figures', 'Posters', 'Wigs'],
    trim: true
  }],
  collections: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Collection'
  }],
  sizes: {
    type: [String],
    default: [],
    enum: ['XS', 'S', 'M', 'L', 'XL', 'XXL']
  },
  colors: [{
    name: String,
    hexCode: String
  }],
  tags: [{
    type: String,
    enum: ['TRENDING', 'NEW_ARRIVAL', 'SALE', 'BESTSELLER', 'FEATURED']
  }],
  stockBySize: {
    XS: { type: Number, default: 0 },
    S: { type: Number, default: 0 },
    M: { type: Number, default: 0 },
    L: { type: Number, default: 0 },
    XL: { type: Number, default: 0 },
    XXL: { type: Number, default: 0 }
  },
  images: {
    type: [String],
    default: [],
    validate: {
      validator: function(v) {
        return v.length > 0;
      },
      message: 'At least one product image is required'
    }
  },
  // Color-specific images: { colorName: [imageUrls] }
  imagesByColor: {
    type: Map,
    of: [String],
    default: {}
  },
  stockQuantity: {
    type: Number,
    required: [true, 'Stock quantity is required'],
    min: [0, 'Stock quantity cannot be negative'],
    default: 0
  },
  stockStatus: {
    type: String,
    enum: ['IN_STOCK', 'OUT_OF_STOCK'],
    default: 'OUT_OF_STOCK'
  },
  sku: {
    type: String,
    required: [true, 'SKU is required'],
    unique: true,
    trim: true,
    uppercase: true
  },
  slug: {
    type: String,
    unique: true,
    lowercase: true,
    trim: true,
    sparse: true // Allow null values but enforce uniqueness for non-null
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isNewArrival: {
    type: Boolean,
    default: false
  },
  // Homepage upfront sections: order 1–8 or 1–5 (null = not shown)
  featuredNewArrivalsOrder: { type: Number, min: 1, max: 8, default: null },
  featuredHotSellingOrder: { type: Number, min: 1, max: 8, default: null },
  // Categories for You: per-category positions P1–P6. { "Regular Tshirt": 1, "Hoodies": 2, ... }
  featuredCategoriesForYou: {
    type: Map,
    of: Number,
    default: {}
  },
  // Legacy: keep for backward compat, prefer featuredCategoriesForYou
  featuredCategoriesForYouOrder: { type: Number, min: 1, max: 5, default: null },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes for better query performance
// Note: sku index is automatically created by unique: true, so we don't need to add it again
productSchema.index({ category: 1 });
productSchema.index({ stockStatus: 1 });
productSchema.index({ isActive: 1 });
productSchema.index({ name: 'text', description: 'text' });

// Pre-save middleware to automatically update stockStatus based on stockQuantity
productSchema.pre('save', async function(next) {
  // Generate unique slug from name if not provided
  if (!this.slug && this.name) {
    const baseSlug = this.name.toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\w\-]+/g, '')
      .replace(/\-\-+/g, '-')
      .replace(/^-+/, '')
      .replace(/-+$/, '');
    let slug = baseSlug;
    let suffix = 1;
    let exists = await this.constructor.findOne({ slug, _id: { $ne: this._id } });
    while (exists) {
      slug = `${baseSlug}-${suffix}`;
      suffix++;
      exists = await this.constructor.findOne({ slug, _id: { $ne: this._id } });
    }
    this.slug = slug;
  }
  
  if (this.stockQuantity === 0 && this.stockStatus === 'IN_STOCK') {
    this.stockStatus = 'OUT_OF_STOCK';
  } else if (this.stockQuantity > 0 && this.stockStatus === 'OUT_OF_STOCK') {
    // Only auto-update to IN_STOCK if quantity > 0, but allow manual override
    // This allows admin to manually set OUT_OF_STOCK even if quantity > 0
  }
  this.updatedAt = Date.now();
  next();
});

// Method to calculate sale price
productSchema.methods.getSalePrice = function() {
  if (this.discount > 0) {
    return this.price * (1 - this.discount / 100);
  }
  return this.price;
};

// Static method to get products by stock status
productSchema.statics.getByStockStatus = function(status) {
  return this.find({ stockStatus: status, isActive: true });
};

module.exports = mongoose.model('Product', productSchema);

