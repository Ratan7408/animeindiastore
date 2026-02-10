// @ts-nocheck
/* eslint-disable */
const Product = require('../models/Product');
const Collection = require('../models/Collection');
const Category = require('../models/Category');

// Helper to build absolute image URLs pointing to the backend origin
// so frontend/admin don't depend on their own host for /uploads paths.
// We accept BACKEND_URL as either:
//   - "https://domain.com"
//   - "https://domain.com/api"
// and always normalize it to just "https://domain.com".
const rawBackend = (process.env.BACKEND_URL || '').trim();
let BACKEND_URL = '';
if (rawBackend) {
  try {
    const withScheme =
      rawBackend.startsWith('http://') || rawBackend.startsWith('https://')
        ? rawBackend
        : `http://${rawBackend}`;
    const u = new URL(withScheme);
    BACKEND_URL = u.origin; // protocol + '//' + host
  } catch (e) {
    // Fallback: strip any trailing "/api" and slashes
    BACKEND_URL = rawBackend.replace(/\/api\/?$/i, '').replace(/\/+$/, '');
  }
}
const toImageUrl = (p) => {
  if (!p || typeof p !== 'string') return p;
  if (p.startsWith('http://') || p.startsWith('https://')) return p;
  if (p.startsWith('/uploads/')) {
    return BACKEND_URL ? `${BACKEND_URL}${p}` : p;
  }
  return p;
};

const CATEGORIES_FOR_YOU_TYPES = ['Regular Tshirt', 'Oversized', 'long sleeves', 'Hoodies', 'Action Figures', 'Posters', 'Wigs'];

function parseFeaturedCategoriesForYou(val) {
  const result = {};
  if (!val) return result;
  let obj = val;
  if (typeof val === 'string') {
    try {
      obj = val.trim() ? JSON.parse(val) : {};
    } catch (e) {
      return result;
    }
  }
  if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      const num = parseInt(v, 10);
      if (num >= 1 && num <= 6) result[k] = num;
    }
  }
  return result;
}

