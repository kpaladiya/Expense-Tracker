import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CheckCircle2, Clock3, Plus, TrendingUp, Users, XCircle } from 'lucide-react';
import { useAuth } from '../services/AuthContext';
import { expensesAPI, groupsAPI, paymentsAPI, settlementAPI } from '../services/api';

function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

function formatCurrency(value) {
  return `EUR ${Number(value || 0).toFixed(2)}`;
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
  const [memberError, setMemberError] = useState('');
  const [memberSuccess, setMemberSuccess] = useState('');
  const [reviewError, setReviewError] = useState('');
  const [reviewLoading, setReviewLoading] = useState('');
  const [expenseError, setExpenseError] = useState('');
  const [expenseLoading, setExpenseLoading] = useState(false);
  const [expenseForm, setExpenseForm] = useState({
    amount: '',
    note: '',
    expenseDate: getTodayDate()
  });
  const [paymentError, setPaymentError] = useState('');
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    paymentMethod: 'Cash',
    customerNote: '',
    paymentDate: getTodayDate()
  });

  const isAdmin = user?.id === group?.admin_id;

  useEffect(() => {
    loadGroupData();
  }, [groupId]);

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
        paymentsAPI.getGroupPayments(groupId)
      ];

      if (isAdmin || !showLoader) {
        tasks.push(groupsAPI.getMemberRequests(groupId).catch((requestError) => ({ success: false, error: requestError.message })));
      }

      const [groupResult, settlementResult, settlementHistoryResult, expensesResult, paymentsResult, memberRequestsResult] = await Promise.all(tasks);

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

      if (memberRequestsResult?.success) {
        setMemberRequests(memberRequestsResult.data);
      } else if (!showLoader) {
        setMemberRequests([]);
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
    if (group && isAdmin) {
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
  }, [group, isAdmin, groupId]);

  const refreshGroupData = async () => {
    await loadGroupData(false);
    if (isAdmin) {
      const requestsResult = await groupsAPI.getMemberRequests(groupId);
      if (requestsResult.success) {
        setMemberRequests(requestsResult.data);
      }
    }
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

  const handleAddExpense = async (event) => {
    event.preventDefault();

    if (!expenseForm.amount) {
      setExpenseError('Amount is required');
      return;
    }

    try {
      setExpenseLoading(true);
      setExpenseError('');
      const result = await expensesAPI.addExpense(groupId, expenseForm.amount, expenseForm.note, expenseForm.expenseDate);

      if (result.success) {
        setExpenseForm({
          amount: '',
          note: '',
          expenseDate: getTodayDate()
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
    try {
      setExpenseError('');
      await expensesAPI.deleteExpense(expenseId);
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

    try {
      setPaymentLoading(true);
      setPaymentError('');
      const result = await paymentsAPI.recordPayment(
        groupId,
        paymentForm.amount,
        paymentForm.paymentMethod,
        paymentForm.customerNote,
        paymentForm.paymentDate
      );

      if (result.success) {
        setPaymentForm({
          amount: '',
          paymentMethod: 'Cash',
          customerNote: '',
          paymentDate: getTodayDate()
        });
        await refreshGroupData();
      }
    } catch (err) {
      setPaymentError(err.message || 'Failed to record payment');
    } finally {
      setPaymentLoading(false);
    }
  };

  const handleDeletePayment = async (paymentId) => {
    try {
      setPaymentError('');
      await paymentsAPI.deletePayment(paymentId);
      await refreshGroupData();
    } catch (err) {
      setPaymentError(err.message || 'Failed to delete payment');
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
      <div className="min-h-screen bg-gray-50">
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
          <button
            onClick={() => navigate('/')}
            className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </button>

          <div className="flex flex-col gap-4 md:flex-row md:justify-between md:items-start">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">{group.name}</h1>
              {group.description && <p className="text-gray-600 mt-1">{group.description}</p>}
            </div>

            <div className="flex flex-wrap gap-3">
              {isAdmin && (
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

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        <div className="flex gap-4 mb-8 border-b border-gray-200 overflow-x-auto">
          {['overview', 'expenses', 'payments', 'settlement'].map((tab) => (
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
                  <p className="text-sm text-gray-600 font-medium">Per Person</p>
                  <p className="text-3xl font-bold text-purple-600 mt-2">{formatCurrency(settlement.perPersonShare)}</p>
                </div>
              </div>
            )}

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

                  {isAdmin && (
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
                        />
                        <button
                          type="submit"
                          disabled={memberLoading}
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
                        {member.id === group.admin_id && (
                          <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                            Admin
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {isAdmin && (
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
                                      disabled={reviewLoading === `${request.id}-reject`}
                                      className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                                    >
                                      <XCircle className="w-4 h-4" />
                                      Reject
                                    </button>
                                    <button
                                      onClick={() => handleReviewRequest(request.id, 'approve')}
                                      disabled={reviewLoading === `${request.id}-approve`}
                                      className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                                    >
                                      <CheckCircle2 className="w-4 h-4" />
                                      {reviewLoading === `${request.id}-approve` ? 'Approving...' : 'Approve'}
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => handleReviewRequest(request.id, 'reject')}
                                    disabled={reviewLoading === `${request.id}-reject`}
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
                  required
                />
                <input
                  type="text"
                  value={expenseForm.note}
                  onChange={(event) => setExpenseForm((current) => ({ ...current, note: event.target.value }))}
                  placeholder="What was this expense for?"
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 md:col-span-2"
                />
                <input
                  type="date"
                  value={expenseForm.expenseDate}
                  onChange={(event) => setExpenseForm((current) => ({ ...current, expenseDate: event.target.value }))}
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
                <button
                  type="submit"
                  disabled={expenseLoading}
                  className="md:col-span-4 justify-self-start px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {expenseLoading ? 'Saving...' : 'Save Expense'}
                </button>
              </form>
              {expenseError && <p className="text-sm text-red-700 mt-3">{expenseError}</p>}
            </div>

            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Expenses</h2>
                <span className="text-sm text-gray-500">{expenses.length} record{expenses.length !== 1 ? 's' : ''}</span>
              </div>

              {expenses.length === 0 ? (
                <p className="text-gray-600">No expenses recorded yet.</p>
              ) : (
                <div className="space-y-3">
                  {expenses.map((expense) => (
                    <div key={expense.id} className="flex flex-col gap-3 rounded-lg border border-gray-200 p-4 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="font-medium text-gray-900">{expense.note || 'Expense'}</p>
                        <p className="text-sm text-gray-600">{expense.user_name} • {formatDate(expense.expense_date)}</p>
                      </div>
                      <div className="flex items-center gap-4">
                        <p className="text-lg font-semibold text-red-600">{formatCurrency(expense.amount)}</p>
                        {expense.user_id === user?.id && (
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
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Record Payment</h2>
              <form onSubmit={handleAddPayment} className="grid md:grid-cols-4 gap-4">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={paymentForm.amount}
                  onChange={(event) => setPaymentForm((current) => ({ ...current, amount: event.target.value }))}
                  placeholder="Amount"
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
                <select
                  value={paymentForm.paymentMethod}
                  onChange={(event) => setPaymentForm((current) => ({ ...current, paymentMethod: event.target.value }))}
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                />
                <input
                  type="date"
                  value={paymentForm.paymentDate}
                  onChange={(event) => setPaymentForm((current) => ({ ...current, paymentDate: event.target.value }))}
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
                <button
                  type="submit"
                  disabled={paymentLoading}
                  className="md:col-span-4 justify-self-start px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {paymentLoading ? 'Saving...' : 'Save Payment'}
                </button>
              </form>
              {paymentError && <p className="text-sm text-red-700 mt-3">{paymentError}</p>}
            </div>

            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Payments</h2>
                <span className="text-sm text-gray-500">{payments.length} record{payments.length !== 1 ? 's' : ''}</span>
              </div>

              {payments.length === 0 ? (
                <p className="text-gray-600">No payments recorded yet.</p>
              ) : (
                <div className="space-y-3">
                  {payments.map((payment) => (
                    <div key={payment.id} className="flex flex-col gap-3 rounded-lg border border-gray-200 p-4 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="font-medium text-gray-900">{payment.customer_note || 'Customer payment'}</p>
                        <p className="text-sm text-gray-600">
                          {payment.user_name} • {payment.payment_method} • {formatDate(payment.payment_date)}
                        </p>
                      </div>
                      <div className="flex items-center gap-4">
                        <p className="text-lg font-semibold text-green-600">{formatCurrency(payment.amount)}</p>
                        {payment.user_id === user?.id && (
                          <button
                            onClick={() => handleDeletePayment(payment.id)}
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

        {activeTab === 'settlement' && settlement && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <TrendingUp className="w-5 h-5" />
                Settlement Summary
              </h2>

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
            </div>

            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Monthly Settlement History</h2>

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
                        </div>
                        <div className="text-sm font-medium text-purple-700 bg-purple-50 px-3 py-2 rounded-lg">
                          Per Person: {formatCurrency(monthlySettlement.perPersonShare)}
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
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
