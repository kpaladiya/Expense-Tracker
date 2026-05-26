import express from 'express';
import { get } from '../db/index.js';
import { authenticateToken } from '../middleware/auth.js';
import { buildMonthlySummary, buildMonthlySummaryCsv, buildMonthlySummaryPdf } from '../utils/reports.js';

const router = express.Router();

async function ensureGroupMember(groupId, userId) {
  return get(
    'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?',
    [groupId, userId]
  );
}

router.get('/group/:groupId/monthly-summary', authenticateToken, async (req, res) => {
  try {
    const { groupId } = req.params;
    const member = await ensureGroupMember(groupId, req.user.id);

    if (!member) {
      return res.status(403).json({
        success: false,
        error: 'User is not a member of this group'
      });
    }

    const summary = await buildMonthlySummary(groupId, req.query.month);

    res.json({
      success: true,
      data: summary
    });
  } catch (error) {
    console.error('Get monthly summary error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load monthly summary'
    });
  }
});

router.get('/group/:groupId/export.csv', authenticateToken, async (req, res) => {
  try {
    const { groupId } = req.params;
    const member = await ensureGroupMember(groupId, req.user.id);

    if (!member) {
      return res.status(403).json({
        success: false,
        error: 'User is not a member of this group'
      });
    }

    const summary = await buildMonthlySummary(groupId, req.query.month);
    const csv = buildMonthlySummaryCsv(summary);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${groupId}-${summary.month}-summary.csv"`);
    res.send(csv);
  } catch (error) {
    console.error('Export summary CSV error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to export CSV report'
    });
  }
});

router.get('/group/:groupId/export.pdf', authenticateToken, async (req, res) => {
  try {
    const { groupId } = req.params;
    const member = await ensureGroupMember(groupId, req.user.id);

    if (!member) {
      return res.status(403).json({
        success: false,
        error: 'User is not a member of this group'
      });
    }

    const summary = await buildMonthlySummary(groupId, req.query.month);
    const pdf = await buildMonthlySummaryPdf(summary);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${groupId}-${summary.month}-summary.pdf"`);
    res.send(pdf);
  } catch (error) {
    console.error('Export summary PDF error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to export PDF report'
    });
  }
});

export default router;
