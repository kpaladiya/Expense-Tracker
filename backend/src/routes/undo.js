import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { getLatestUndoAction, undoAction } from '../utils/undo.js';

const router = express.Router();

router.get('/latest', authenticateToken, async (req, res) => {
  try {
    const action = await getLatestUndoAction(req.user.id);

    res.json({
      success: true,
      data: action
    });
  } catch (error) {
    console.error('Get latest undo action error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load undo action'
    });
  }
});

router.post('/:id', authenticateToken, async (req, res) => {
  try {
    const action = await undoAction({
      actionId: req.params.id,
      userId: req.user.id
    });

    if (!action) {
      return res.status(404).json({
        success: false,
        error: 'Undo action not found or expired'
      });
    }

    res.json({
      success: true,
      message: 'Recent action undone successfully',
      data: action
    });
  } catch (error) {
    console.error('Undo action error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to undo action'
    });
  }
});

export default router;