// @desc    Get all products (public - filters out inactive)
// @route   GET /api/products
// @access  Public
exports.getAllProducts = async (req, res) => {
  try {
    const {
      category,
      collection,
      stockStatus,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      page = 1,
      limit = 20,
      hideOutOfStock = 'false',
      isNewArrival,
      isHotSelling,
      isCategoriesForYou,
      featuredSection,
      animeSeries,
      productTypes
    } = req.query;

    // Build query
    // Admin users can see all products (including inactive), public users only see active
    const query = {};
    if (!req.admin) {
      query.isActive = true; // Public users only see active products
    } else if (req.query.isActive && req.query.isActive !== 'all') {
      // Admin can filter by isActive if specified
      query.isActive = req.query.isActive === 'true';
    }
    // If admin and isActive='all' or not specified, show all products
    
    // Filter by legacy category (for backward compatibility)
    // Special handling for "Sale" - filter by discount instead of category
    if (category) {
      if (category.toLowerCase() === 'sale') {
        // For Sale, filter products with discount > 0
        query.discount = { $gt: 0 };
        console.log('Sale category detected - filtering by discount > 0');
      } else {
        // Try to find category by name first (for backward compatibility)
        try {
          const foundCategory = await Category.findOne({ 
            $or: [
              { name: category },
              { _id: category }
            ]
          });
          if (foundCategory) {
            query.category = foundCategory._id;
          } else {
            // If category not found, try to match by categoryName field
            query.categoryName = category;
          }
        } catch (categoryError) {
          console.error('Error looking up category:', categoryError);
          // Fallback to categoryName field
          query.categoryName = category;
        }
      }
    }
    
    // Filter by animeSeries (new multi-category system)
    if (animeSeries) {
      query.animeSeries = { $in: [animeSeries] };
    }
    
    // Filter by productTypes (new multi-category system)
    if (productTypes) {
      query.productTypes = { $in: [productTypes] };
    }
    
    // Filter by collection (using collection name or slug)
    if (collection) {
      try {
        const foundCollection = await Collection.findOne({ 
          $or: [
            { name: collection },
            { slug: collection }
          ],
          isActive: true
        });
        
        if (foundCollection) {
          query.collections = foundCollection._id;
        }
      } catch (collectionError) {
        console.error('Error looking up collection:', collectionError);
        // Don't fail the entire request if collection lookup fails
      }
    }
    
    // Filter by stock status
    if (stockStatus) {
      query.stockStatus = stockStatus;
    }
    
    // Hide out of stock products if requested
    if (hideOutOfStock === 'true') {
      query.stockStatus = 'IN_STOCK';
    }
    
    // Filter by new arrival (homepage: only admin-selected products by order)
    if (isNewArrival === 'true') {
      query.featuredNewArrivalsOrder = { $exists: true, $ne: null, $gte: 1, $lte: 8 };
    }
    
    // Filter by hot selling (homepage: only admin-selected products by order)
    if (isHotSelling === 'true') {
      query.featuredHotSellingOrder = { $exists: true, $ne: null, $gte: 1, $lte: 8 };
    }
    
    // Filter by categories for you (homepage: per-category P1-P6, admin-selected products)
    // Products must have the matching product type so T-Shirts don't show under Oversized and vice versa
    if (isCategoriesForYou === 'true') {
      const categoryForYou = req.query.categoryForYou || productTypes;
      if (categoryForYou) {
        const featuredKey = `featuredCategoriesForYou.${categoryForYou}`;
        // Require product to have this category in productTypes so position matches section
        const baseQuery = { ...query, isActive: true, productTypes: { $in: [categoryForYou] } };
        const hasFeatured = await Product.exists({
          ...baseQuery,
          [featuredKey]: { $exists: true, $gte: 1, $lte: 6 }
        });
        if (hasFeatured) {
          query[featuredKey] = { $exists: true, $gte: 1, $lte: 6 };
          query.productTypes = { $in: [categoryForYou] };
        }
        // Else: no admin-selected products for this category, fallback to productTypes filter below
      }
    }
    
    // Admin filter: show products that are in a specific upfront section
    if (req.admin && featuredSection) {
      if (featuredSection === 'newArrivals') {
        query.featuredNewArrivalsOrder = { $exists: true, $ne: null };
      } else if (featuredSection === 'hotSelling') {
        query.featuredHotSellingOrder = { $exists: true, $ne: null };
      } else if (featuredSection === 'categoriesForYou') {
        query.$or = [
          { 'featuredCategoriesForYou.Regular Tshirt': { $exists: true } },
          { 'featuredCategoriesForYou.Oversized': { $exists: true } },
          { 'featuredCategoriesForYou.long sleeves': { $exists: true } },
          { 'featuredCategoriesForYou.Hoodies': { $exists: true } },
          { 'featuredCategoriesForYou.Action Figures': { $exists: true } },
          { 'featuredCategoriesForYou.Posters': { $exists: true } },
          { 'featuredCategoriesForYou.Wigs': { $exists: true } },
          { featuredCategoriesForYouOrder: { $exists: true, $ne: null } }
        ];
      }
    }
    
    // Filter by featured (using FEATURED tag)
    if (req.query.isFeatured === 'true') {
      // If tags already exists (from isHotSelling), combine them
      if (query.tags && query.tags.$in) {
        query.tags = { $in: [...query.tags.$in, 'FEATURED'] };
      } else {
        query.tags = { $in: ['FEATURED'] };
      }
    }
    
    // Search by name or SKU
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { sku: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    // Pagination and sort (homepage upfront sections use fixed limit and order)
    let pageNum = parseInt(page);
    let limitNum = parseInt(limit);
    let skip = (pageNum - 1) * limitNum;
    const sort = {};
    if (isNewArrival === 'true') {
      sort.featuredNewArrivalsOrder = 1;
      limitNum = 8;
      skip = 0;
    } else if (isHotSelling === 'true') {
      sort.featuredHotSellingOrder = 1;
      limitNum = 8;
      skip = 0;
    } else if (isCategoriesForYou === 'true') {
      const categoryForYou = req.query.categoryForYou || req.query.productTypes;
      if (categoryForYou && query[`featuredCategoriesForYou.${categoryForYou}`]) {
        sort[`featuredCategoriesForYou.${categoryForYou}`] = 1;
      } else {
        sort.createdAt = -1; // Fallback: newest first
      }
      limitNum = 6;
      skip = 0;
    } else {
      sort[sortBy] = sortOrder === 'asc' ? 1 : -1;
    }

    // Log query for debugging
    console.log('Product query:', JSON.stringify(query, null, 2));

    // Execute query
    let products;
    let total;
    try {
      products = await Product.find(query)
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .select('-__v')
        .lean(); // Use lean() to get plain JavaScript objects

      total = await Product.countDocuments(query);
      console.log(`Found ${products.length} products (total: ${total})`);
    } catch (queryError) {
      console.error('Error executing product query:', queryError);
      throw queryError;
    }

    res.json({
      success: true,
      count: products.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
      data: products
    });
  } catch (error) {
    console.error('Error in getAllProducts:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Error fetching products',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

// @desc    Get single product by ID or slug
// @route   GET /api/products/:id
// @route   GET /api/products/slug/:slug
// @access  Public
exports.getProduct = async (req, res) => {
  try {
    let product;
    const { id, slug } = req.params;
    
    // Check if it's a slug route
    if (slug) {
      product = await Product.findOne({ slug: slug }).lean();
    } else {
      // Try as ObjectId first, then as slug
      if (id.match(/^[0-9a-fA-F]{24}$/)) {
        product = await Product.findById(id).lean();
      } else {
        product = await Product.findOne({ slug: id }).lean();
      }
    }
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Only return active products to public
    if (!product.isActive && !req.admin) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Serialize imagesByColor Map to plain object so JSON response includes it (Map otherwise becomes {})
    if (product.imagesByColor && typeof product.imagesByColor.entries === 'function') {
      product.imagesByColor = Object.fromEntries(product.imagesByColor);
    }

    res.json({
      success: true,
      data: product
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching product',
      error: error.message
    });
  }
};

// @desc    Create product (Admin only)
// @route   POST /api/products
// @access  Private/Admin
exports.createProduct = async (req, res) => {
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

    // Handle multiple image uploads
    let images = [];
    if (req.files && req.files.length > 0) {
      // Multiple files uploaded
      images = req.files.map(file => toImageUrl(`/uploads/${file.filename}`));
    } else if (req.file) {
      // Single file (backward compatibility)
      images.push(toImageUrl(`/uploads/${req.file.filename}`));
    } else if (req.body.images && Array.isArray(req.body.images)) {
      // Existing images from edit (filter out any non-string values)
      images = req.body.images
        .filter(img => typeof img === 'string' && img.trim().length > 0)
        .map(toImageUrl);
    } else if (req.body.image && typeof req.body.image === 'string' && req.body.image.trim().length > 0) {
      // Single existing image (backward compatibility)
      images = [toImageUrl(req.body.image)];
    }

    console.log('🖼️ Images array:', images);

    if (images.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one product image is required'
      });
    }

    // Handle imagesByColor if provided
    let imagesByColor = {};
    if (req.body.imagesByColor) {
      try {
        imagesByColor = typeof req.body.imagesByColor === 'string' 
          ? JSON.parse(req.body.imagesByColor) 
          : req.body.imagesByColor;
        
        // Convert image indices to actual image URLs
        const imagesByColorWithUrls = {};
        Object.keys(imagesByColor).forEach(colorName => {
          const imageIndices = imagesByColor[colorName];
          if (Array.isArray(imageIndices)) {
            imagesByColorWithUrls[colorName] = imageIndices
              .filter(idx => idx >= 0 && idx < images.length)
              .map(idx => images[idx]);
          }
        });
        imagesByColor = imagesByColorWithUrls;
      } catch (e) {
        console.error('Error parsing imagesByColor:', e.message);
        imagesByColor = {};
      }
    }

    // Calculate stock status
    const stockQuantity = parseInt(req.body.stockQuantity) || 0;
    let stockStatus = req.body.stockStatus || (stockQuantity > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK');

    // Parse tags if provided
    let tags = [];
    if (req.body.tags) {
      try {
        tags = typeof req.body.tags === 'string' ? JSON.parse(req.body.tags) : req.body.tags;
      } catch (e) {
        tags = [];
      }
    }

    // Parse sizes if provided
    let sizes = [];
    const validSizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
    if (req.body.sizes) {
      try {
        sizes = typeof req.body.sizes === 'string' ? JSON.parse(req.body.sizes) : req.body.sizes;
        // Validate sizes against enum
        sizes = sizes.filter(size => validSizes.includes(size));
      } catch (e) {
        console.error('Error parsing sizes:', e.message);
        sizes = [];
      }
    }

    // Parse colors if provided
    let colors = [];
    if (req.body.colors) {
      try {
        colors = typeof req.body.colors === 'string' ? JSON.parse(req.body.colors) : req.body.colors;
        // Validate colors structure
        if (Array.isArray(colors)) {
          colors = colors.filter(color => color && typeof color === 'object' && color.name && color.hexCode);
        } else {
          colors = [];
        }
      } catch (e) {
        console.error('Error parsing colors:', e.message);
        colors = [];
      }
    }

    // Handle multiple categories (animeSeries and productTypes)
    let animeSeries = [];
    let productTypes = [];
    
    // Parse animeSeries from request
    if (req.body.animeSeries) {
      try {
        animeSeries = typeof req.body.animeSeries === 'string' ? JSON.parse(req.body.animeSeries) : req.body.animeSeries;
        if (!Array.isArray(animeSeries)) animeSeries = [];
      } catch (e) {
        animeSeries = [];
      }
    }
    
    // Parse productTypes from request
    if (req.body.productTypes) {
      try {
        productTypes = typeof req.body.productTypes === 'string' ? JSON.parse(req.body.productTypes) : req.body.productTypes;
        if (!Array.isArray(productTypes)) productTypes = [];
      } catch (e) {
        productTypes = [];
      }
    }
    
    // Validate at least one product type is selected (animeSeries is optional)
    if (productTypes.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please select at least one Product Type'
      });
    }
    
    // Handle legacy single category for backward compatibility
    // Only set category if we have a valid ObjectId, otherwise leave it undefined
    let categoryId = null;
    let categoryName = productTypes.length > 0 ? productTypes[0] : null;
    
    // Only process category if it's provided and looks like an ObjectId
    if (req.body.category) {
      const categoryValue = req.body.category.trim();
      if (categoryValue.match(/^[0-9a-fA-F]{24}$/)) {
        // It's already an ObjectId
        const category = await Category.findById(categoryValue);
        if (category) {
          categoryId = category._id;
          categoryName = category.name;
        }
      } else {
        // It's a category name, try to find it
        const normalizedSearch = categoryValue;
        const nameRegex = new RegExp(`^${normalizedSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
        const category = await Category.findOne({ 
          name: { $regex: nameRegex }, 
          isActive: true 
        });
        if (category) {
          categoryId = category._id;
          categoryName = category.name;
        }
      }
    }

    // Validate SKU before processing
    if (!req.body.sku || typeof req.body.sku !== 'string' || req.body.sku.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'SKU is required and must be a non-empty string'
      });
    }

    // Ensure productTypes includes any Categories for You section so products show in the right place
    const cfyCreate = parseFeaturedCategoriesForYou(req.body.featuredCategoriesForYou);
    const cfyCats = Object.keys(cfyCreate).filter(k => cfyCreate[k] >= 1 && cfyCreate[k] <= 6);
    if (cfyCats.length > 0) {
      productTypes = [...new Set([...productTypes, ...cfyCats])].filter(t => CATEGORIES_FOR_YOU_TYPES.includes(t));
    }

    const productData = {
      name: req.body.name,
      description: req.body.description || '',
      price: parseFloat(req.body.price),
      discount: parseFloat(req.body.discount) || 0,
      animeSeries: animeSeries, // New: Multiple anime series categories
      productTypes: productTypes, // New: Multiple product type categories
      images: images,
      imagesByColor: imagesByColor, // Color-specific images
      stockQuantity: stockQuantity,
      stockStatus: stockStatus,
      sku: req.body.sku.trim().toUpperCase(),
      isActive: req.body.isActive === undefined || req.body.isActive === 'true' || req.body.isActive === true,
      isNewArrival: req.body.isNewArrival === 'true' || req.body.isNewArrival === true,
      tags: tags,
      sizes: sizes,
      colors: colors,
      featuredNewArrivalsOrder: req.body.featuredNewArrivalsOrder ? parseInt(req.body.featuredNewArrivalsOrder, 10) : null,
      featuredHotSellingOrder: req.body.featuredHotSellingOrder ? parseInt(req.body.featuredHotSellingOrder, 10) : null,
      featuredCategoriesForYou: parseFeaturedCategoriesForYou(req.body.featuredCategoriesForYou),
      featuredCategoriesForYouOrder: req.body.featuredCategoriesForYouOrder ? parseInt(req.body.featuredCategoriesForYouOrder, 10) : null
    };
    
    // Only add legacy category fields if we have valid values
    if (categoryId) {
      productData.category = categoryId; // Legacy field for backward compatibility
    }
    if (categoryName) {
      productData.categoryName = categoryName; // Legacy field for backward compatibility
    }

    const product = await Product.create(productData);

    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      data: product
    });
  } catch (error) {
    console.error('❌ Product creation error:', {
      message: error.message,
      name: error.name,
      code: error.code,
      keyPattern: error.keyPattern,
      keyValue: error.keyValue,
      stack: error.stack,
      body: req.body,
      files: req.files ? req.files.length : 0
    });
    
    if (error.code === 11000) {
      const field = error.keyPattern?.sku ? 'SKU' : (error.keyPattern?.slug ? 'slug (product name)' : 'unique field');
      return res.status(400).json({
        success: false,
        message: field === 'SKU' ? 'Product with this SKU already exists' : `A product with this ${field} already exists. Try a different product name or SKU.`
      });
    }
    
    // Handle validation errors (Mongoose)
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors || {}).map(err => err.message).join(', ');
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        error: validationErrors || error.message,
        details: error.errors
      });
    }
    
    // Handle express-validator errors (they come through as array)
    if (Array.isArray(error)) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: error
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Error creating product',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

// @desc    Update product (Admin only)
// @route   PUT /api/products/:id
// @access  Private/Admin
exports.updateProduct = async (req, res) => {
  try {
    // Log incoming request body immediately
    console.log('📥 Incoming request body:', {
      allKeys: Object.keys(req.body),
      colors: req.body.colors,
      colorsType: typeof req.body.colors,
      sizes: req.body.sizes,
      sizesType: typeof req.body.sizes,
      contentType: req.headers['content-type']
    });
    
    let product = await Product.findById(req.params.id);
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Handle multiple image uploads
    let images = (product.images || []).map(toImageUrl);
    
    if (req.files && req.files.length > 0) {
      // New images uploaded - add them to existing images
      const newImages = req.files.map(file => toImageUrl(`/uploads/${file.filename}`));
      images = [...images, ...newImages];
      req.body.images = images;
    } else if (req.file) {
      // Single file (backward compatibility)
      images.push(toImageUrl(`/uploads/${req.file.filename}`));
      req.body.images = images;
    } else if (req.body.images) {
      // Images provided in body (existing images from edit)
      if (Array.isArray(req.body.images)) {
        images = req.body.images
          .filter(img => typeof img === 'string' && img.trim().length > 0)
          .map(toImageUrl);
      } else if (typeof req.body.images === 'string') {
        try {
          const parsed = JSON.parse(req.body.images);
          images = Array.isArray(parsed) ? parsed.map(toImageUrl) : images;
        } catch (e) {
          images = (product.images || []).map(toImageUrl);
        }
      }
      req.body.images = images;
    }
    
    // Ensure at least one image
    if (images.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one product image is required'
      });
    }

    // Handle imagesByColor if provided
    let imagesByColor = product.imagesByColor || {};
    if (req.body.imagesByColor) {
      try {
        const parsed = typeof req.body.imagesByColor === 'string' 
          ? JSON.parse(req.body.imagesByColor) 
          : req.body.imagesByColor;
        
        // Convert image indices to actual image URLs
        const imagesByColorWithUrls = {};
        Object.keys(parsed).forEach(colorName => {
          const imageIndices = parsed[colorName];
          if (Array.isArray(imageIndices)) {
            imagesByColorWithUrls[colorName] = imageIndices
              .filter(idx => idx >= 0 && idx < images.length)
              .map(idx => images[idx]);
          }
        });
        imagesByColor = imagesByColorWithUrls;
      } catch (e) {
        console.error('Error parsing imagesByColor:', e.message);
        // Keep existing imagesByColor if parsing fails
      }
    }

    // Update stock status based on quantity if not explicitly set
    if (req.body.stockQuantity !== undefined) {
      const stockQuantity = parseInt(req.body.stockQuantity);
      if (stockQuantity === 0 && !req.body.stockStatus) {
        req.body.stockStatus = 'OUT_OF_STOCK';
      }
    }

    // Parse tags if provided
    if (req.body.tags) {
      try {
        req.body.tags = typeof req.body.tags === 'string' ? JSON.parse(req.body.tags) : req.body.tags;
      } catch (e) {
        req.body.tags = [];
      }
    }

    // Parse sizes if provided
    if (req.body.sizes !== undefined && req.body.sizes !== null) {
      // Handle empty string as empty array
      if (req.body.sizes === '' || req.body.sizes === '[]') {
        req.body.sizes = [];
      } else {
        try {
          if (typeof req.body.sizes === 'string') {
            const parsed = JSON.parse(req.body.sizes);
            req.body.sizes = Array.isArray(parsed) ? parsed : [];
          } else if (Array.isArray(req.body.sizes)) {
            req.body.sizes = req.body.sizes;
          } else {
            req.body.sizes = [];
          }
        } catch (e) {
          console.error('Error parsing sizes:', e.message);
          req.body.sizes = [];
        }
      }
    } else {
      delete req.body.sizes;
    }
    
    // Final verification
    if (req.body.sizes !== undefined) {
      if (!Array.isArray(req.body.sizes)) {
        req.body.sizes = [];
      }
    }

    // Parse colors if provided
    if (req.body.colors !== undefined && req.body.colors !== null) {
      // Handle empty string as empty array
      if (req.body.colors === '' || req.body.colors === '[]') {
        req.body.colors = [];
      } else {
        try {
          if (typeof req.body.colors === 'string') {
            const parsed = JSON.parse(req.body.colors);
            req.body.colors = Array.isArray(parsed) ? parsed : [];
          } else if (Array.isArray(req.body.colors)) {
            req.body.colors = req.body.colors;
          } else {
            req.body.colors = [];
          }
        } catch (e) {
          console.error('Error parsing colors:', e.message);
          req.body.colors = [];
        }
      }
    } else {
      // If colors field is not provided, don't update it (keep existing)
      delete req.body.colors;
    }
    
    // Final verification
    if (req.body.colors !== undefined) {
      if (!Array.isArray(req.body.colors)) {
        req.body.colors = [];
      }
    }

    // Handle multiple categories (animeSeries and productTypes)
    if (req.body.animeSeries !== undefined) {
      try {
        req.body.animeSeries = typeof req.body.animeSeries === 'string' ? JSON.parse(req.body.animeSeries) : req.body.animeSeries;
        if (!Array.isArray(req.body.animeSeries)) req.body.animeSeries = [];
      } catch (e) {
        req.body.animeSeries = product.animeSeries || [];
      }
    }
    
    if (req.body.productTypes !== undefined) {
      try {
        req.body.productTypes = typeof req.body.productTypes === 'string' ? JSON.parse(req.body.productTypes) : req.body.productTypes;
        if (!Array.isArray(req.body.productTypes)) req.body.productTypes = [];
      } catch (e) {
        req.body.productTypes = product.productTypes || [];
      }
    }
    
    // Validate at least one product type is selected if updating (animeSeries is optional)
    if (req.body.productTypes !== undefined) {
      if (req.body.productTypes.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Please select at least one Product Type'
        });
      }
    }
    
    // Handle legacy single category for backward compatibility
    if (req.body.category) {
      let categoryId = req.body.category;
      // Check if it's already a valid ObjectId
      if (!categoryId.match(/^[0-9a-fA-F]{24}$/)) {
        // It's a category name, find the category by name or slug
        let category = await Category.findOne({ 
          name: { $regex: new RegExp(`^${categoryId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }, 
          isActive: true 
        });
        
        if (!category) {
          const slug = categoryId.toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-]+/g, '');
          category = await Category.findOne({ 
            slug: slug, 
            isActive: true 
          });
        }
        
        if (category) {
          req.body.category = category._id;
          req.body.categoryName = category.name;
        }
      } else {
        // It's an ObjectId, verify it exists and get the name
        const category = await Category.findById(categoryId);
        if (category) {
          req.body.categoryName = category.name;
        }
      }
    } else if (req.body.productTypes && req.body.productTypes.length > 0) {
      // Set first product type as legacy category name
      req.body.categoryName = req.body.productTypes[0];
    }

    // Handle isNewArrival boolean conversion
    if (req.body.isNewArrival !== undefined) {
      req.body.isNewArrival = req.body.isNewArrival === 'true' || req.body.isNewArrival === true;
    }

    // Homepage upfront order fields (null or 1–8 / 1–5)
    if (req.body.featuredNewArrivalsOrder !== undefined) {
      const v = req.body.featuredNewArrivalsOrder;
      req.body.featuredNewArrivalsOrder = (v === '' || v === null || v === undefined) ? null : Math.min(8, Math.max(1, parseInt(v, 10) || 0)) || null;
    }
    if (req.body.featuredHotSellingOrder !== undefined) {
      const v = req.body.featuredHotSellingOrder;
      req.body.featuredHotSellingOrder = (v === '' || v === null || v === undefined) ? null : Math.min(8, Math.max(1, parseInt(v, 10) || 0)) || null;
    }
    if (req.body.featuredCategoriesForYouOrder !== undefined) {
      const v = req.body.featuredCategoriesForYouOrder;
      req.body.featuredCategoriesForYouOrder = (v === '' || v === null || v === undefined) ? null : Math.min(5, Math.max(1, parseInt(v, 10) || 0)) || null;
    }
    if (req.body.featuredCategoriesForYou !== undefined) {
      req.body.featuredCategoriesForYou = parseFeaturedCategoriesForYou(req.body.featuredCategoriesForYou);
      // Ensure product has each Categories-for-You category in productTypes so they show in the right section
      const cfy = req.body.featuredCategoriesForYou || {};
      const cfyCategories = Object.keys(cfy).filter(k => cfy[k] >= 1 && cfy[k] <= 6);
      if (cfyCategories.length > 0) {
        const existing = Array.isArray(req.body.productTypes) ? req.body.productTypes : (product.productTypes || []);
        const combined = [...new Set([...existing, ...cfyCategories])].filter(t => CATEGORIES_FOR_YOU_TYPES.includes(t));
        req.body.productTypes = combined;
      }
    }

    // Prepare update data - only include fields that should be updated
    // Note: req.body.colors and req.body.sizes should already be parsed above
    const updateData = {};
    
    // Copy all fields except colors and sizes first
    Object.keys(req.body).forEach(key => {
      if (key !== 'colors' && key !== 'sizes') {
        updateData[key] = req.body[key];
      }
    });
    
    // Now add colors and sizes, ensuring they are arrays
    // Double-check and force conversion if needed
    if (req.body.colors !== undefined) {
      if (Array.isArray(req.body.colors)) {
        updateData.colors = req.body.colors;
      } else {
        // Force parse one more time
        try {
          if (typeof req.body.colors === 'string') {
            updateData.colors = JSON.parse(req.body.colors);
          } else {
            updateData.colors = [];
          }
        } catch (e) {
          updateData.colors = [];
        }
      }
    }
    
    if (req.body.sizes !== undefined) {
      if (Array.isArray(req.body.sizes)) {
        updateData.sizes = req.body.sizes;
      } else {
        // Force parse one more time
        try {
          if (typeof req.body.sizes === 'string') {
            updateData.sizes = JSON.parse(req.body.sizes);
          } else {
            updateData.sizes = [];
          }
        } catch (e) {
          updateData.sizes = [];
        }
      }
    }
    
    // Final safety check - ensure colors and sizes are arrays before saving
    if (updateData.colors !== undefined) {
      if (typeof updateData.colors === 'string') {
        try {
          updateData.colors = JSON.parse(updateData.colors);
        } catch (e) {
          updateData.colors = [];
        }
      }
      if (!Array.isArray(updateData.colors)) {
        updateData.colors = [];
      }
    }
    
    if (updateData.sizes !== undefined) {
      if (typeof updateData.sizes === 'string') {
        try {
          updateData.sizes = JSON.parse(updateData.sizes);
        } catch (e) {
          updateData.sizes = [];
        }
      }
      if (!Array.isArray(updateData.sizes)) {
        updateData.sizes = [];
      }
    }
    
    // Create a clean update object with only valid fields
    const cleanUpdateData = {};
    
    // Copy all non-array fields
    Object.keys(updateData).forEach(key => {
      if (key !== 'colors' && key !== 'sizes' && key !== '_id' && key !== '__v') {
        cleanUpdateData[key] = updateData[key];
      }
    });
    
    // Handle colors - ensure it's an array of objects with name and hexCode
    if (updateData.colors !== undefined) {
      if (Array.isArray(updateData.colors)) {
        // Validate and clean each color object
        cleanUpdateData.colors = updateData.colors
          .filter(color => color && (color.name || color.hexCode))
          .map(color => ({
            name: color.name || '',
            hexCode: color.hexCode || '#000000'
          }));
      } else if (typeof updateData.colors === 'string') {
        try {
          const parsed = JSON.parse(updateData.colors);
          if (Array.isArray(parsed)) {
            cleanUpdateData.colors = parsed
              .filter(color => color && (color.name || color.hexCode))
              .map(color => ({
                name: color.name || '',
                hexCode: color.hexCode || '#000000'
              }));
          } else {
            cleanUpdateData.colors = [];
          }
        } catch (e) {
          console.error('❌ Final colors parse failed:', e);
          cleanUpdateData.colors = [];
        }
      } else {
        cleanUpdateData.colors = [];
      }
    }
    
    // Handle sizes - ensure it's an array of valid enum values
    if (updateData.sizes !== undefined) {
      const validSizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
      if (Array.isArray(updateData.sizes)) {
        // Filter to only include valid enum values
        cleanUpdateData.sizes = updateData.sizes.filter(size => validSizes.includes(size));
      } else if (typeof updateData.sizes === 'string') {
        try {
          const parsed = JSON.parse(updateData.sizes);
          if (Array.isArray(parsed)) {
            cleanUpdateData.sizes = parsed.filter(size => validSizes.includes(size));
          } else {
            cleanUpdateData.sizes = [];
          }
        } catch (e) {
          console.error('❌ Final sizes parse failed:', e);
          cleanUpdateData.sizes = [];
        }
      } else {
        cleanUpdateData.sizes = [];
      }
    }
    
    // Add imagesByColor to update data if provided
    if (imagesByColor && Object.keys(imagesByColor).length > 0) {
      cleanUpdateData.imagesByColor = imagesByColor;
    }
    
    // Update product
    try {
      product = await Product.findByIdAndUpdate(
        req.params.id,
        cleanUpdateData,
        { new: true, runValidators: true }
      );
    } catch (dbError) {
      console.error('Database update error:', dbError);
      throw dbError;
    }

    res.json({
      success: true,
      message: 'Product updated successfully',
      data: product
    });
  } catch (error) {
    console.error('Product update error:', error);
    
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Product with this SKU already exists'
      });
    }
    
    // Provide more detailed error information
    const errorMessage = error.message || 'Unknown error';
    const validationErrors = error.errors ? Object.keys(error.errors).map(key => ({
      field: key,
      message: error.errors[key].message
    })) : null;
    
    res.status(500).json({
      success: false,
      message: 'Error updating product',
      error: errorMessage,
      details: validationErrors ? validationErrors : errorMessage,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

// @desc    Delete product (Admin only)
// @route   DELETE /api/products/:id
// @access  Private/Admin
exports.deleteProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    await Product.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Product deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting product',
      error: error.message
    });
  }
};

