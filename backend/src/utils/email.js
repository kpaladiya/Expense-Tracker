import nodemailer from 'nodemailer';

function getRequiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required email configuration: ${name}`);
  }

  return value;
}

function isPlaceholderValue(value) {
  if (!value) {
    return false;
  }

  return [
    'smtp.example.com',
    'your-email@example.com',
    'your-password',
    'your-app-password'
  ].includes(value);
}

function ensureEmailConfigurationLooksReal() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM;

  if (
    isPlaceholderValue(host) ||
    isPlaceholderValue(user) ||
    isPlaceholderValue(pass) ||
    (from && from.includes('your-email@example.com'))
  ) {
    throw new Error('Email delivery is not configured. Update SMTP settings in backend/.env.');
  }
}

function createTransporter() {
  ensureEmailConfigurationLooksReal();
  const host = getRequiredEnv('SMTP_HOST');
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  const ignoreTLS = process.env.SMTP_IGNORE_TLS === 'true';
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if ((user && !pass) || (!user && pass)) {
    throw new Error('SMTP_USER and SMTP_PASS must both be set when using authenticated SMTP');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    ignoreTLS,
    auth: user && pass ? { user, pass } : undefined
  });
}

export function getActivationBaseUrl() {
  return process.env.APP_BASE_URL || process.env.CORS_ORIGIN || 'http://localhost:5173';
}

export async function sendActivationEmail({ email, name, token }) {
  const transporter = createTransporter();
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;

  if (!from) {
    throw new Error('Missing required email configuration: SMTP_FROM');
  }

  const activationUrl = `${getActivationBaseUrl().replace(/\/$/, '')}/activate?token=${token}`;

  await transporter.sendMail({
    from,
    to: email,
    subject: 'Activate your Shared Expenses account',
    text: `Hi ${name},\n\nActivate your Shared Expenses account by opening this link:\n${activationUrl}\n\nThis link expires in 24 hours.`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2>Activate your Shared Expenses account</h2>
        <p>Hi ${name},</p>
        <p>Click the button below to activate your account:</p>
        <p>
          <a href="${activationUrl}" style="display:inline-block;padding:12px 18px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:8px;">
            Activate account
          </a>
        </p>
        <p>If the button does not work, open this link:</p>
        <p><a href="${activationUrl}">${activationUrl}</a></p>
        <p>This link expires in 24 hours.</p>
      </div>
    `
  });
}
