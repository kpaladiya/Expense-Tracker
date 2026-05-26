import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { getUnreadInboxCount, listInboxNotifications, markAllInboxNotificationsRead, markInboxNotificationRead } from '../utils/inbox.js';
import { ensureUserReminders } from '../utils/reminders.js';

const router = express.Router();

router.get('/', authenticateToken, async (req, res) => {
  try {
    await ensureUserReminders(req.user.id);
    const unreadOnly = req.query.unreadOnly === 'true';
    const notifications = await listInboxNotifications(req.user.id, {
      unreadOnly,
      limit: req.query.limit
    });
    const unreadCount = await getUnreadInboxCount(req.user.id);

    res.json({
      success: true,
      data: {
        unreadCount,
        notifications
      }
    });
  } catch (error) {
    console.error('List inbox notifications error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load notifications'
    });
  }
});

router.post('/:id/read', authenticateToken, async (req, res) => {
  try {
    await markInboxNotificationRead(req.user.id, req.params.id);
    const unreadCount = await getUnreadInboxCount(req.user.id);

    res.json({
      success: true,
      message: 'Notification marked as read',
      data: {
        unreadCount
      }
    });
  } catch (error) {
    console.error('Mark inbox notification read error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update notification'
    });
  }
});

router.post('/read-all', authenticateToken, async (req, res) => {
  try {
    await markAllInboxNotificationsRead(req.user.id);

    res.json({
      success: true,
      message: 'All notifications marked as read',
      data: {
        unreadCount: 0
      }
    });
  } catch (error) {
    console.error('Mark all inbox notifications read error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update notifications'
    });
  }
});

export default router;
