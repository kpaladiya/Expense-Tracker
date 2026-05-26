import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CheckCircle2, Clock3, Download, FileText, Pencil, Plus, Repeat, RotateCcw, Search, Settings2, ShieldAlert, TrendingUp, Trash2, Upload, UserCircle2, Users, XCircle } from 'lucide-react';
import { useAuth } from '../services/AuthContext';
import NotificationCenter from '../components/NotificationCenter';
import SiteFooter from '../components/SiteFooter';
import TransferSuggestions from '../components/TransferSuggestions';
import { activityAPI, expensesAPI, groupsAPI, inboxAPI, paymentsAPI, recurringAPI, reportsAPI, settlementAPI, undoAPI } from '../services/api';
import { CURRENCY_OPTIONS, formatCurrency as formatMoney } from '../utils/currency';

function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

function formatDate(value) {
  if (!value) {
    return '-';
  }

  return new Date(value).toLocaleDateString();
}

function formatMonth(value) {
  if (!value) {
    return 'All Time';
  }

  const [year, month] = value.split('-');
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric'
  });
}

function getMonthFromDate(value) {
  return value ? value.slice(0, 7) : '';
}

function getNoticeClasses(type) {
  if (type === 'warning') {
    return 'bg-amber-50 border border-amber-200 text-amber-800';
  }

  if (type === 'success') {
    return 'bg-green-50 border border-green-200 text-green-800';
  }

  return 'bg-red-50 border border-red-200 text-red-800';
}

function getRequestBadge(status) {
  if (status === 'pending_admin') {
    return {
      className: 'bg-green-100 text-green-800',
      label: 'Waiting for admin approval'
    };
  }

  return {
    className: 'bg-amber-100 text-amber-800',
    label: 'Waiting for user response'
  };
}

