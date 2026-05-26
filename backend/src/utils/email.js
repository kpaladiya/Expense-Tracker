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
  const connectionTimeout = Number(process.env.SMTP_CONNECTION_TIMEOUT || 15000);
  const greetingTimeout = Number(process.env.SMTP_GREETING_TIMEOUT || 10000);
  const socketTimeout = Number(process.env.SMTP_SOCKET_TIMEOUT || 20000);
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
    connectionTimeout,
    greetingTimeout,
    socketTimeout,
    auth: user && pass ? { user, pass } : undefined
  });
}

function getFromAddress() {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;

  if (!from) {
    throw new Error('Missing required email configuration: SMTP_FROM');
  }

  return from;
}

export function isEmailConfigurationErrorMessage(message) {
  return (
    message === 'Email delivery is not configured. Update SMTP settings in backend/.env.' ||
    message?.startsWith('Missing required email configuration:') ||
    message === 'SMTP_USER and SMTP_PASS must both be set when using authenticated SMTP'
  );
}

export function getActivationBaseUrl() {
  return process.env.APP_BASE_URL || process.env.CORS_ORIGIN || 'http://localhost:5173';
}

function withEmailSignature({ text, html }) {
  const appUrl = getActivationBaseUrl().replace(/\/$/, '');
  const textSignature = [
    '',
    'Thank you,',
    'Shared Expenses Team',
    'sharedexpenses01@gmail.com',
    `App: ${appUrl}`,
    '',
    'This is an automated email from Shared Expenses.'
  ].join('\n');

  const htmlSignature = `
    <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;color:#4b5563;">
      <p style="margin:0 0 8px 0;">Thank you,</p>
      <p style="margin:0;"><strong>Shared Expenses Team</strong></p>
      <p style="margin:4px 0 0 0;">
        <a href="mailto:sharedexpenses01@gmail.com">sharedexpenses01@gmail.com</a>
      </p>
      <p style="margin:4px 0 0 0;">
        <a href="${appUrl}">${appUrl}</a>
      </p>
      <p style="margin:12px 0 0 0;font-size:12px;color:#6b7280;">
        This is an automated email from Shared Expenses.
      </p>
    </div>
  `;

  return {
    text: text ? `${text.trimEnd()}\n\n${textSignature}` : undefined,
    html: html ? `${html.trim()}\n${htmlSignature}` : undefined
  };
}

export async function sendEmail({ to, subject, text, html }) {
  const transporter = createTransporter();
  const from = getFromAddress();
  const messageWithSignature = withEmailSignature({ text, html });

  await transporter.sendMail({
    from,
    to,
    subject,
    text: messageWithSignature.text,
    html: messageWithSignature.html
  });
}

export async function sendActivationEmail({ email, name, token }) {
  const activationUrl = `${getActivationBaseUrl().replace(/\/$/, '')}/activate?token=${token}`;

  await sendEmail({
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