// @desc    Bulk delete products (Admin only)
// @route   POST /api/products/bulk-delete
// @access  Private/Admin
async function bulkDeleteProducts(req, res) {
  try {
    const { productIds } = req.body;

    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide an array of product IDs'
      });
    }

    const result = await Product.deleteMany({ _id: { $in: productIds } });

    res.json({
      success: true,
      message: `${result.deletedCount} product(s) deleted successfully`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting products',
      error: error.message
    });
  }
}

exports.bulkDeleteProducts = bulkDeleteProducts;

// @desc    Bulk update stock status (Admin only)
// @route   POST /api/products/bulk-stock-update
// @access  Private/Admin
async function bulkUpdateStock(req, res) {
  try {
    const { productIds, stockStatus, stockQuantity } = req.body;
    
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide an array of product IDs'
      });
    }

    const updateData = {};
    if (stockStatus) {
      updateData.stockStatus = stockStatus;
    }
    if (stockQuantity !== undefined) {
      updateData.stockQuantity = parseInt(stockQuantity);
      // Auto-update stock status if quantity is set
      if (updateData.stockQuantity === 0) {
        updateData.stockStatus = 'OUT_OF_STOCK';
      } else if (updateData.stockQuantity > 0 && !stockStatus) {
        updateData.stockStatus = 'IN_STOCK';
      }
    }

    const result = await Product.updateMany(
      { _id: { $in: productIds } },
      { $set: updateData }
    );

    res.json({
      success: true,
      message: `${result.modifiedCount} product(s) updated successfully`,
      modifiedCount: result.modifiedCount
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating products',
      error: error.message
    });
  }
}