export default function GroupDetailPage() {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [group, setGroup] = useState(null);
  const [settlement, setSettlement] = useState(null);
  const [settlementHistory, setSettlementHistory] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [payments, setPayments] = useState([]);
  const [memberRequests, setMemberRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('overview');
  const [memberEmail, setMemberEmail] = useState('');
  const [memberLoading, setMemberLoading] = useState(false);
  const [memberActionLoading, setMemberActionLoading] = useState('');
  const [roleUpdateLoading, setRoleUpdateLoading] = useState('');
  const [memberError, setMemberError] = useState('');
  const [memberSuccess, setMemberSuccess] = useState('');
  const [reviewError, setReviewError] = useState('');
  const [reviewLoading, setReviewLoading] = useState('');
  const [expenseError, setExpenseError] = useState('');
  const [expenseNotice, setExpenseNotice] = useState(null);
  const [expenseLoading, setExpenseLoading] = useState(false);
  const [expenseForm, setExpenseForm] = useState({
    amount: '',
    note: '',
    expenseDate: getTodayDate()
  });
  const [expenseAttachment, setExpenseAttachment] = useState(null);
  const [expenseFileInputKey, setExpenseFileInputKey] = useState(0);
  const [paymentError, setPaymentError] = useState('');
  const [paymentNotice, setPaymentNotice] = useState(null);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [editingPaymentId, setEditingPaymentId] = useState('');
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    paymentMethod: 'Cash',
    customerNote: '',
    paymentDate: getTodayDate()
  });
  const [paymentAttachment, setPaymentAttachment] = useState(null);
  const [paymentCurrentAttachment, setPaymentCurrentAttachment] = useState(null);
  const [removePaymentAttachment, setRemovePaymentAttachment] = useState(false);
  const [paymentFileInputKey, setPaymentFileInputKey] = useState(0);
  const [settlementNotice, setSettlementNotice] = useState(null);
  const [settlementActionLoading, setSettlementActionLoading] = useState('');
  const [deleteGroupNotice, setDeleteGroupNotice] = useState(null);
  const [deleteGroupLoading, setDeleteGroupLoading] = useState('');
  const [notifications, setNotifications] = useState([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [activityItems, setActivityItems] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityFilters, setActivityFilters] = useState({
    search: '',
    memberId: '',
    type: ''
  });
  const [expenseFilters, setExpenseFilters] = useState({
    search: '',
    month: '',
    memberId: ''
  });
  const [paymentFilters, setPaymentFilters] = useState({
    search: '',
    month: '',
    memberId: ''
  });
  const [settingsForm, setSettingsForm] = useState({
    name: '',
    description: '',
    currency: 'EUR'
  });
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState(null);
  const [monthlySummary, setMonthlySummary] = useState(null);
  const [summaryMonth, setSummaryMonth] = useState('');
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryNotice, setSummaryNotice] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateNotice, setTemplateNotice] = useState(null);
  const [undoAction, setUndoAction] = useState(null);
  const [undoLoading, setUndoLoading] = useState(false);
  const [templateForm, setTemplateForm] = useState({
    entryType: 'expense',
    title: '',
    amount: '',
    note: '',
    paymentMethod: 'Cash',
    frequency: 'monthly',
    dayOfWeek: '1',
    dayOfMonth: '1'
  });

  const isAdmin = user?.id === group?.admin_id;
  const currentUserRole = group?.currentUserRole || (isAdmin ? 'admin' : 'member');
  const canManageInvites = isAdmin || ['co_admin', 'manager'].includes(currentUserRole);
  const canManageMembers = isAdmin || currentUserRole === 'co_admin';
  const canEditSettings = isAdmin || currentUserRole === 'co_admin';
  const isGroupDisabled = Boolean(group?.is_disabled);
  const groupCurrency = group?.currency || 'EUR';
  const deletionRequest = group?.deletionRequest || null;
  const showApprovalsTab = isAdmin || Boolean(deletionRequest);
  const hasApprovedDeletion = Boolean(deletionRequest?.isApprovedByCurrentUser);
  const formatCurrency = (value) => formatMoney(value, groupCurrency);
  const settledMonths = new Set(
    settlementHistory
      .filter((month) => month.isSettled)
      .map((month) => month.month)
  );
  const isExpenseMonthClosed = settledMonths.has(getMonthFromDate(expenseForm.expenseDate));
  const isPaymentMonthClosed = settledMonths.has(getMonthFromDate(paymentForm.paymentDate));
  const filteredExpenses = useMemo(() => expenses.filter((expense) => {
    const search = expenseFilters.search.trim().toLowerCase();

    if (expenseFilters.month && getMonthFromDate(expense.expense_date) !== expenseFilters.month) {
      return false;
    }

    if (expenseFilters.memberId && expense.user_id !== expenseFilters.memberId) {
      return false;
    }

    if (search && !`${expense.note || ''} ${expense.user_name || ''}`.toLowerCase().includes(search)) {
      return false;
    }

    return true;
  }), [expenses, expenseFilters]);
  const filteredPayments = useMemo(() => payments.filter((payment) => {
    const search = paymentFilters.search.trim().toLowerCase();

    if (paymentFilters.month && getMonthFromDate(payment.payment_date) !== paymentFilters.month) {
      return false;
    }

    if (paymentFilters.memberId && payment.user_id !== paymentFilters.memberId) {
      return false;
    }

    if (search && !`${payment.customer_note || ''} ${payment.user_name || ''} ${payment.payment_method || ''}`.toLowerCase().includes(search)) {
      return false;
    }

    return true;
  }), [payments, paymentFilters]);
  const filteredActivity = useMemo(() => activityItems.filter((item) => {
    const search = activityFilters.search.trim().toLowerCase();

    if (activityFilters.memberId && item.user_id !== activityFilters.memberId) {
      return false;
    }

    if (activityFilters.type && item.activity_type !== activityFilters.type) {
      return false;
    }

    if (search && !`${item.title || ''} ${item.description || ''} ${item.user_name || ''}`.toLowerCase().includes(search)) {
      return false;
    }

    return true;
  }), [activityItems, activityFilters]);
  const monthOptions = Array.from(
    new Set([
      ...settlementHistory.map((month) => month.month),
      ...expenses.map((expense) => getMonthFromDate(expense.expense_date)),
      ...payments.map((payment) => getMonthFromDate(payment.payment_date))
    ].filter(Boolean))
  ).sort((left, right) => right.localeCompare(left));

  useEffect(() => {
    loadGroupData();
  }, [groupId]);

  const loadNotifications = async () => {
    const result = await inboxAPI.getNotifications({ limit: 200 });

    if (result.success) {
      setNotifications(result.data.notifications);
      setUnreadNotifications(result.data.unreadCount);
    }
  };

  const loadMonthlySummary = async (month) => {
    if (!month) {
      setMonthlySummary(null);
      return;
    }

    try {
      setSummaryLoading(true);
      const result = await reportsAPI.getMonthlySummary(groupId, month);

      if (result.success) {
        setMonthlySummary(result.data);
        setSummaryMonth(result.data.month);
      }
    } catch (summaryError) {
      setSummaryNotice({
        type: 'error',
        text: summaryError.message || 'Failed to load monthly summary'
      });
    } finally {
      setSummaryLoading(false);
    }
  };

  const loadGroupData = async (showLoader = true) => {
    try {
      setError('');
      if (showLoader) {
        setLoading(true);
      }

      const tasks = [
        groupsAPI.getGroup(groupId),
        settlementAPI.getSettlement(groupId),
        settlementAPI.getSettlementHistory(groupId),
        expensesAPI.getGroupExpenses(groupId),
        paymentsAPI.getGroupPayments(groupId),
        activityAPI.getGroupActivity(groupId).catch(() => ({ success: false, data: [] })),
        recurringAPI.getTemplates(groupId).catch(() => ({ success: false, data: [] })),
        inboxAPI.getNotifications({ limit: 200 }).catch(() => ({ success: false, data: { notifications: [], unreadCount: 0 } })),
        undoAPI.getLatest().catch(() => ({ success: false, data: null })),
        groupsAPI.getMemberRequests(groupId).catch((requestError) => ({ success: false, error: requestError.message }))
      ];

      const [groupResult, settlementResult, settlementHistoryResult, expensesResult, paymentsResult, activityResult, templatesResult, notificationsResult, undoResult, memberRequestsResult] = await Promise.all(tasks);

      if (groupResult.success) {
        setGroup(groupResult.data);
      }

      if (settlementResult.success) {
        setSettlement(settlementResult.data);
      }

      if (settlementHistoryResult.success) {
        setSettlementHistory(settlementHistoryResult.data);
      }

      if (expensesResult.success) {
        setExpenses(expensesResult.data);
      }

      if (paymentsResult.success) {
        setPayments(paymentsResult.data);
      }

      if (activityResult?.success) {
        setActivityItems(activityResult.data);
      }

      if (templatesResult?.success) {
        setTemplates(templatesResult.data);
      }

      if (notificationsResult?.success) {
        setNotifications(notificationsResult.data.notifications);
        setUnreadNotifications(notificationsResult.data.unreadCount);
      }

      if (undoResult?.success) {
        setUndoAction(undoResult.data?.group_id === groupId ? undoResult.data : null);
      } else {
        setUndoAction(null);
      }

      if (memberRequestsResult?.success) {
        setMemberRequests(memberRequestsResult.data);
      } else {
        setMemberRequests([]);
      }

      if (groupResult.success) {
        setSettingsForm({
          name: groupResult.data.name || '',
          description: groupResult.data.description || '',
          currency: groupResult.data.currency || 'EUR'
        });
      }

      const nextSummaryMonth = settlementHistoryResult?.success && settlementHistoryResult.data.length > 0
        ? settlementHistoryResult.data[0].month
        : getTodayDate().slice(0, 7);

      if (!summaryMonth) {
        await loadMonthlySummary(nextSummaryMonth);
      }
    } catch (err) {
      setError(err.message || 'Failed to load group');
    } finally {
      if (showLoader) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (group && canManageInvites && !group.is_disabled) {
      groupsAPI.getMemberRequests(groupId)
        .then((result) => {
          if (result.success) {
            setMemberRequests(result.data);
          }
        })
        .catch((requestError) => {
          setReviewError(requestError.message || 'Failed to load join requests');
        });
    }
  }, [group, canManageInvites, groupId]);

  const refreshGroupData = async () => {
    await loadGroupData(false);
    if (summaryMonth) {
      await loadMonthlySummary(summaryMonth);
    }
  };

  const handleMarkNotificationRead = async (notificationId) => {
    try {
      setNotificationLoading(true);
      const result = await inboxAPI.markRead(notificationId);
      setUnreadNotifications(result.data.unreadCount);
      setNotifications((current) =>
        current.map((notification) =>
          notification.id === notificationId
            ? { ...notification, isRead: true }
            : notification
        )
      );
    } catch (notificationError) {
      setError(notificationError.message || 'Failed to update notification');
    } finally {
      setNotificationLoading(false);
    }
  };

  const handleMarkAllNotificationsRead = async () => {
    try {
      setNotificationLoading(true);
      await inboxAPI.markAllRead();
      setUnreadNotifications(0);
      setNotifications((current) =>
        current.map((notification) => ({ ...notification, isRead: true }))
      );
    } catch (notificationError) {
      setError(notificationError.message || 'Failed to update notifications');
    } finally {
      setNotificationLoading(false);
    }
  };

  const handleOpenNotification = async (notification) => {
    if (!notification.isRead) {
      await handleMarkNotificationRead(notification.id);
    }

    if (notification.actionUrl === `/group/${groupId}`) {
      setActiveTab('activity');
      return;
    }

    navigate(notification.actionUrl || `/group/${groupId}`);
  };

  const handleAddMember = async (event) => {
    event.preventDefault();

    if (!memberEmail.trim()) {
      setMemberError('Email is required');
      return;
    }

    try {
      setMemberLoading(true);
      setMemberError('');
      setMemberSuccess('');
      const email = memberEmail.trim().toLowerCase();
      const result = await groupsAPI.addMember(groupId, email);

      if (result.success) {
        setMemberEmail('');
        setMemberSuccess(result.message);
        await refreshGroupData();
      }
    } catch (err) {
      setMemberError(err.message || 'Failed to send join request');
    } finally {
      setMemberLoading(false);
    }
  };

  const handleReviewRequest = async (requestId, action) => {
    try {
      setReviewError('');
      setReviewLoading(`${requestId}-${action}`);
      await groupsAPI.reviewMemberRequest(groupId, requestId, action);
      await refreshGroupData();
    } catch (err) {
      setReviewError(err.message || 'Failed to review join request');
    } finally {
      setReviewLoading('');
    }
  };

  const handleRemoveMember = async (member) => {
    const reasonInput = window.prompt(`Why are you removing ${member.name} from this group?`);

    if (reasonInput === null) {
      return;
    }

    const reason = reasonInput.trim();

    if (!reason) {
      setMemberError('Please provide a reason before removing a member.');
      setMemberSuccess('');
      return;
    }

    const confirmed = window.confirm(
      `Are you sure you want to remove ${member.name} from this group?\n\nReason: ${reason}`
    );

    if (!confirmed) {
      return;
    }

    try {
      setMemberActionLoading(member.id);
      setMemberError('');
      setMemberSuccess('');
      const result = await groupsAPI.removeMember(groupId, member.id, reason);
      setMemberSuccess(result.message || `${member.name} removed from group.`);
      await refreshGroupData();
    } catch (err) {
      setMemberError(err.message || 'Failed to remove member');
    } finally {
      setMemberActionLoading('');
    }
  };

  const handleRoleChange = async (member, role) => {
    try {
      setRoleUpdateLoading(member.id);
      setMemberError('');
      setMemberSuccess('');
      const result = await groupsAPI.updateMemberRole(groupId, member.id, role);
      setMemberSuccess(result.message || `${member.name}'s role updated successfully.`);
      await refreshGroupData();
    } catch (err) {
      setMemberError(err.message || 'Failed to update member role');
    } finally {
      setRoleUpdateLoading('');
    }
  };

  const handleUndo = async () => {
    if (!undoAction?.id) {
      return;
    }

    try {
      setUndoLoading(true);
      setMemberError('');
      const result = await undoAPI.undo(undoAction.id);
      setMemberSuccess(result.message || 'Recent action undone successfully.');
      await refreshGroupData();
    } catch (err) {
      setMemberError(err.message || 'Failed to undo recent action');
    } finally {
      setUndoLoading(false);
    }
  };

  const handleAddExpense = async (event) => {
    event.preventDefault();

    if (!expenseForm.amount) {
      setExpenseError('Amount is required');
      return;
    }

    if (isExpenseMonthClosed) {
      setExpenseError('This month has already been settled and is closed for changes');
      return;
    }

    try {
      setExpenseLoading(true);
      setExpenseError('');
      setExpenseNotice(null);
      const result = await expensesAPI.addExpense(
        groupId,
        expenseForm.amount,
        expenseForm.note,
        expenseForm.expenseDate,
        expenseAttachment
      );

      if (result.success) {
        setExpenseForm({
          amount: '',
          note: '',
          expenseDate: getTodayDate()
        });
        setExpenseAttachment(null);
        setExpenseFileInputKey((current) => current + 1);
        setExpenseNotice({
          type: result.warning ? 'warning' : 'success',
          text: result.warning || result.message
        });
        await refreshGroupData();
      }
    } catch (err) {
      setExpenseError(err.message || 'Failed to add expense');
    } finally {
      setExpenseLoading(false);
    }
  };

  const handleDeleteExpense = async (expenseId) => {
    const confirmed = window.confirm('Are you sure you want to delete this expense?');

    if (!confirmed) {
      return;
    }

    try {
      setExpenseError('');
      setExpenseNotice(null);
      await expensesAPI.deleteExpense(expenseId);
      setExpenseNotice({
        type: 'success',
        text: 'Expense deleted successfully'
      });
      await refreshGroupData();
    } catch (err) {
      setExpenseError(err.message || 'Failed to delete expense');
    }
  };

  const handleAddPayment = async (event) => {
    event.preventDefault();

    if (!paymentForm.amount) {
      setPaymentError('Amount is required');
      return;
    }

    if (isPaymentMonthClosed) {
      setPaymentError('This month has already been settled and is closed for changes');
      return;
    }

    try {
      setPaymentLoading(true);
      setPaymentError('');
      setPaymentNotice(null);
      const result = editingPaymentId
        ? await paymentsAPI.updatePayment(
            editingPaymentId,
            paymentForm.amount,
            paymentForm.paymentMethod,
            paymentForm.customerNote,
            paymentForm.paymentDate,
            paymentAttachment,
            removePaymentAttachment
          )
        : await paymentsAPI.recordPayment(
            groupId,
            paymentForm.amount,
            paymentForm.paymentMethod,
            paymentForm.customerNote,
            paymentForm.paymentDate,
            paymentAttachment
          );

      if (result.success) {
        setPaymentForm({
          amount: '',
          paymentMethod: 'Cash',
          customerNote: '',
          paymentDate: getTodayDate()
        });
        setEditingPaymentId('');
        setPaymentAttachment(null);
        setPaymentCurrentAttachment(null);
        setRemovePaymentAttachment(false);
        setPaymentFileInputKey((current) => current + 1);
        setPaymentNotice({
          type: result.warning ? 'warning' : 'success',
          text: result.warning || result.message
        });
        await refreshGroupData();
      }
    } catch (err) {
      setPaymentError(err.message || (editingPaymentId ? 'Failed to update payment' : 'Failed to record payment'));
    } finally {
      setPaymentLoading(false);
    }
  };

  const handleEditPayment = (payment) => {
    setActiveTab('payments');
    setPaymentError('');
    setPaymentNotice(null);
    setEditingPaymentId(payment.id);
    setPaymentAttachment(null);
    setPaymentCurrentAttachment(payment.attachment || null);
    setRemovePaymentAttachment(false);
    setPaymentFileInputKey((current) => current + 1);
    setPaymentForm({
      amount: payment.amount?.toString() || '',
      paymentMethod: payment.payment_method || 'Cash',
      customerNote: payment.customer_note || '',
      paymentDate: payment.payment_date || getTodayDate()
    });
  };

  const handleCancelPaymentEdit = () => {
    setEditingPaymentId('');
    setPaymentError('');
    setPaymentNotice(null);
    setPaymentAttachment(null);
    setPaymentCurrentAttachment(null);
    setRemovePaymentAttachment(false);
    setPaymentFileInputKey((current) => current + 1);
    setPaymentForm({
      amount: '',
      paymentMethod: 'Cash',
      customerNote: '',
      paymentDate: getTodayDate()
    });
  };

  const handleDeletePayment = async (paymentId) => {
    const confirmed = window.confirm('Are you sure you want to delete this payment?');

    if (!confirmed) {
      return;
    }

    try {
      setPaymentError('');
      setPaymentNotice(null);
      await paymentsAPI.deletePayment(paymentId);
      if (editingPaymentId === paymentId) {
        handleCancelPaymentEdit();
      }
      setPaymentNotice({
        type: 'success',
        text: 'Payment deleted successfully'
      });
      await refreshGroupData();
    } catch (err) {
      setPaymentError(err.message || 'Failed to delete payment');
    }
  };

  const handleSettleMonth = async (month) => {
    try {
      setSettlementActionLoading(month);
      setSettlementNotice(null);
      const result = await settlementAPI.settleMonth(groupId, month);
      setSettlementNotice({
        type: result.warning ? 'warning' : 'success',
        text: result.warning || result.message
      });
      await refreshGroupData();
      await loadMonthlySummary(month);
    } catch (err) {
      setSettlementNotice({
        type: 'error',
        text: err.message || 'Failed to settle month'
      });
    } finally {
      setSettlementActionLoading('');
    }
  };

  const handleRequestDeleteGroup = async () => {
    const confirmed = window.confirm(
      `Are you sure you want to request disabling ${group?.name}?\n\nAll members will need to approve it before the group becomes read-only.`
    );

    if (!confirmed) {
      return;
    }

    try {
      setDeleteGroupLoading('request');
      setDeleteGroupNotice(null);
      const result = await groupsAPI.requestDeleteGroup(groupId);

      setDeleteGroupNotice({
        type: result.warning ? 'warning' : 'success',
        text: result.warning || result.message
      });

      setActiveTab('approvals');
      await refreshGroupData();
    } catch (err) {
      setDeleteGroupNotice({
        type: 'error',
        text: err.message || 'Failed to create disable approval request'
      });
    } finally {
      setDeleteGroupLoading('');
    }
  };

  const handleApproveDeleteGroup = async () => {
    const confirmed = window.confirm(
      `Are you sure you want to approve disabling ${group?.name}?\n\nIf every member approves, the group will become read-only immediately.`
    );

    if (!confirmed) {
      return;
    }

    try {
      setDeleteGroupLoading('approve');
      setDeleteGroupNotice(null);
      const result = await groupsAPI.approveDeleteGroup(groupId);

      setDeleteGroupNotice({
        type: result.warning ? 'warning' : 'success',
        text: result.warning || result.message
      });

      await refreshGroupData();
    } catch (err) {
      setDeleteGroupNotice({
        type: 'error',
        text: err.message || 'Failed to approve group disable request'
      });
    } finally {
      setDeleteGroupLoading('');
    }
  };

  const handleSaveSettings = async (event) => {
    event.preventDefault();

    try {
      setSettingsLoading(true);
      setSettingsNotice(null);
      const result = await groupsAPI.updateGroup(
        groupId,
        settingsForm.name,
        settingsForm.description,
        settingsForm.currency
      );
      setSettingsNotice({
        type: 'success',
        text: result.message || 'Group settings updated successfully'
      });
      await refreshGroupData();
    } catch (settingsError) {
      setSettingsNotice({
        type: 'error',
        text: settingsError.message || 'Failed to update group settings'
      });
    } finally {
      setSettingsLoading(false);
    }
  };

  const handleSummaryMonthChange = async (event) => {
    const nextMonth = event.target.value;
    setSummaryNotice(null);
    await loadMonthlySummary(nextMonth);
  };

  const handleDownloadSummary = async (format) => {
    try {
      setSummaryNotice(null);
      const response = format === 'csv'
        ? await reportsAPI.downloadMonthlySummaryCsv(groupId, summaryMonth || monthlySummary?.month)
        : await reportsAPI.downloadMonthlySummaryPdf(groupId, summaryMonth || monthlySummary?.month);
      const url = URL.createObjectURL(response.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = response.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      setSummaryNotice({
        type: 'error',
        text: downloadError.message || 'Failed to download report'
      });
    }
  };

  const handleTemplateSubmit = async (event) => {
    event.preventDefault();

    try {
      setTemplateLoading(true);
      setTemplateNotice(null);
      const result = await recurringAPI.createTemplate(groupId, {
        ...templateForm,
        amount: Number(templateForm.amount)
      });

      setTemplateNotice({
        type: 'success',
        text: result.message || 'Recurring template created successfully'
      });
      setTemplateForm({
        entryType: 'expense',
        title: '',
        amount: '',
        note: '',
        paymentMethod: 'Cash',
        frequency: 'monthly',
        dayOfWeek: '1',
        dayOfMonth: '1'
      });
      await refreshGroupData();
    } catch (templateError) {
      setTemplateNotice({
        type: 'error',
        text: templateError.message || 'Failed to create recurring template'
      });
    } finally {
      setTemplateLoading(false);
    }
  };

  const handleUseTemplate = async (templateId) => {
    try {
      setTemplateLoading(true);
      setTemplateNotice(null);
      const result = await recurringAPI.useTemplate(groupId, templateId, getTodayDate());
      setTemplateNotice({
        type: 'success',
        text: result.message || 'Recurring template used successfully'
      });
      if (result.data.entryType === 'expense') {
        setActiveTab('expenses');
      } else {
        setActiveTab('payments');
      }
      await refreshGroupData();
    } catch (templateError) {
      setTemplateNotice({
        type: 'error',
        text: templateError.message || 'Failed to use recurring template'
      });
    } finally {
      setTemplateLoading(false);
    }
  };

  const handleToggleTemplate = async (template) => {
    try {
      setTemplateLoading(true);
      setTemplateNotice(null);
      const result = await recurringAPI.updateTemplate(groupId, template.id, {
        entryType: template.entry_type,
        title: template.title,
        amount: template.amount,
        note: template.note,
        paymentMethod: template.payment_method || 'Cash',
        frequency: template.frequency,
        dayOfWeek: template.day_of_week,
        dayOfMonth: template.day_of_month,
        isActive: !Boolean(template.is_active)
      });
      setTemplateNotice({
        type: 'success',
        text: result.message || 'Recurring template updated successfully'
      });
      await refreshGroupData();
    } catch (templateError) {
      setTemplateNotice({
        type: 'error',
        text: templateError.message || 'Failed to update recurring template'
      });
    } finally {
      setTemplateLoading(false);
    }
  };

  const handleDeleteTemplate = async (template) => {
    const confirmed = window.confirm(`Are you sure you want to delete the recurring template "${template.title}"?`);

    if (!confirmed) {
      return;
    }

    try {
      setTemplateLoading(true);
      setTemplateNotice(null);
      const result = await recurringAPI.deleteTemplate(groupId, template.id);
      setTemplateNotice({
        type: 'success',
        text: result.message || 'Recurring template deleted successfully'
      });
      await refreshGroupData();
    } catch (templateError) {
      setTemplateNotice({
        type: 'error',
        text: templateError.message || 'Failed to delete recurring template'
      });
    } finally {
      setTemplateLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-600">Loading...</p>
      </div>
    );
  }

  if (!group) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <button
            onClick={() => navigate('/')}
            className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 mb-8"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </button>
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
            <p className="text-red-800">Group not found</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between gap-4 mb-4">
            <button
              onClick={() => navigate('/')}
              className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Dashboard
            </button>
            <button
              onClick={() => navigate('/profile')}
              className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <UserCircle2 className="w-4 h-4" />
              Profile
            </button>
          </div>

          <div className="flex flex-col gap-4 md:flex-row md:justify-between md:items-start">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">{group.name}</h1>
              {group.description && <p className="text-gray-600 mt-1">{group.description}</p>}
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <p className="text-sm text-gray-500">Currency: {group.currency || 'EUR'}</p>
                <span className="text-xs font-medium px-2 py-1 rounded bg-purple-100 text-purple-800 capitalize">
                  Role: {currentUserRole.replace('_', ' ')}
                </span>
                {isGroupDisabled && (
                  <span className="text-xs font-medium px-2 py-1 rounded bg-red-100 text-red-800">
                    Disabled / Read only
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              {canManageMembers && (
                <button
                  onClick={() => setActiveTab('overview')}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Users className="w-4 h-4" />
                  Manage Members
                </button>
              )}
              <button
                onClick={() => setActiveTab('expenses')}
                className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Expense
              </button>
              <button
                onClick={() => setActiveTab('summary')}
                className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <FileText className="w-4 h-4" />
                Monthly Summary
              </button>
              <button
                onClick={() => setActiveTab('payments')}
                className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Record Payment
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {memberSuccess && (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex gap-3">
            <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
            <p className="text-sm text-green-800">{memberSuccess}</p>
          </div>
        )}

        {memberError && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
            <p className="text-sm text-red-800">{memberError}</p>
          </div>
        )}

        {isGroupDisabled && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg flex gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0" />
            <p className="text-sm text-amber-800">
              This group was disabled{group?.disabled_at ? ` on ${formatDate(group.disabled_at)}` : ''} and is now read-only. You can still view all records and settlements.
            </p>
          </div>
        )}

        {undoAction && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-amber-900">Undo available</p>
              <p className="text-sm text-amber-800 mt-1">{undoAction.label}</p>
            </div>
            <button
              type="button"
              onClick={handleUndo}
              disabled={undoLoading}
              className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50"
            >
              <RotateCcw className="w-4 h-4" />
              {undoLoading ? 'Undoing...' : 'Undo'}
            </button>
          </div>
        )}

        <div className="flex gap-4 mb-8 border-b border-gray-200 overflow-x-auto">
        {['overview', 'expenses', 'payments', 'settlement', 'activity', 'summary', 'templates', 'settings', ...(showApprovalsTab ? ['approvals'] : [])].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-3 font-medium border-b-2 transition-colors capitalize whitespace-nowrap ${
                activeTab === tab
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === 'overview' && (
          <div className="space-y-6">
            {settlement && (
              <div className="grid md:grid-cols-4 gap-4">
                <div className="bg-white rounded-lg shadow-sm p-6">
                  <p className="text-sm text-gray-600 font-medium">Total Received</p>
                  <p className="text-3xl font-bold text-green-600 mt-2">{formatCurrency(settlement.totalReceived)}</p>
                </div>
                <div className="bg-white rounded-lg shadow-sm p-6">
                  <p className="text-sm text-gray-600 font-medium">Total Spent</p>
                  <p className="text-3xl font-bold text-red-600 mt-2">{formatCurrency(settlement.totalExpenses)}</p>
                </div>
                <div className="bg-white rounded-lg shadow-sm p-6">
                  <p className="text-sm text-gray-600 font-medium">Net Profit</p>
                  <p className="text-3xl font-bold text-blue-600 mt-2">{formatCurrency(settlement.netProfit)}</p>
                </div>
                <div className="bg-white rounded-lg shadow-sm p-6">
                  <p className="text-sm text-gray-600 font-medium">Average Share</p>
                  <p className="text-3xl font-bold text-purple-600 mt-2">{formatCurrency(settlement.perPersonShare)}</p>
                </div>
              </div>
            )}

            <TransferSuggestions
              suggestions={settlement?.transferSuggestions || []}
              formatCurrency={formatCurrency}
            />

            <NotificationCenter
              notifications={notifications}
              unreadCount={unreadNotifications}
              loading={notificationLoading}
              onMarkRead={handleMarkNotificationRead}
              onMarkAllRead={handleMarkAllNotificationsRead}
              onOpenAction={handleOpenNotification}
            />

            <div className="grid lg:grid-cols-[1.15fr,0.85fr] gap-6">
              <div className="space-y-6">
                <div className="bg-white rounded-lg shadow-sm p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                      <Users className="w-5 h-5" />
                      Members
                    </h2>
                    <span className="text-sm text-gray-500">
                      {group.members?.length || 0} member{group.members?.length !== 1 ? 's' : ''}
                    </span>
                  </div>

                  {canManageInvites && (
                    <form onSubmit={handleAddMember} className="mb-6 p-4 bg-blue-50 border border-blue-100 rounded-lg">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Invite member by registered email
                      </label>
                      <div className="flex flex-col sm:flex-row gap-3">
                        <input
                          type="email"
                          value={memberEmail}
                          onChange={(event) => setMemberEmail(event.target.value)}
                          placeholder="member@example.com"
                          className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          disabled={isGroupDisabled}
                        />
                        <button
                          type="submit"
                          disabled={memberLoading || isGroupDisabled}
                          className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                        >
                          {memberLoading ? 'Sending...' : 'Send Join Request'}
                        </button>
                      </div>
                      <p className="text-xs text-gray-600 mt-2">
                        If the email is not registered in the app, you will see an incorrect email error immediately.
                      </p>
                      {memberError && <p className="text-sm text-red-700 mt-3">{memberError}</p>}
                      {memberSuccess && <p className="text-sm text-green-700 mt-3">{memberSuccess}</p>}
                    </form>
                  )}

                  <div className="space-y-3">
                    {group.members?.map((member) => (
                      <div key={member.id} className="flex justify-between items-center py-3 border-b border-gray-100 last:border-b-0">
                        <div>
                          <p className="font-medium text-gray-900">{member.name}</p>
                          <p className="text-sm text-gray-500">{member.email}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`text-xs px-2 py-1 rounded capitalize ${member.id === group.admin_id ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'}`}>
                            {member.id === group.admin_id ? 'admin' : (member.role || 'member').replace('_', ' ')}
                          </span>
                          {isAdmin && member.id !== group.admin_id && (
                            <select
                              value={member.role || 'member'}
                              onChange={(event) => handleRoleChange(member, event.target.value)}
                              disabled={roleUpdateLoading === member.id || memberActionLoading === member.id || isGroupDisabled}
                              className="text-sm px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                            >
                              <option value="co_admin">Co-admin</option>
                              <option value="manager">Manager</option>
                              <option value="member">Member</option>
                            </select>
                          )}
                          {canManageMembers && member.id !== group.admin_id && (
                            <button
                              type="button"
                              onClick={() => handleRemoveMember(member)}
                              disabled={memberActionLoading === member.id || roleUpdateLoading === member.id || isGroupDisabled}
                              className="text-sm text-red-600 hover:text-red-700 disabled:opacity-50"
                            >
                              {memberActionLoading === member.id ? 'Removing...' : 'Remove'}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {canManageInvites && (
                  <div className="bg-white rounded-lg shadow-sm p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <Clock3 className="w-5 h-5 text-blue-600" />
                      <h2 className="text-lg font-semibold text-gray-900">Join Requests</h2>
                    </div>
                    {reviewError && <p className="text-sm text-red-700 mb-4">{reviewError}</p>}

                    {memberRequests.length === 0 ? (
                      <p className="text-gray-600">No join requests yet.</p>
                    ) : (
                      <div className="space-y-4">
                        {memberRequests.map((request) => {
                          const badge = getRequestBadge(request.status);
                          return (
                            <div
                              key={request.id}
                              className="border border-gray-200 rounded-lg p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
                            >
                              <div>
                                <p className="font-medium text-gray-900">{request.user_name}</p>
                                <p className="text-sm text-gray-600">{request.user_email}</p>
                                <p className="text-xs text-gray-500 mt-1">
                                  Requested on {formatDate(request.created_at)}
                                </p>
                              </div>

                              <div className="flex flex-col items-start gap-3 md:items-end">
                                <span className={`text-xs px-2 py-1 rounded ${badge.className}`}>
                                  {badge.label}
                                </span>

                                {request.status === 'pending_admin' ? (
                                  <div className="flex gap-3">
                                    <button
                                      onClick={() => handleReviewRequest(request.id, 'reject')}
                                      disabled={reviewLoading === `${request.id}-reject` || isGroupDisabled}
                                      className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                                    >
                                      <XCircle className="w-4 h-4" />
                                      Reject
                                    </button>
                                    <button
                                      onClick={() => handleReviewRequest(request.id, 'approve')}
                                      disabled={reviewLoading === `${request.id}-approve` || isGroupDisabled}
                                      className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                                    >
                                      <CheckCircle2 className="w-4 h-4" />
                                      {reviewLoading === `${request.id}-approve` ? 'Approving...' : 'Approve'}
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => handleReviewRequest(request.id, 'reject')}
                                    disabled={reviewLoading === `${request.id}-reject` || isGroupDisabled}
                                    className="text-sm text-red-600 hover:text-red-700 disabled:opacity-50"
                                  >
                                    Cancel request
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <button
                  onClick={() => setActiveTab('expenses')}
                  className="w-full bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow text-left"
                >
                  <p className="text-sm text-gray-600 font-medium">Add Expense</p>
                  <p className="text-lg font-semibold text-gray-900 mt-1">Track what you spent for this group</p>
                </button>
                <button
                  onClick={() => setActiveTab('payments')}
                  className="w-full bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow text-left"
                >
                  <p className="text-sm text-gray-600 font-medium">Record Payment</p>
                  <p className="text-lg font-semibold text-gray-900 mt-1">Save customer money you received</p>
                </button>
                <button
                  onClick={() => setActiveTab('settlement')}
                  className="w-full bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow text-left"
                >
                  <p className="text-sm text-gray-600 font-medium">View Settlement</p>
                  <p className="text-lg font-semibold text-gray-900 mt-1">See balances for every member</p>
                </button>
                <button
                  onClick={() => setActiveTab('activity')}
                  className="w-full bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow text-left"
                >
                  <p className="text-sm text-gray-600 font-medium">Activity Timeline</p>
                  <p className="text-lg font-semibold text-gray-900 mt-1">See recent member actions and history</p>
                </button>
                <button
                  onClick={() => setActiveTab('summary')}
                  className="w-full bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow text-left"
                >
                  <p className="text-sm text-gray-600 font-medium">Monthly Summary</p>
                  <p className="text-lg font-semibold text-gray-900 mt-1">Review monthly totals and export reports</p>
                </button>
                <button
                  onClick={() => setActiveTab('templates')}
                  className="w-full bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow text-left"
                >
                  <p className="text-sm text-gray-600 font-medium">Recurring Templates</p>
                  <p className="text-lg font-semibold text-gray-900 mt-1">Reuse repeated expense and payment entries</p>
                </button>
                {isAdmin && (
                  <button
                    onClick={() => setActiveTab('settings')}
                    className="w-full bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow text-left"
                  >
                    <p className="text-sm text-gray-600 font-medium">Settings</p>
                    <p className="text-lg font-semibold text-gray-900 mt-1">Update group details and currency</p>
                  </button>
                )}
                {showApprovalsTab && (
                <button
                  onClick={() => setActiveTab('approvals')}
                    className="w-full bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow text-left"
                  >
                    <p className="text-sm text-gray-600 font-medium">Approvals</p>
                    <p className="text-lg font-semibold text-gray-900 mt-1">
                      {deletionRequest ? 'Review group disable request' : 'Manage group disable'}
                    </p>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'expenses' && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Add Expense</h2>
              <form onSubmit={handleAddExpense} className="grid md:grid-cols-4 gap-4">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={expenseForm.amount}
                  onChange={(event) => setExpenseForm((current) => ({ ...current, amount: event.target.value }))}
                  placeholder="Amount"
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={isGroupDisabled}
                  required
                />
                <input
                  type="text"
                  value={expenseForm.note}
                  onChange={(event) => setExpenseForm((current) => ({ ...current, note: event.target.value }))}
                  placeholder="What was this expense for?"
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 md:col-span-2"
                  disabled={isGroupDisabled}
                />
                <input
                  type="date"
                  value={expenseForm.expenseDate}
                  onChange={(event) => setExpenseForm((current) => ({ ...current, expenseDate: event.target.value }))}
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={isGroupDisabled}
                  required
                />
                <div className="md:col-span-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Receipt or attachment
                  </label>
                  <input
                    key={expenseFileInputKey}
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp,.pdf"
                    onChange={(event) => setExpenseAttachment(event.target.files?.[0] || null)}
                    className="block w-full text-sm text-gray-600"
                    disabled={isGroupDisabled}
                  />
                  <p className="text-xs text-gray-500 mt-1">Optional. JPG, PNG, WEBP, or PDF up to 5 MB.</p>
                </div>
                <button
                  type="submit"
                  disabled={expenseLoading || isExpenseMonthClosed || isGroupDisabled}
                  className="md:col-span-4 justify-self-start px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {expenseLoading ? 'Saving...' : 'Save Expense'}
                </button>
              </form>
              {expenseNotice && (
                <p className={`text-sm mt-3 px-3 py-2 rounded-lg ${getNoticeClasses(expenseNotice.type)}`}>
                  {expenseNotice.text}
                </p>
              )}
              {expenseError && <p className="text-sm text-red-700 mt-3">{expenseError}</p>}
              {isGroupDisabled && (
                <p className="text-sm text-amber-700 mt-3">
                  This group is disabled, so expenses can no longer be changed.
                </p>
              )}
              {isExpenseMonthClosed && (
                <p className="text-sm text-amber-700 mt-3">
                  The selected month is already settled, so new expenses cannot be added there.
                </p>
              )}
            </div>

            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Expenses</h2>
                <span className="text-sm text-gray-500">{filteredExpenses.length} record{filteredExpenses.length !== 1 ? 's' : ''}</span>
              </div>

              <div className="grid gap-3 md:grid-cols-3 mb-4">
                <div className="relative">
                  <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={expenseFilters.search}
                    onChange={(event) => setExpenseFilters((current) => ({ ...current, search: event.target.value }))}
                    placeholder="Search note or member"
                    className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <select
                  value={expenseFilters.month}
                  onChange={(event) => setExpenseFilters((current) => ({ ...current, month: event.target.value }))}
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All months</option>
                  {monthOptions.map((month) => (
                    <option key={month} value={month}>{formatMonth(month)}</option>
                  ))}
                </select>
                <select
                  value={expenseFilters.memberId}
                  onChange={(event) => setExpenseFilters((current) => ({ ...current, memberId: event.target.value }))}
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All members</option>
                  {group.members?.map((member) => (
                    <option key={member.id} value={member.id}>{member.name}</option>
                  ))}
                </select>
              </div>

              {filteredExpenses.length === 0 ? (
                <p className="text-gray-600">No expenses recorded yet.</p>
              ) : (
                <div className="space-y-3">
                  {filteredExpenses.map((expense) => (
                    <div key={expense.id} className="flex flex-col gap-3 rounded-lg border border-gray-200 p-4 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="font-medium text-gray-900">{expense.note || 'Expense'}</p>
                        <p className="text-sm text-gray-600">{expense.user_name} • {formatDate(expense.expense_date)}</p>
                        {expense.attachment && (
                          <a
                            href={expense.attachment.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 mt-2 text-sm text-blue-600 hover:text-blue-700"
                          >
                            <Upload className="w-4 h-4" />
                            {expense.attachment.name}
                          </a>
                        )}
                      </div>
                      <div className="flex items-center gap-4">
                        {settledMonths.has(getMonthFromDate(expense.expense_date)) && (
                          <span className="text-xs font-medium text-blue-700 bg-blue-50 px-2 py-1 rounded">
                            Settled month
                          </span>
                        )}
                        <p className="text-lg font-semibold text-red-600">{formatCurrency(expense.amount)}</p>
                        {expense.user_id === user?.id && !settledMonths.has(getMonthFromDate(expense.expense_date)) && !isGroupDisabled && (
                          <button
                            onClick={() => handleDeleteExpense(expense.id)}
                            className="text-sm text-red-600 hover:text-red-700"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'payments' && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center justify-between gap-3 mb-4">
                <h2 className="text-lg font-semibold text-gray-900">
                  {editingPaymentId ? 'Edit Payment' : 'Record Payment'}
                </h2>
                {editingPaymentId && (
                  <button
                    type="button"
                    onClick={handleCancelPaymentEdit}
                    disabled={isGroupDisabled}
                    className="text-sm text-gray-600 hover:text-gray-800"
                  >
                    Cancel edit
                  </button>
                )}
              </div>
              <form onSubmit={handleAddPayment} className="grid md:grid-cols-4 gap-4">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={paymentForm.amount}
                  onChange={(event) => setPaymentForm((current) => ({ ...current, amount: event.target.value }))}
                  placeholder="Amount"
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={isGroupDisabled}
                  required
                />
                <select
                  value={paymentForm.paymentMethod}
                  onChange={(event) => setPaymentForm((current) => ({ ...current, paymentMethod: event.target.value }))}
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={isGroupDisabled}
                >
                  <option value="Cash">Cash</option>
                  <option value="PayPal">PayPal</option>
                </select>
                <input
                  type="text"
                  value={paymentForm.customerNote}
                  onChange={(event) => setPaymentForm((current) => ({ ...current, customerNote: event.target.value }))}
                  placeholder="Customer note"
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={isGroupDisabled}
                />
                <input
                  type="date"
                  value={paymentForm.paymentDate}
                  onChange={(event) => setPaymentForm((current) => ({ ...current, paymentDate: event.target.value }))}
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={isGroupDisabled}
                  required
                />
                <div className="md:col-span-4 space-y-2">
                  <label className="block text-sm font-medium text-gray-700">
                    Receipt or attachment
                  </label>
                  <input
                    key={paymentFileInputKey}
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp,.pdf"
                    onChange={(event) => setPaymentAttachment(event.target.files?.[0] || null)}
                    className="block w-full text-sm text-gray-600"
                    disabled={isGroupDisabled}
                  />
                  {paymentCurrentAttachment && !removePaymentAttachment && (
                    <div className="flex items-center gap-3 text-sm">
                      <a
                        href={paymentCurrentAttachment.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 hover:text-blue-700"
                      >
                        Current: {paymentCurrentAttachment.name}
                      </a>
                      <button
                        type="button"
                        onClick={() => setRemovePaymentAttachment(true)}
                        className="text-red-600 hover:text-red-700"
                      >
                        Remove current attachment
                      </button>
                    </div>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={paymentLoading || isPaymentMonthClosed || isGroupDisabled}
                  className="md:col-span-4 justify-self-start px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {paymentLoading ? 'Saving...' : editingPaymentId ? 'Update Payment' : 'Save Payment'}
                </button>
              </form>
              {paymentNotice && (
                <p className={`text-sm mt-3 px-3 py-2 rounded-lg ${getNoticeClasses(paymentNotice.type)}`}>
                  {paymentNotice.text}
                </p>
              )}
              {paymentError && <p className="text-sm text-red-700 mt-3">{paymentError}</p>}
              {isGroupDisabled && (
                <p className="text-sm text-amber-700 mt-3">
                  This group is disabled, so payments can no longer be changed.
                </p>
              )}
              {isPaymentMonthClosed && (
                <p className="text-sm text-amber-700 mt-3">
                  The selected month is already settled, so payments there are read-only now.
                </p>
              )}
            </div>

            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Payments</h2>
                <span className="text-sm text-gray-500">{filteredPayments.length} record{filteredPayments.length !== 1 ? 's' : ''}</span>
              </div>

              <div className="grid gap-3 md:grid-cols-3 mb-4">
                <div className="relative">
                  <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={paymentFilters.search}
                    onChange={(event) => setPaymentFilters((current) => ({ ...current, search: event.target.value }))}
                    placeholder="Search note, member, or method"
                    className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <select
                  value={paymentFilters.month}
                  onChange={(event) => setPaymentFilters((current) => ({ ...current, month: event.target.value }))}
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All months</option>
                  {monthOptions.map((month) => (
                    <option key={month} value={month}>{formatMonth(month)}</option>
                  ))}
                </select>
                <select
                  value={paymentFilters.memberId}
                  onChange={(event) => setPaymentFilters((current) => ({ ...current, memberId: event.target.value }))}
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All members</option>
                  {group.members?.map((member) => (
                    <option key={member.id} value={member.id}>{member.name}</option>
                  ))}
                </select>
              </div>

              {filteredPayments.length === 0 ? (
                <p className="text-gray-600">No payments recorded yet.</p>
              ) : (
                <div className="space-y-3">
                  {filteredPayments.map((payment) => (
                    <div key={payment.id} className="flex flex-col gap-3 rounded-lg border border-gray-200 p-4 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="font-medium text-gray-900">{payment.customer_note || 'Customer payment'}</p>
                        <p className="text-sm text-gray-600">
                          {payment.user_name} • {payment.payment_method} • {formatDate(payment.payment_date)}
                        </p>
                        {payment.attachment && (
                          <a
                            href={payment.attachment.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 mt-2 text-sm text-blue-600 hover:text-blue-700"
                          >
                            <Upload className="w-4 h-4" />
                            {payment.attachment.name}
                          </a>
                        )}
                      </div>
                      <div className="flex items-center gap-4">
                        {settledMonths.has(getMonthFromDate(payment.payment_date)) && (
                          <span className="text-xs font-medium text-blue-700 bg-blue-50 px-2 py-1 rounded">
                            Settled month
                          </span>
                        )}
                        <p className="text-lg font-semibold text-green-600">{formatCurrency(payment.amount)}</p>
                        {payment.user_id === user?.id && !settledMonths.has(getMonthFromDate(payment.payment_date)) && !isGroupDisabled && (
                          <>
                            <button
                              onClick={() => handleEditPayment(payment)}
                              className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
                            >
                              <Pencil className="w-4 h-4" />
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeletePayment(payment.id)}
                              className="text-sm text-red-600 hover:text-red-700"
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'settlement' && settlement && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <TrendingUp className="w-5 h-5" />
                Open Settlement Summary
              </h2>
              <p className="text-sm text-gray-600 mb-6">
                This summary includes only months that are still open. Closed months stay in the history below, and member balances follow each person&apos;s active dates in the group.
              </p>

              <div className="grid md:grid-cols-3 gap-4 mb-6">
                <div>
                  <p className="text-sm text-gray-600">Total Received</p>
                  <p className="text-2xl font-bold text-green-600">{formatCurrency(settlement.totalReceived)}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Total Expenses</p>
                  <p className="text-2xl font-bold text-red-600">{formatCurrency(settlement.totalExpenses)}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Net Profit</p>
                  <p className="text-2xl font-bold text-blue-600">{formatCurrency(settlement.netProfit)}</p>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="font-semibold text-gray-900">Member Balances</h3>
                {settlement.memberBalances?.map((balance) => (
                  <div key={balance.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                    <div>
                      <p className="font-medium text-gray-900">{balance.name}</p>
                      <div className="text-sm text-gray-600 mt-1 space-y-1">
                        <p>Spent: {formatCurrency(balance.amountSpent)}</p>
                        <p>Received: {formatCurrency(balance.amountReceived)}</p>
                        <p>After own spend/payment: {formatCurrency(balance.netAfterOwnActivity)}</p>
                        <p>Share: {formatCurrency(balance.profitShare)}</p>
                      </div>
                    </div>
                    <div className={`text-right font-semibold ${
                      balance.balance > 0
                        ? 'text-green-600'
                        : balance.balance < 0
                        ? 'text-red-600'
                        : 'text-gray-600'
                    }`}>
                      <p>{balance.balance > 0 ? 'Gets' : balance.balance < 0 ? 'Owes' : 'Even'}</p>
                      <p className="text-lg">{formatCurrency(Math.abs(balance.balance))}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-6">
                <TransferSuggestions
                  suggestions={settlement.transferSuggestions || []}
                  formatCurrency={formatCurrency}
                />
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Monthly Settlement History</h2>
              {settlementNotice && (
                <p className={`text-sm mb-4 px-3 py-2 rounded-lg ${getNoticeClasses(settlementNotice.type)}`}>
                  {settlementNotice.text}
                </p>
              )}

              {settlementHistory.length === 0 ? (
                <p className="text-gray-600">No monthly settlement history yet.</p>
              ) : (
                <div className="space-y-6">
                  {settlementHistory.map((monthlySettlement) => (
                    <div key={monthlySettlement.month} className="border border-gray-200 rounded-lg p-5">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-4">
                        <div>
                          <h3 className="text-base font-semibold text-gray-900">
                            {formatMonth(monthlySettlement.month)}
                          </h3>
                          <p className="text-sm text-gray-600">
                            Received {formatCurrency(monthlySettlement.totalReceived)} •
                            Spent {formatCurrency(monthlySettlement.totalExpenses)} •
                            Net {formatCurrency(monthlySettlement.netProfit)}
                          </p>
                          {monthlySettlement.isSettled && (
                            <p className="text-sm text-blue-700 mt-2">
                              Closed on {formatDate(monthlySettlement.settledAt)}
                              {monthlySettlement.settledByName ? ` by ${monthlySettlement.settledByName}` : ''}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col gap-2 md:items-end">
                          <div className="text-sm font-medium text-purple-700 bg-purple-50 px-3 py-2 rounded-lg">
                            Average Share: {formatCurrency(monthlySettlement.perPersonShare)}
                          </div>
                          {monthlySettlement.isSettled ? (
                            <span className="text-sm font-medium text-blue-700 bg-blue-50 px-3 py-2 rounded-lg">
                              Settled
                            </span>
                          ) : monthlySettlement.totalReceived > 0 && !isGroupDisabled ? (
                            <button
                              onClick={() => handleSettleMonth(monthlySettlement.month)}
                              disabled={settlementActionLoading === monthlySettlement.month}
                              className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                            >
                              {settlementActionLoading === monthlySettlement.month ? 'Settling...' : 'Settle Up'}
                            </button>
                          ) : isGroupDisabled ? (
                            <span className="text-sm font-medium text-amber-700 bg-amber-50 px-3 py-2 rounded-lg">
                              Group disabled
                            </span>
                          ) : (
                            <span className="text-sm font-medium text-gray-600 bg-gray-100 px-3 py-2 rounded-lg">
                              Waiting for received money
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="space-y-3">
                        {monthlySettlement.memberBalances.map((balance) => (
                          <div key={`${monthlySettlement.month}-${balance.id}`} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                            <div>
                              <p className="font-medium text-gray-900">{balance.name}</p>
                              <div className="text-sm text-gray-600 mt-1 space-y-1">
                                <p>Spent: {formatCurrency(balance.amountSpent)}</p>
                                <p>Received: {formatCurrency(balance.amountReceived)}</p>
                                <p>After own spend/payment: {formatCurrency(balance.netAfterOwnActivity)}</p>
                              </div>
                            </div>
                            <div className={`text-right font-semibold ${
                              balance.balance > 0
                                ? 'text-green-600'
                                : balance.balance < 0
                                ? 'text-red-600'
                                : 'text-gray-600'
                            }`}>
                              <p>{balance.balance > 0 ? 'Gets' : balance.balance < 0 ? 'Owes' : 'Even'}</p>
                              <p className="text-lg">{formatCurrency(Math.abs(balance.balance))}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-4">
                        <TransferSuggestions
                          suggestions={monthlySettlement.transferSuggestions || []}
                          formatCurrency={formatCurrency}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'activity' && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="w-5 h-5 text-blue-600" />
                <h2 className="text-lg font-semibold text-gray-900">Group Activity Timeline</h2>
              </div>

              <div className="grid gap-3 md:grid-cols-3 mb-4">
                <div className="relative">
                  <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={activityFilters.search}
                    onChange={(event) => setActivityFilters((current) => ({ ...current, search: event.target.value }))}
                    placeholder="Search activity"
                    className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <select
                  value={activityFilters.memberId}
                  onChange={(event) => setActivityFilters((current) => ({ ...current, memberId: event.target.value }))}
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All members</option>
                  {group.members?.map((member) => (
                    <option key={member.id} value={member.id}>{member.name}</option>
                  ))}
                </select>
                <select
                  value={activityFilters.type}
                  onChange={(event) => setActivityFilters((current) => ({ ...current, type: event.target.value }))}
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All activity types</option>
                  {Array.from(new Set(activityItems.map((item) => item.activity_type))).map((type) => (
                    <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>

              {activityLoading ? (
                <p className="text-gray-600">Loading activity...</p>
              ) : filteredActivity.length === 0 ? (
                <p className="text-gray-600">No activity matched your filters.</p>
              ) : (
                <div className="space-y-3">
                  {filteredActivity.map((item) => (
                    <div key={item.id} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div>
                          <p className="font-medium text-gray-900">{item.title}</p>
                          <p className="text-sm text-gray-600 mt-1">{item.description}</p>
                        </div>
                        <div className="text-sm text-gray-500">
                          <p>{item.user_name || 'System'}</p>
                          <p>{formatDate(item.created_at)}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'summary' && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Monthly Summary</h2>
                  <p className="text-sm text-gray-600 mt-1">
                    Review one month at a time and export the report as CSV or PDF.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <select
                    value={summaryMonth}
                    onChange={handleSummaryMonthChange}
                    className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {monthOptions.map((month) => (
                      <option key={month} value={month}>{formatMonth(month)}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => handleDownloadSummary('csv')}
                    disabled={!monthlySummary}
                    className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                  >
                    <Download className="w-4 h-4" />
                    CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownloadSummary('pdf')}
                    disabled={!monthlySummary}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    <FileText className="w-4 h-4" />
                    PDF
                  </button>
                </div>
              </div>

              {summaryNotice && (
                <p className={`text-sm mt-4 px-3 py-2 rounded-lg ${getNoticeClasses(summaryNotice.type)}`}>
                  {summaryNotice.text}
                </p>
              )}

              {summaryLoading ? (
                <p className="text-gray-600 mt-4">Loading monthly summary...</p>
              ) : monthlySummary ? (
                <div className="space-y-6 mt-6">
                  <div className="grid md:grid-cols-4 gap-4">
                    <div className="bg-gray-50 rounded-lg p-4">
                      <p className="text-sm text-gray-600">Received</p>
                      <p className="text-2xl font-bold text-green-600 mt-2">{formatCurrency(monthlySummary.totals.totalReceived)}</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-4">
                      <p className="text-sm text-gray-600">Expenses</p>
                      <p className="text-2xl font-bold text-red-600 mt-2">{formatCurrency(monthlySummary.totals.totalExpenses)}</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-4">
                      <p className="text-sm text-gray-600">Net</p>
                      <p className="text-2xl font-bold text-blue-600 mt-2">{formatCurrency(monthlySummary.totals.netProfit)}</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-4">
                      <p className="text-sm text-gray-600">Status</p>
                      <p className="text-2xl font-bold text-purple-600 mt-2">{monthlySummary.isSettled ? 'Settled' : 'Open'}</p>
                    </div>
                  </div>

                  <TransferSuggestions
                    suggestions={monthlySummary.transferSuggestions || []}
                    formatCurrency={formatCurrency}
                  />

                  <div className="grid lg:grid-cols-2 gap-6">
                    <div>
                      <h3 className="font-semibold text-gray-900 mb-3">Member balances</h3>
                      <div className="space-y-3">
                        {monthlySummary.memberBalances.map((member) => (
                          <div key={member.id} className="border border-gray-200 rounded-lg p-4">
                            <div className="flex items-center justify-between gap-4">
                              <div>
                                <p className="font-medium text-gray-900">{member.name}</p>
                                <p className="text-sm text-gray-600 mt-1">
                                  Spent {formatCurrency(member.amountSpent)} • Received {formatCurrency(member.amountReceived)}
                                </p>
                              </div>
                              <p className="font-semibold text-gray-900">{formatCurrency(member.balance)}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <h3 className="font-semibold text-gray-900 mb-3">Records this month</h3>
                      <div className="space-y-3">
                        <div className="border border-gray-200 rounded-lg p-4">
                          <p className="font-medium text-gray-900">Expenses</p>
                          <p className="text-sm text-gray-600 mt-1">{monthlySummary.records.expenseCount} record(s)</p>
                        </div>
                        <div className="border border-gray-200 rounded-lg p-4">
                          <p className="font-medium text-gray-900">Payments</p>
                          <p className="text-sm text-gray-600 mt-1">{monthlySummary.records.paymentCount} record(s)</p>
                        </div>
                        {monthlySummary.settledAt && (
                          <div className="border border-gray-200 rounded-lg p-4">
                            <p className="font-medium text-gray-900">Settlement details</p>
                            <p className="text-sm text-gray-600 mt-1">
                              Closed on {formatDate(monthlySummary.settledAt)}
                              {monthlySummary.settledByName ? ` by ${monthlySummary.settledByName}` : ''}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-gray-600 mt-4">No monthly summary available yet.</p>
              )}
            </div>
          </div>
        )}

        {activeTab === 'templates' && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center gap-2 mb-4">
                <Repeat className="w-5 h-5 text-blue-600" />
                <h2 className="text-lg font-semibold text-gray-900">Recurring Templates</h2>
              </div>

              <form onSubmit={handleTemplateSubmit} className="grid gap-4 md:grid-cols-3">
                <select
                  value={templateForm.entryType}
                  onChange={(event) => setTemplateForm((current) => ({ ...current, entryType: event.target.value }))}
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="expense">Expense</option>
                  <option value="payment">Payment</option>
                </select>
                <input
                  type="text"
                  value={templateForm.title}
                  onChange={(event) => setTemplateForm((current) => ({ ...current, title: event.target.value }))}
                  placeholder="Template title"
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={templateForm.amount}
                  onChange={(event) => setTemplateForm((current) => ({ ...current, amount: event.target.value }))}
                  placeholder="Amount"
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
                <input
                  type="text"
                  value={templateForm.note}
                  onChange={(event) => setTemplateForm((current) => ({ ...current, note: event.target.value }))}
                  placeholder="Default note"
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 md:col-span-2"
                />
                {templateForm.entryType === 'payment' && (
                  <select
                    value={templateForm.paymentMethod}
                    onChange={(event) => setTemplateForm((current) => ({ ...current, paymentMethod: event.target.value }))}
                    className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="Cash">Cash</option>
                    <option value="PayPal">PayPal</option>
                  </select>
                )}
                <select
                  value={templateForm.frequency}
                  onChange={(event) => setTemplateForm((current) => ({ ...current, frequency: event.target.value }))}
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="monthly">Monthly</option>
                  <option value="weekly">Weekly</option>
                </select>
                {templateForm.frequency === 'monthly' ? (
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={templateForm.dayOfMonth}
                    onChange={(event) => setTemplateForm((current) => ({ ...current, dayOfMonth: event.target.value }))}
                    placeholder="Day of month"
                    className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                ) : (
                  <select
                    value={templateForm.dayOfWeek}
                    onChange={(event) => setTemplateForm((current) => ({ ...current, dayOfWeek: event.target.value }))}
                    className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="0">Sunday</option>
                    <option value="1">Monday</option>
                    <option value="2">Tuesday</option>
                    <option value="3">Wednesday</option>
                    <option value="4">Thursday</option>
                    <option value="5">Friday</option>
                    <option value="6">Saturday</option>
                  </select>
                )}
                <button
                  type="submit"
                  disabled={templateLoading || isGroupDisabled}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {templateLoading ? 'Saving...' : 'Create Template'}
                </button>
              </form>

              {templateNotice && (
                <p className={`text-sm mt-4 px-3 py-2 rounded-lg ${getNoticeClasses(templateNotice.type)}`}>
                  {templateNotice.text}
                </p>
              )}
            </div>

            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Saved Templates</h2>
              {templates.length === 0 ? (
                <p className="text-gray-600">No recurring templates yet.</p>
              ) : (
                <div className="space-y-3">
                  {templates.map((template) => (
                    <div key={template.id} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                        <div>
                          <p className="font-medium text-gray-900">{template.title}</p>
                          <p className="text-sm text-gray-600 mt-1">
                            {template.entry_type} • {formatCurrency(template.amount)} • {template.frequency}
                            {template.frequency === 'monthly'
                              ? ` on day ${template.day_of_month}`
                              : ` on weekday ${template.day_of_week}`}
                          </p>
                          <p className="text-xs text-gray-500 mt-1">Created by {template.user_name}</p>
                        </div>
                        <div className="flex flex-wrap gap-3">
                          <button
                            type="button"
                            onClick={() => handleUseTemplate(template.id)}
                            disabled={templateLoading || !template.is_active || isGroupDisabled}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                          >
                            Use Today
                          </button>
                          {template.user_id === user?.id && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleToggleTemplate(template)}
                                disabled={templateLoading || isGroupDisabled}
                                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                              >
                                {template.is_active ? 'Pause' : 'Activate'}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteTemplate(template)}
                                disabled={templateLoading || isGroupDisabled}
                                className="px-4 py-2 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-50"
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center gap-2 mb-4">
                <Settings2 className="w-5 h-5 text-blue-600" />
                <h2 className="text-lg font-semibold text-gray-900">Group Settings</h2>
              </div>

              {!canEditSettings ? (
                <p className="text-gray-600">Only the admin or co-admin can update group settings.</p>
              ) : (
                <form onSubmit={handleSaveSettings} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Group name</label>
                    <input
                      type="text"
                      value={settingsForm.name}
                      onChange={(event) => setSettingsForm((current) => ({ ...current, name: event.target.value }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      disabled={isGroupDisabled}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                    <textarea
                      value={settingsForm.description}
                      onChange={(event) => setSettingsForm((current) => ({ ...current, description: event.target.value }))}
                      rows="4"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      disabled={isGroupDisabled}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Currency</label>
                    <select
                      value={settingsForm.currency}
                      onChange={(event) => setSettingsForm((current) => ({ ...current, currency: event.target.value }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      disabled={isGroupDisabled}
                    >
                      {CURRENCY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                  {settingsNotice && (
                    <p className={`text-sm px-3 py-2 rounded-lg ${getNoticeClasses(settingsNotice.type)}`}>
                      {settingsNotice.text}
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={settingsLoading || isGroupDisabled}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                  >
                    {settingsLoading ? 'Saving...' : 'Save Settings'}
                  </button>
                </form>
              )}
            </div>
          </div>
        )}

        {activeTab === 'approvals' && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center gap-2 mb-4">
                <ShieldAlert className="w-5 h-5 text-red-600" />
                <h2 className="text-lg font-semibold text-gray-900">Group Disable Approvals</h2>
              </div>

              {deleteGroupNotice && (
                <p className={`text-sm mb-4 px-3 py-2 rounded-lg ${getNoticeClasses(deleteGroupNotice.type)}`}>
                  {deleteGroupNotice.text}
                </p>
              )}

              {!deletionRequest ? (
                isAdmin ? (
                  <div className="border border-red-200 bg-red-50 rounded-lg p-5">
                    <h3 className="text-base font-semibold text-red-900 mb-2">Disable this group</h3>
                    <p className="text-sm text-red-800 mb-4">
                      When you request disabling, every current member must approve it. Before the final step, all members will receive the full report by email.
                    </p>
                    <button
                      type="button"
                      onClick={handleRequestDeleteGroup}
                      disabled={deleteGroupLoading === 'request' || isGroupDisabled}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="w-4 h-4" />
                      {deleteGroupLoading === 'request' ? 'Sending request...' : 'Request Disable Group'}
                    </button>
                  </div>
                ) : (
                  <p className="text-gray-600">There is no pending disable approval request for this group.</p>
                )
              ) : (
                <div className="space-y-5">
                  <div className="border border-gray-200 rounded-lg p-5">
                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                      <div>
                        <h3 className="text-base font-semibold text-gray-900">
                          {isGroupDisabled ? 'Group is disabled' : 'Disable request is pending'}
                        </h3>
                        <p className="text-sm text-gray-600 mt-1">
                          Requested by {deletionRequest.requested_by_name} on {formatDate(deletionRequest.requested_at)}
                        </p>
                        <p className="text-sm text-gray-600 mt-1">
                          Approved {deletionRequest.approvedCount} of {deletionRequest.totalApprovals} members
                        </p>
                      </div>

                      {!hasApprovedDeletion && !isGroupDisabled && (
                        <button
                          type="button"
                          onClick={handleApproveDeleteGroup}
                          disabled={deleteGroupLoading === 'approve'}
                          className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          {deleteGroupLoading === 'approve' ? 'Approving...' : 'Approve Disable'}
                        </button>
                      )}
                    </div>

                    {isGroupDisabled && (
                      <p className="text-sm text-green-700 mt-4">
                        This group is now disabled. Members can still view all records and approval history here.
                      </p>
                    )}

                    {hasApprovedDeletion && (
                      <p className="text-sm text-green-700 mt-4">
                        You already approved this request. The group will be disabled after the remaining approvals are completed.
                      </p>
                    )}
                  </div>

                  <div className="bg-white border border-gray-200 rounded-lg p-5">
                    <h3 className="text-base font-semibold text-gray-900 mb-4">Member approval status</h3>
                    <div className="space-y-3">
                      {deletionRequest.approvals?.map((approval) => (
                        <div
                          key={approval.user_id}
                          className="flex flex-col gap-3 rounded-lg border border-gray-200 p-4 md:flex-row md:items-center md:justify-between"
                        >
                          <div>
                            <p className="font-medium text-gray-900">{approval.name}</p>
                            <p className="text-sm text-gray-500">{approval.email}</p>
                          </div>
                          <span className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ${
                            approval.approved_at
                              ? 'bg-green-50 text-green-700'
                              : 'bg-amber-50 text-amber-700'
                          }`}>
                            {approval.approved_at ? (
                              <>
                                <CheckCircle2 className="w-4 h-4" />
                                Approved on {formatDate(approval.approved_at)}
                              </>
                            ) : (
                              <>
                                <Clock3 className="w-4 h-4" />
                                Waiting for approval
                              </>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
