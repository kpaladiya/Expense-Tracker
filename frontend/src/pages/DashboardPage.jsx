import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowRight, BarChart3, CheckCircle2, Mail, PlusCircle, Receipt, RotateCcw, ShieldAlert, Sparkles, UserCircle2, Users, Wallet, XCircle } from 'lucide-react';
import { useAuth } from '../services/AuthContext';
import NotificationCenter from '../components/NotificationCenter';
import { expensesAPI, groupsAPI, inboxAPI, paymentsAPI, settlementAPI, undoAPI } from '../services/api';
import SiteFooter from '../components/SiteFooter';
import { formatCurrency } from '../utils/currency';

export default function DashboardPage() {
  const navigate = useNavigate();
  const { user, logout, updateProfile, refreshUser } = useAuth();
  const [groups, setGroups] = useState([]);
  const [settlements, setSettlements] = useState({});
  const [invitations, setInvitations] = useState([]);
  const [pendingDeleteApprovals, setPendingDeleteApprovals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [inviteActionLoading, setInviteActionLoading] = useState('');
  const [notifications, setNotifications] = useState([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [personalSummary, setPersonalSummary] = useState(null);
  const [undoAction, setUndoAction] = useState(null);
  const [undoLoading, setUndoLoading] = useState(false);
  const [dashboardNotice, setDashboardNotice] = useState(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddLoading, setQuickAddLoading] = useState(false);
  const [quickAddType, setQuickAddType] = useState('expense');
  const [quickAddForm, setQuickAddForm] = useState({
    groupId: '',
    amount: '',
    note: '',
    paymentMethod: 'Cash',
    date: new Date().toISOString().slice(0, 10)
  });

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setError('');
      setLoading(true);

      const [groupsResult, invitationsResult, deleteApprovalsResult, notificationsResult, personalSummaryResult, undoResult] = await Promise.all([
        groupsAPI.getGroups(),
        groupsAPI.getReceivedInvitations(),
        groupsAPI.getPendingDeleteApprovals(),
        inboxAPI.getNotifications({ limit: 200 }),
        groupsAPI.getPersonalSummary().catch(() => ({ success: false })),
        undoAPI.getLatest().catch(() => ({ success: false }))
      ]);

      if (groupsResult.success) {
        setGroups(groupsResult.data);

        const nextSettlements = {};
        await Promise.all(
          groupsResult.data.map(async (group) => {
            try {
              const settlementResult = await settlementAPI.getSettlement(group.id);
              if (settlementResult.success) {
                nextSettlements[group.id] = settlementResult.data;
              }
            } catch (settlementError) {
              console.error('Settlement error:', settlementError);
            }
          })
        );

        setSettlements(nextSettlements);
      }

      if (invitationsResult.success) {
        setInvitations(invitationsResult.data);
      }

      if (deleteApprovalsResult.success) {
        setPendingDeleteApprovals(deleteApprovalsResult.data);
      }

      if (notificationsResult.success) {
        setNotifications(notificationsResult.data.notifications);
        setUnreadNotifications(notificationsResult.data.unreadCount);
      }

      if (personalSummaryResult.success) {
        setPersonalSummary(personalSummaryResult.data);
      }

      if (undoResult.success) {
        setUndoAction(undoResult.data);
      }
    } catch (err) {
      setError(err.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const handleInvitationResponse = async (requestId, action) => {
    try {
      setInviteError('');
      setInviteActionLoading(`${requestId}-${action}`);
      await groupsAPI.respondToInvitation(requestId, action);
      await loadDashboardData();
    } catch (err) {
      setInviteError(err.message || 'Failed to respond to invitation');
    } finally {
      setInviteActionLoading('');
    }
  };

  const handleOpenNotification = async (notification) => {
    if (!notification.isRead) {
      await handleMarkNotificationRead(notification.id, false);
    }

    if (notification.actionUrl) {
      navigate(notification.actionUrl);
    }
  };

  const handleMarkNotificationRead = async (notificationId, reload = true) => {
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

      if (reload) {
        const notificationsResult = await inboxAPI.getNotifications({ limit: 200 });
        if (notificationsResult.success) {
          setNotifications(notificationsResult.data.notifications);
          setUnreadNotifications(notificationsResult.data.unreadCount);
        }
      }
    } catch (err) {
      setError(err.message || 'Failed to update notification');
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
    } catch (err) {
      setError(err.message || 'Failed to update notifications');
    } finally {
      setNotificationLoading(false);
    }
  };

  const handleDismissOnboarding = async () => {
    try {
      setDashboardNotice(null);
      await updateProfile({ onboardingCompleted: true });
      setDashboardNotice({
        type: 'success',
        text: 'Walkthrough dismissed. You can still explore everything from the dashboard.'
      });
    } catch (err) {
      setError(err.message || 'Failed to update onboarding');
    }
  };

  const handleCreateSampleGroup = async () => {
    try {
      setDashboardNotice(null);
      const result = await groupsAPI.createSampleGroup();
      await refreshUser();
      setDashboardNotice({
        type: 'success',
        text: result.message || 'Sample example created successfully.'
      });
      await loadDashboardData();
      navigate(`/group/${result.data.id}`);
    } catch (err) {
      setError(err.message || 'Failed to create sample example');
    }
  };

  const openQuickAdd = (type) => {
    setQuickAddType(type);
    setQuickAddForm((current) => ({
      ...current,
      groupId: current.groupId || groups[0]?.id || '',
      date: new Date().toISOString().slice(0, 10)
    }));
    setQuickAddOpen(true);
  };

  const handleQuickAddSubmit = async (event) => {
    event.preventDefault();

    if (!quickAddForm.groupId || !quickAddForm.amount) {
      setError('Choose a group and amount first.');
      return;
    }

    try {
      setQuickAddLoading(true);
      setDashboardNotice(null);
      const result = quickAddType === 'expense'
        ? await expensesAPI.addExpense(
            quickAddForm.groupId,
            quickAddForm.amount,
            quickAddForm.note,
            quickAddForm.date
          )
        : await paymentsAPI.recordPayment(
            quickAddForm.groupId,
            quickAddForm.amount,
            quickAddForm.paymentMethod,
            quickAddForm.note,
            quickAddForm.date
          );

      setQuickAddOpen(false);
      setQuickAddForm({
        groupId: groups[0]?.id || '',
        amount: '',
        note: '',
        paymentMethod: 'Cash',
        date: new Date().toISOString().slice(0, 10)
      });
      setDashboardNotice({
        type: result.warning ? 'warning' : 'success',
        text: result.warning || result.message
      });
      await loadDashboardData();
    } catch (err) {
      setError(err.message || `Failed to add ${quickAddType}`);
    } finally {
      setQuickAddLoading(false);
    }
  };

  const handleUndo = async () => {
    if (!undoAction?.id) {
      return;
    }

    try {
      setUndoLoading(true);
      const result = await undoAPI.undo(undoAction.id);
      setDashboardNotice({
        type: 'success',
        text: result.message || 'Recent action undone successfully.'
      });
      await loadDashboardData();
    } catch (err) {
      setError(err.message || 'Failed to undo recent action');
    } finally {
      setUndoLoading(false);
    }
  };

  const summaryByGroup = new Map((personalSummary?.groups || []).map((item) => [item.groupId, item]));

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-600">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Shared Expenses</h1>
            <p className="text-sm text-gray-600">Welcome, {user?.name}</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/profile')}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <UserCircle2 className="w-4 h-4" />
              Profile
            </button>
            <button
              onClick={handleLogout}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Logout
            </button>
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

        {inviteError && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
            <p className="text-sm text-red-800">{inviteError}</p>
          </div>
        )}

        {dashboardNotice && (
          <div className={`mb-6 p-4 rounded-lg flex gap-3 ${dashboardNotice.type === 'warning' ? 'bg-amber-50 border border-amber-200' : 'bg-green-50 border border-green-200'}`}>
            <CheckCircle2 className={`w-5 h-5 flex-shrink-0 ${dashboardNotice.type === 'warning' ? 'text-amber-600' : 'text-green-600'}`} />
            <p className={`text-sm ${dashboardNotice.type === 'warning' ? 'text-amber-800' : 'text-green-800'}`}>{dashboardNotice.text}</p>
          </div>
        )}

        {personalSummary && (
          <section className="mb-8 grid gap-4 md:grid-cols-3">
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center gap-2 mb-3">
                <Wallet className="w-5 h-5 text-blue-600" />
                <h2 className="text-lg font-semibold text-gray-900">Across all groups</h2>
              </div>
              <p className="text-sm text-gray-600">Your current open settlement position.</p>
            </div>
            <div className="bg-green-50 rounded-lg p-6">
              <p className="text-sm text-green-700 font-medium">You get</p>
              <p className="text-3xl font-bold text-green-900 mt-2">{personalSummary.getsTotal.toFixed(2)}</p>
            </div>
            <div className="bg-red-50 rounded-lg p-6">
              <p className="text-sm text-red-700 font-medium">You owe</p>
              <p className="text-3xl font-bold text-red-900 mt-2">{personalSummary.owesTotal.toFixed(2)}</p>
            </div>
          </section>
        )}

        {!user?.onboardingCompleted && (
          <section className="mb-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="w-5 h-5 text-blue-600" />
                  <h2 className="text-lg font-semibold text-blue-900">Getting started</h2>
                </div>
                <p className="text-sm text-blue-800">
                  1. Create a real group or sample example. 2. Add expenses and payments. 3. Review balances, settle up, and use exports when the month closes.
                </p>
                <p className="text-sm text-blue-700 mt-2">
                  Tip: the mobile quick add below is the fastest daily workflow once you start using the app regularly.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handleCreateSampleGroup}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Create Sample Example
                </button>
                <button
                  onClick={handleDismissOnboarding}
                  className="px-4 py-2 border border-blue-200 text-blue-800 rounded-lg hover:bg-white transition-colors"
                >
                  Dismiss Walkthrough
                </button>
              </div>
            </div>
          </section>
        )}

        {undoAction && (
          <section className="mb-8 bg-amber-50 border border-amber-200 rounded-lg p-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="font-medium text-amber-900">Recent action available to undo</p>
              <p className="text-sm text-amber-800 mt-1">{undoAction.label}</p>
            </div>
            <button
              onClick={handleUndo}
              disabled={undoLoading}
              className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50"
            >
              <RotateCcw className="w-4 h-4" />
              {undoLoading ? 'Undoing...' : 'Undo'}
            </button>
          </section>
        )}

        {invitations.length > 0 && (
          <section className="mb-8 bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center gap-2 mb-4">
              <Mail className="w-5 h-5 text-blue-600" />
              <h2 className="text-lg font-semibold text-gray-900">Group Join Requests</h2>
            </div>
            <div className="space-y-4">
              {invitations.map((invitation) => {
                const waitingForAdmin = invitation.status === 'pending_admin';
                const inviteDisabled = Boolean(invitation.is_disabled);
                return (
                  <div
                    key={invitation.id}
                    className="border border-gray-200 rounded-lg p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
                  >
                    <div>
                      <p className="font-medium text-gray-900">{invitation.group_name}</p>
                      <p className="text-sm text-gray-600">
                        Sent by {invitation.invited_by_name} ({invitation.invited_by_email})
                      </p>
                      <p className="text-sm text-gray-500 mt-1">
                        {inviteDisabled
                          ? 'This group has been disabled, so the invitation is no longer actionable.'
                          : waitingForAdmin
                        ? 'You accepted this request. Waiting for admin approval.'
                        : 'Accept this request to ask the admin to add you to the group.'}
                      </p>
                    </div>

                    {inviteDisabled ? (
                    <span className="inline-flex items-center gap-2 px-3 py-2 bg-red-50 text-red-700 rounded-lg text-sm font-medium">
                      <ShieldAlert className="w-4 h-4" />
                      Group disabled
                    </span>
                    ) : waitingForAdmin ? (
                    <span className="inline-flex items-center gap-2 px-3 py-2 bg-amber-50 text-amber-700 rounded-lg text-sm font-medium">
                        <CheckCircle2 className="w-4 h-4" />
                        Waiting for admin
                      </span>
                    ) : (
                      <div className="flex gap-3">
                        <button
                          onClick={() => handleInvitationResponse(invitation.id, 'decline')}
                          disabled={inviteActionLoading === `${invitation.id}-decline`}
                          className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                        >
                          <XCircle className="w-4 h-4" />
                          Decline
                        </button>
                        <button
                          onClick={() => handleInvitationResponse(invitation.id, 'accept')}
                          disabled={inviteActionLoading === `${invitation.id}-accept`}
                          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          {inviteActionLoading === `${invitation.id}-accept` ? 'Sending...' : 'Accept Request'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {pendingDeleteApprovals.length > 0 && (
          <section className="mb-8 bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center gap-2 mb-4">
              <ShieldAlert className="w-5 h-5 text-red-600" />
              <h2 className="text-lg font-semibold text-gray-900">Disable Approval Requests</h2>
            </div>
            <div className="space-y-4">
              {pendingDeleteApprovals.map((request) => (
                <div
                  key={request.id}
                  className="border border-gray-200 rounded-lg p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
                >
                  <div>
                    <p className="font-medium text-gray-900">{request.group_name}</p>
                    <p className="text-sm text-gray-600">
                      Requested by {request.requested_by_name}
                    </p>
                    <p className="text-sm text-gray-500 mt-1">
                      Approved {request.approved_count} of {request.total_approvals} members
                    </p>
                  </div>

                  <button
                    onClick={() => navigate(`/group/${request.group_id}`)}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                  >
                    Review Disable Request
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="mb-8">
          <NotificationCenter
            notifications={notifications}
            unreadCount={unreadNotifications}
            loading={notificationLoading}
            onMarkRead={handleMarkNotificationRead}
            onMarkAllRead={handleMarkAllNotificationsRead}
            onOpenAction={handleOpenNotification}
          />
        </div>

        {groups.length === 0 ? (
          <div className="text-center py-12">
            <BarChart3 className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">No groups yet</h2>
            <p className="text-gray-600 mb-3">Create or join a group to start tracking expenses.</p>
            <p className="text-sm text-gray-500 mb-6">Start with a real group, or create the sample example to understand the workflow before inviting others.</p>
            <div className="flex flex-wrap justify-center gap-3">
              <button
                onClick={() => navigate('/groups/new')}
                className="inline-flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
              >
                Create Group
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                onClick={handleCreateSampleGroup}
                className="inline-flex items-center gap-2 px-6 py-2 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors"
              >
                <Sparkles className="w-4 h-4" />
                Sample Example
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-8">
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => navigate('/groups/new')}
                  className="inline-flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
                >
                  Create New Group
                  <ArrowRight className="w-4 h-4" />
                </button>
                <button
                  onClick={() => openQuickAdd('expense')}
                  className="inline-flex items-center gap-2 px-6 py-2 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors"
                >
                  <Receipt className="w-4 h-4" />
                  Quick Add
                </button>
              </div>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {groups.map((group) => {
                const settlement = settlements[group.id];
                const userSummary = summaryByGroup.get(group.id);

                return (
                  <div
                    key={group.id}
                    onClick={() => navigate(`/group/${group.id}`)}
                    className={`bg-white rounded-lg shadow-sm transition-shadow cursor-pointer ${
                      group.is_disabled ? 'border border-red-200' : 'hover:shadow-md'
                    }`}
                  >
                    <div className="p-6">
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900">{group.name}</h3>
                          <p className="text-sm text-gray-500">Admin: {group.admin_name}</p>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          {user?.id === group.admin_id && (
                            <span className="inline-block px-2 py-1 bg-blue-100 text-blue-800 text-xs font-medium rounded">
                              Admin
                            </span>
                          )}
                          {user?.id !== group.admin_id && group.current_user_role && (
                            <span className="inline-block px-2 py-1 bg-purple-100 text-purple-800 text-xs font-medium rounded capitalize">
                              {group.current_user_role.replace('_', ' ')}
                            </span>
                          )}
                          {group.is_disabled && (
                            <span className="inline-block px-2 py-1 bg-red-100 text-red-800 text-xs font-medium rounded">
                              Disabled
                            </span>
                          )}
                        </div>
                      </div>

                      {settlement && (
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 gap-4 mb-4">
                            <div className="bg-green-50 rounded-lg p-3">
                              <p className="text-xs text-green-600 font-medium">Received</p>
                              <p className="text-lg font-bold text-green-900">{formatCurrency(settlement.totalReceived, group.currency)}</p>
                            </div>
                            <div className="bg-red-50 rounded-lg p-3">
                              <p className="text-xs text-red-600 font-medium">Spent</p>
                              <p className="text-lg font-bold text-red-900">{formatCurrency(settlement.totalExpenses, group.currency)}</p>
                            </div>
                          </div>

                          <div className="bg-blue-50 rounded-lg p-3">
                            <p className="text-xs text-blue-600 font-medium">Net Profit</p>
                            <p className="text-lg font-bold text-blue-900">{formatCurrency(settlement.netProfit, group.currency)}</p>
                          </div>
                          {userSummary && (
                            <div className={`rounded-lg p-3 ${userSummary.balance >= 0 ? 'bg-emerald-50' : 'bg-orange-50'}`}>
                              <p className={`text-xs font-medium ${userSummary.balance >= 0 ? 'text-emerald-700' : 'text-orange-700'}`}>
                                Your position
                              </p>
                              <p className={`text-lg font-bold ${userSummary.balance >= 0 ? 'text-emerald-900' : 'text-orange-900'}`}>
                                {userSummary.balance >= 0 ? 'Gets ' : 'Owes '}
                                {formatCurrency(Math.abs(userSummary.balance), group.currency)}
                              </p>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="mt-4 pt-4 border-t border-gray-200 flex items-center gap-2 text-gray-600">
                        <Users className="w-4 h-4" />
                        <span className="text-sm">
                          {group.member_count} member{group.member_count !== 1 ? 's' : ''}
                        </span>
                        <span className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded ml-auto">
                          {group.currency}
                        </span>
                      </div>
                    </div>

                    <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between gap-3">
                      {user?.id === group.admin_id ? (
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            navigate(`/group/${group.id}`);
                          }}
                          className="text-sm text-gray-700 font-medium hover:text-gray-900"
                        >
                          Manage Members
                        </button>
                      ) : (
                        <span className="text-sm text-gray-500">
                          {group.is_disabled ? 'This group is read-only' : 'Open group to add expenses and payments'}
                        </span>
                      )}
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          navigate(`/group/${group.id}`);
                        }}
                        className="text-sm text-blue-600 font-medium hover:text-blue-700 flex items-center gap-1"
                      >
                        View Details
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </main>
      {groups.length > 0 && (
        <>
          {quickAddOpen && (
            <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setQuickAddOpen(false)} />
          )}
          <div className={`fixed inset-x-0 bottom-0 z-50 transition-transform sm:inset-0 sm:flex sm:items-center sm:justify-center ${quickAddOpen ? 'translate-y-0' : 'translate-y-[calc(100%-72px)] sm:hidden'}`}>
            <div className="bg-white border-t border-gray-200 rounded-t-2xl shadow-2xl sm:w-full sm:max-w-md sm:rounded-2xl sm:border sm:border-gray-200">
              <div className="flex items-center justify-center gap-3 px-4 py-3 border-b border-gray-100">
                <button
                  onClick={() => openQuickAdd('expense')}
                  className={`flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl ${quickAddType === 'expense' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}
                >
                  <Receipt className="w-4 h-4" />
                  Expense
                </button>
                <button
                  onClick={() => openQuickAdd('payment')}
                  className={`flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl ${quickAddType === 'payment' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}
                >
                  <PlusCircle className="w-4 h-4" />
                  Payment
                </button>
              </div>
              <div className="px-4 pt-3 sm:flex sm:justify-end">
                <button
                  type="button"
                  onClick={() => setQuickAddOpen(false)}
                  className="hidden sm:inline-flex px-3 py-2 text-sm text-gray-600 hover:text-gray-800"
                >
                  Close
                </button>
              </div>
              <form onSubmit={handleQuickAddSubmit} className="p-4 space-y-3">
                <select
                  value={quickAddForm.groupId}
                  onChange={(event) => setQuickAddForm((current) => ({ ...current, groupId: event.target.value }))}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>{group.name}</option>
                  ))}
                </select>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={quickAddForm.amount}
                  onChange={(event) => setQuickAddForm((current) => ({ ...current, amount: event.target.value }))}
                  placeholder="Amount"
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
                {quickAddType === 'payment' && (
                  <select
                    value={quickAddForm.paymentMethod}
                    onChange={(event) => setQuickAddForm((current) => ({ ...current, paymentMethod: event.target.value }))}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="Cash">Cash</option>
                    <option value="PayPal">PayPal</option>
                  </select>
                )}
                <input
                  type="text"
                  value={quickAddForm.note}
                  onChange={(event) => setQuickAddForm((current) => ({ ...current, note: event.target.value }))}
                  placeholder={quickAddType === 'expense' ? 'What was it for?' : 'Customer note'}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="date"
                  value={quickAddForm.date}
                  onChange={(event) => setQuickAddForm((current) => ({ ...current, date: event.target.value }))}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="submit"
                  disabled={quickAddLoading}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {quickAddLoading ? 'Saving...' : `Save ${quickAddType === 'expense' ? 'Expense' : 'Payment'}`}
                </button>
              </form>
            </div>
          </div>
        </>
      )}
      <SiteFooter />
    </div>
  );
}