exports.bulkUpdateStock = bulkUpdateStock;

// @desc    Bulk set a specific size stock to 0 for many products
// @route   POST /api/products/bulk-size-stock-update
// @access  Private/Admin
exports.bulkUpdateSizeStock = async (req, res) => {
  try {
    const { productIds, size } = req.body;
    const validSizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide an array of product IDs'
      });
    }

    if (!size || !validSizes.includes(size)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid size (XS, S, M, L, XL, XXL)'
      });
    }

    const products = await Product.find({ _id: { $in: productIds } });
    let modifiedCount = 0;

    for (const product of products) {
      const stockBySize = product.stockBySize || {};
      if (stockBySize[size] === 0 || stockBySize[size] === undefined) {
        // nothing to change for this product
        continue;
      }
      stockBySize[size] = 0;
      product.stockBySize = stockBySize;

      // Recalculate total stock from all sizes if any are set, otherwise keep existing quantity
      const totalFromSizes = validSizes.reduce((sum, s) => sum + (stockBySize[s] || 0), 0);
      if (!isNaN(totalFromSizes) && totalFromSizes >= 0) {
        product.stockQuantity = totalFromSizes;
      }

      // Update stockStatus: if all sizes 0 and quantity 0 → OUT_OF_STOCK, else keep IN_STOCK
      if (product.stockQuantity === 0) {
        product.stockStatus = 'OUT_OF_STOCK';
      } else if (product.stockStatus !== 'IN_STOCK') {
        product.stockStatus = 'IN_STOCK';
      }
    
      await product.save();
      modifiedCount += 1;
    }

    res.json({
      success: true,
      message: `${modifiedCount} product(s) updated successfully for size ${size}`,
      modifiedCount
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating size stock',
      error: error.message
    });
  }
};

