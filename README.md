# Backend API

Express.js backend server for the animeweb e-commerce platform.

## Quick Start

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file:
```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/animeweb
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRE=7d
NODE_ENV=development
UPLOAD_PATH=./uploads
```

3. Seed database (creates default admin):
```bash
npm run seed
```

4. Start server:
```bash
npm start
# or for development
npm run dev
```

## Default Admin

After seeding:
- Email: `admin@animeweb.com`
- Password: `admin123`

## API Base URL

`http://localhost:5000/api`

See `../API_DOCUMENTATION.md` for full API documentation.

