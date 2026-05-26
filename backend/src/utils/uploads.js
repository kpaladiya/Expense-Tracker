import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';

const uploadsRoot = path.resolve(process.cwd(), 'uploads');
const receiptsDir = path.join(uploadsRoot, 'receipts');
const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf'
]);

if (!fs.existsSync(receiptsDir)) {
  fs.mkdirSync(receiptsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    callback(null, receiptsDir);
  },
  filename: (_req, file, callback) => {
    const ext = path.extname(file.originalname || '');
    callback(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  }
});

function fileFilter(_req, file, callback) {
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    callback(new Error('Attachment must be a JPG, PNG, WEBP, or PDF file'));
    return;
  }

  callback(null, true);
}

export const attachmentUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_ATTACHMENT_SIZE
  }
});

export function buildAttachmentColumns(file) {
  if (!file) {
    return {
      attachmentName: null,
      attachmentPath: null,
      attachmentMimeType: null,
      attachmentSize: null
    };
  }

  return {
    attachmentName: file.originalname,
    attachmentPath: `/uploads/receipts/${file.filename}`,
    attachmentMimeType: file.mimetype,
    attachmentSize: file.size
  };
}

export function buildAttachmentResponse(req, record) {
  if (!record?.attachment_path) {
    return null;
  }

  return {
    name: record.attachment_name,
    path: record.attachment_path,
    mimeType: record.attachment_mime_type,
    size: record.attachment_size,
    url: `${req.protocol}://${req.get('host')}${record.attachment_path}`
  };
}

export function removeStoredAttachment(attachmentPath) {
  if (!attachmentPath) {
    return;
  }

  const relativePath = attachmentPath.replace(/^\/+/, '');
  const fullPath = path.resolve(process.cwd(), relativePath);

  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
  }
}