// @desc    Get out of stock products (Admin only)
// @route   GET /api/products/out-of-stock
// @access  Private/Admin
exports.getOutOfStockProducts = async (req, res) => {
  try {
    const products = await Product.find({ stockStatus: 'OUT_OF_STOCK' })
      .sort({ updatedAt: -1 });

    res.json({
      success: true,
      count: products.length,
      data: products
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching out of stock products',
      error: error.message
    });
  }
};

// @desc    Get Categories for You occupied slots (Admin only)
// @route   GET /api/products/categories-for-you-slots
// @access  Private/Admin
exports.getCategoriesForYouSlots = async (req, res) => {
  try {
    const products = await Product.find({
      $or: [
        { 'featuredCategoriesForYou.Regular Tshirt': { $exists: true } },
        { 'featuredCategoriesForYou.Oversized': { $exists: true } },
        { 'featuredCategoriesForYou.long sleeves': { $exists: true } },
        { 'featuredCategoriesForYou.Hoodies': { $exists: true } },
        { 'featuredCategoriesForYou.Action Figures': { $exists: true } },
        { 'featuredCategoriesForYou.Posters': { $exists: true } },
        { 'featuredCategoriesForYou.Wigs': { $exists: true } }
      ]
    }).select('name featuredCategoriesForYou').lean();

    const slots = {
      'Regular Tshirt': {},
      'Oversized': {},
      'long sleeves': {},
      'Hoodies': {},
      'Action Figures': {},
      'Posters': {},
      'Wigs': {}
    };

    // Build a simple map of occupied slots per category without nested arrow functions,
    // to keep older JS/TS parsers happy.
    for (const p of products) {
      const cfy = p.featuredCategoriesForYou || {};
      const obj =
        cfy && typeof cfy.toObject === 'function'
          ? cfy.toObject()
          : (cfy && typeof cfy === 'object' ? cfy : {});

      const entries = Object.entries(obj);
      for (const entry of entries) {
        const cat = entry[0];
        const pos = entry[1];
        const posNum = parseInt(pos, 10);
        if (posNum >= 1 && posNum <= 6 && slots[cat] !== undefined) {
          slots[cat][String(posNum)] = {
            productId: String(p._id),
            productName: p.name || 'Unknown'
          };
        }
      }
    }

    res.json({ success: true, data: slots });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching categories for you slots',
      error: error.message
    });
  }
};
