import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowRight, BarChart3, CheckCircle2, Mail, Users, XCircle } from 'lucide-react';
import { useAuth } from '../services/AuthContext';
import { groupsAPI, settlementAPI } from '../services/api';

export default function DashboardPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [groups, setGroups] = useState([]);
  const [settlements, setSettlements] = useState({});
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [inviteActionLoading, setInviteActionLoading] = useState('');

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setError('');
      setLoading(true);

      const [groupsResult, invitationsResult] = await Promise.all([
        groupsAPI.getGroups(),
        groupsAPI.getReceivedInvitations()
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

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-600">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Shared Expenses</h1>
            <p className="text-sm text-gray-600">Welcome, {user?.name}</p>
          </div>
          <button
            onClick={handleLogout}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Logout
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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

        {invitations.length > 0 && (
          <section className="mb-8 bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center gap-2 mb-4">
              <Mail className="w-5 h-5 text-blue-600" />
              <h2 className="text-lg font-semibold text-gray-900">Group Join Requests</h2>
            </div>
            <div className="space-y-4">
              {invitations.map((invitation) => {
                const waitingForAdmin = invitation.status === 'pending_admin';
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
                        {waitingForAdmin
                          ? 'You accepted this request. Waiting for admin approval.'
                          : 'Accept this request to ask the admin to add you to the group.'}
                      </p>
                    </div>

                    {waitingForAdmin ? (
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

        {groups.length === 0 ? (
          <div className="text-center py-12">
            <BarChart3 className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">No groups yet</h2>
            <p className="text-gray-600 mb-6">Create or join a group to start tracking expenses</p>
            <button
              onClick={() => navigate('/groups/new')}
              className="inline-flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
            >
              Create Group
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <>
            <div className="mb-8">
              <button
                onClick={() => navigate('/groups/new')}
                className="inline-flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
              >
                Create New Group
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {groups.map((group) => {
                const settlement = settlements[group.id];

                return (
                  <div
                    key={group.id}
                    onClick={() => navigate(`/group/${group.id}`)}
                    className="bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow cursor-pointer"
                  >
                    <div className="p-6">
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900">{group.name}</h3>
                          <p className="text-sm text-gray-500">Admin: {group.admin_name}</p>
                        </div>
                        {user?.id === group.admin_id && (
                          <span className="inline-block px-2 py-1 bg-blue-100 text-blue-800 text-xs font-medium rounded">
                            Admin
                          </span>
                        )}
                      </div>

                      {settlement && (
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 gap-4 mb-4">
                            <div className="bg-green-50 rounded-lg p-3">
                              <p className="text-xs text-green-600 font-medium">Received</p>
                              <p className="text-lg font-bold text-green-900">EUR {settlement.totalReceived?.toFixed(2)}</p>
                            </div>
                            <div className="bg-red-50 rounded-lg p-3">
                              <p className="text-xs text-red-600 font-medium">Spent</p>
                              <p className="text-lg font-bold text-red-900">EUR {settlement.totalExpenses?.toFixed(2)}</p>
                            </div>
                          </div>

                          <div className="bg-blue-50 rounded-lg p-3">
                            <p className="text-xs text-blue-600 font-medium">Net Profit</p>
                            <p className="text-lg font-bold text-blue-900">EUR {settlement.netProfit?.toFixed(2)}</p>
                          </div>
                        </div>
                      )}

                      <div className="mt-4 pt-4 border-t border-gray-200 flex items-center gap-2 text-gray-600">
                        <Users className="w-4 h-4" />
                        <span className="text-sm">
                          {group.member_count} member{group.member_count !== 1 ? 's' : ''}
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
                        <span className="text-sm text-gray-500">Open group to add expenses and payments</span>
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
    </div>
  );
}
