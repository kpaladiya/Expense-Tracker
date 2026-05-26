import express from 'express';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { run } from '../db/index.js';
import { sendEmail } from '../utils/email.js';

const router = express.Router();

const FEEDBACK_CATEGORIES = new Set(['bug', 'feature', 'help', 'general']);

function buildFeedbackTicketNumber(id) {
  return `FDB-${String(id || '').replace(/-/g, '').slice(0, 10).toUpperCase()}`;
}

function getOptionalUser(req) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1];

  if (!token) {
    return null;
  }

  try {
    return jwt.verify(token, process.env.JWT_SECRET || 'secret-key');
  } catch (error) {
    return null;
  }
}

function getSupportInbox() {
  return process.env.SUPPORT_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER || null;
}

router.post('/feedback', async (req, res) => {
  try {
    const optionalUser = getOptionalUser(req);
    const {
      name: rawName,
      email: rawEmail,
      category: rawCategory,
      subject: rawSubject,
      message: rawMessage,
      termsAccepted
    } = req.body;

    const name = (rawName || optionalUser?.name || '').trim();
    const email = (rawEmail || optionalUser?.email || '').trim().toLowerCase();
    const category = (rawCategory || '').trim().toLowerCase();
    const subject = (rawSubject || '').trim();
    const message = (rawMessage || '').trim();

    if (!name || !email || !category || !subject || !message) {
      return res.status(400).json({
        success: false,
        error: 'Name, email, category, subject, and message are required'
      });
    }

    if (!FEEDBACK_CATEGORIES.has(category)) {
      return res.status(400).json({
        success: false,
        error: 'Category must be bug, feature, help, or general'
      });
    }

    if (termsAccepted !== true) {
      return res.status(400).json({
        success: false,
        error: 'You must accept the terms and conditions before submitting feedback'
      });
    }

    const feedbackId = uuidv4();
    const ticketNumber = buildFeedbackTicketNumber(feedbackId);

    await run(
      `INSERT INTO feedback_submissions (id, user_id, name, email, category, subject, message, ticket_number, terms_accepted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [feedbackId, optionalUser?.id || null, name, email, category, subject, message, ticketNumber, 1]
    );

    const supportInbox = getSupportInbox();
    let warning;

    if (supportInbox) {
      try {
        await sendEmail({
          to: supportInbox,
          subject: `[Feedback:${category}] ${subject}`,
          text:
            `New feedback received.\n\n` +
            `Ticket: ${ticketNumber}\n` +
            `Name: ${name}\n` +
            `Email: ${email}\n` +
            `Category: ${category}\n` +
            `User ID: ${optionalUser?.id || 'Guest'}\n\n` +
            `${message}\n`,
          html: `
            <div style="font-family: Arial, sans-serif; line-height: 1.5;">
              <h2>New feedback received</h2>
              <p><strong>Ticket:</strong> ${ticketNumber}</p>
              <p><strong>Name:</strong> ${name}</p>
              <p><strong>Email:</strong> ${email}</p>
              <p><strong>Category:</strong> ${category}</p>
              <p><strong>User ID:</strong> ${optionalUser?.id || 'Guest'}</p>
              <p><strong>Subject:</strong> ${subject}</p>
              <p><strong>Message:</strong><br />${message.replace(/\n/g, '<br />')}</p>
            </div>
          `
        });
      } catch (emailError) {
        console.error('Feedback notification error:', emailError);
        warning = 'Feedback saved, but support email notification could not be delivered.';
      }
    }

    res.status(201).json({
      success: true,
      message: 'Thanks for your feedback. We saved your message successfully.',
      ...(warning ? { warning } : {}),
      data: {
        id: feedbackId,
        ticketNumber,
        category,
        subject
      }
    });
  } catch (error) {
    console.error('Submit feedback error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to submit feedback'
    });
  }
});

export default router;
