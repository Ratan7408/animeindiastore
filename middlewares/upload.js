const multer = require('multer');
const path = require('path');
const fs = require('fs');
const logPath = path.join(__dirname, '../../.cursor/debug.log');
const log = (loc, msg, data, hyp) => { try { fs.appendFileSync(logPath, JSON.stringify({location:loc,message:msg,data,timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:hyp})+'\n'); } catch(e) {} };

// Upload directory:
// - Prefer UPLOAD_PATH from .env (same as server.js static /uploads route)
// - Fallback to ../frontend/public/uploads (older monorepo layout)
const resolveUploadDir = () => {
  const envPath = process.env.UPLOAD_PATH && process.env.UPLOAD_PATH.trim();
  if (envPath) {
    const base = path.isAbsolute(envPath)
      ? envPath
      : path.join(__dirname, '..', '..', envPath);
    return base;
  }
  return path.join(__dirname, '../../frontend/public/uploads');
};

const uploadDir = resolveUploadDir();
// #region agent log
log('upload.js:8', 'Upload directory path check', {uploadDir,exists:fs.existsSync(uploadDir),__dirname,envPath:process.env.UPLOAD_PATH}, 'A');
// #endregion
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  // #region agent log
  log('upload.js:11', 'Created upload directory', {uploadDir}, 'A');
  // #endregion
}

// Configure storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // #region agent log
    log('upload.js:23', 'Multer destination called', {uploadDir,fileName:file.originalname,fieldName:file.fieldname,dirExists:fs.existsSync(uploadDir)}, 'A');
    // #endregion
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Generate unique filename: timestamp-random-originalname
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext);
    const finalFilename = `${name}-${uniqueSuffix}${ext}`;
    const fullPath = path.join(uploadDir, finalFilename);
    // #region agent log
    log('upload.js:32', 'Multer filename generated', {originalName:file.originalname,finalFilename,fullPath}, 'B');
    // #endregion
    cb(null, finalFilename);
  }
});

// File filter - only images
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);
  // #region agent log
  log('upload.js:45', 'File filter check', {originalName:file.originalname,mimetype:file.mimetype,extname,isValid:extname&&mimetype}, 'C');
  // #endregion

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

// Single file upload middleware wrapper with logging
exports.uploadSingle = (req, res, next) => {
  // #region agent log
  log('upload.js:69', 'uploadSingle middleware called', {contentType:req.headers['content-type'],hasBody:!!req.body,method:req.method}, 'B');
  // #endregion
  upload.single('image')(req, res, (err) => {
    // #region agent log
    log('upload.js:72', 'uploadSingle callback', {hasFile:!!req.file,hasError:!!err,errorMessage:err?.message}, 'B');
    // #endregion
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
  // #region agent log
  if (err) {
    log('upload.js:72', 'Multer error handler', {errorMessage:err.message,errorName:err.name,isMulterError:err instanceof multer.MulterError,errorCode:err.code,hasFile:!!req.file}, 'C');
  }
  // #endregion
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

