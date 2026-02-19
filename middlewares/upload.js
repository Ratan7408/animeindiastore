const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Upload directory:
// - Prefer UPLOAD_PATH from .env (same as server.js static /uploads route)
// - Fallback to ../frontend/public/uploads (older monorepo layout)
const resolveUploadDir = () => {
  const envPath = process.env.UPLOAD_PATH && process.env.UPLOAD_PATH.trim();
  if (envPath) {
    // For relative paths (e.g. "uploads"), resolve from backend root
    // __dirname = backend/middlewares → backend root = one level up
    if (path.isAbsolute(envPath)) {
      return envPath;
    }
    return path.join(__dirname, '..', envPath);
  }
  // Fallback: frontend/public/uploads under repo root
  return path.join(__dirname, '../..', 'frontend', 'public', 'uploads');
};

const uploadDir = resolveUploadDir();
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Generate unique filename to avoid collisions and cache mix-ups between products
    const uniqueSuffix = Date.now() + '-' + crypto.randomBytes(8).toString('hex');
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 40) || 'image';
    const finalFilename = `${name}-${uniqueSuffix}${ext}`;
    cb(null, finalFilename);
  }
});

// File filter - only images
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (extname && mimetype) {
    return cb(null, true);
  } else {
    cb(new Error('Only image files (jpeg, jpg, png, gif, webp) are allowed!'));
  }
};

// Configure multer
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  },
  fileFilter: fileFilter
});

// Single file upload middleware wrapper
exports.uploadSingle = (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      return next(err);
    }
    next();
  });
};

// Multiple files upload
exports.uploadMultiple = upload.array('images', 10); // Max 10 images

// Error handling middleware for multer
exports.handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File too large. Maximum size is 50MB.'
      });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        message: 'Too many files. Maximum is 10 files.'
      });
    }
  }
  
  if (err) {
    return res.status(400).json({
      success: false,
      message: err.message || 'File upload error.'
    });
  }
  
  next();
};

