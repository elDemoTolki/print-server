const path = require('path');
const fs = require('fs');
require('dotenv').config();

const requiredVars = ['ADMIN_PASSWORD', 'SESSION_SECRET', 'PRINTER_NAME', 'UPLOAD_DIR'];
for (const key of requiredVars) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var ${key}. Use .env or .env.example`);
  }
}

const uploadDir = path.resolve(process.env.UPLOAD_DIR);
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

module.exports = {
  port: Number(process.env.PORT || '3000'),
  adminPassword: process.env.ADMIN_PASSWORD,
  sessionSecret: process.env.SESSION_SECRET,
  printerName: process.env.PRINTER_NAME,
  uploadDir,
  allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
  maxFileSizeMB: Number(process.env.MAX_FILE_SIZE_MB || 20),
};
