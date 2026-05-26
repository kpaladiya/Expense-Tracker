import React, { useEffect, useMemo, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import {
  authAPI,
  activityAPI,
  expensesAPI,
  getApiBaseUrl,
  getApiUrl,
  groupsAPI,
  inboxAPI,
  paymentsAPI,
  recurringAPI,
  reportsAPI,
  settlementAPI,
  supportAPI,
  undoAPI
} from './src/services/api';
import { capitalizeWords, formatCurrency, formatDate, formatDateTime, formatMonth, getTodayDate } from './src/utils/format';

const QUICK_CURRENCIES = ['EUR', 'USD', 'GBP', 'INR', 'CAD', 'AUD'];
const PAYMENT_METHODS = ['Cash', 'PayPal'];
const TABS = [
  { key: 'dashboard', label: 'Dashboard', icon: 'grid-outline', activeIcon: 'grid' },
  { key: 'notifications', label: 'Notifications', icon: 'notifications-outline', activeIcon: 'notifications' },
  { key: 'support', label: 'Support', icon: 'help-circle-outline', activeIcon: 'help-circle' },
  { key: 'profile', label: 'Profile', icon: 'person-outline', activeIcon: 'person' }
];
const DEMO_CREDENTIALS = {
  email: 'demo@sharedexpenses.local',
  password: 'demo1234'
};
const SUPPORT_TERMS_SECTIONS = [
  'Use Shared Expenses only for genuine personal, household, or team expense tracking.',
  'Keep your account credentials safe and report suspicious activity quickly.',
  'Enter correct amounts, dates, and notes so balances stay accurate.',
  'Do not abuse members or post unlawful content in groups.',
  'Features may evolve; continued use means you accept current policies.'
];
const SUPPORT_PRIVACY_SECTIONS = [
  'We store account details, groups, expenses, payments, and settlements.',
  'Data is used to calculate balances, show activity, and send key notifications.',
  'Group members can view shared group activity relevant to that group.',
  'Transactional emails use the address saved on your account.',
  'Contact support for account-data or stored-feedback requests.'
];
const SUPPORT_FAQS = [
  {
    question: 'How do I create a group?',
    answer: 'Open Dashboard, tap Create group, add a name, then save.'
  },
  {
    question: 'How do I invite members?',
    answer: 'Open a group, go to members, and invite with a registered email.'
  },
  {
    question: 'What is the difference between expenses and payments?',
    answer: 'Expenses track money spent for the group. Payments track money received.'
  },
  {
    question: 'When should I use Settle Up?',
    answer: 'Use it after all monthly payments are recorded. Closed months cannot be edited.'
  },
  {
    question: 'Why did I get an email notification?',
    answer: 'Emails are sent for key account, expense, payment, and settlement updates.'
  }
];
const SUPPORT_FEEDBACK_CATEGORIES = ['general', 'feature', 'bug', 'help'];

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <RootApp />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

function RootApp() {
  const { user, loading } = useAuth();

  if (loading) {
    return <LoadingScreen label="Opening Shared Expenses..." />;
  }

  if (!user) {
    return <AuthScreen />;
  }

  return <MainApp />;
}

function MainApp() {
  const { user, logout, refreshUser } = useAuth();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [selectedGroupId, setSelectedGroupId] = useState(null);

  if (selectedGroupId) {
    return (
      <GroupDetailScreen
        groupId={selectedGroupId}
        onBack={() => setSelectedGroupId(null)}
        onOpenNotifications={() => setActiveTab('notifications')}
      />
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.appShell}>
        {activeTab === 'dashboard' && (
          <DashboardScreen
            user={user}
            onOpenGroup={setSelectedGroupId}
            onOpenNotifications={() => setActiveTab('notifications')}
            onUserRefreshed={refreshUser}
          />
        )}
        {activeTab === 'notifications' && (
          <NotificationsScreen onOpenGroup={setSelectedGroupId} />
        )}
        {activeTab === 'support' && <SupportScreen />}
        {activeTab === 'profile' && (
          <ProfileScreen onLogout={logout} onUserRefreshed={refreshUser} />
        )}
        <BottomTabs activeTab={activeTab} onChange={setActiveTab} />
      </View>
    </SafeAreaView>
  );
}

function AuthScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [activationToken, setActivationToken] = useState('');
  const [activationMessage, setActivationMessage] = useState('');
  const [activationError, setActivationError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [activationLoading, setActivationLoading] = useState(false);

  const authenticate = async (loginEmail, loginPassword) => {
    try {
      setLoading(true);
      await login(loginEmail.trim(), loginPassword);
    } catch (error) {
      Alert.alert('Login failed', error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLoginPress = async () => {
    if (!email.trim() || !password) {
      Alert.alert('Missing details', 'Enter your email and password to sign in.');
      return;
    }

    await authenticate(email, password);
  };

  const handleDemoLoginPress = async () => {
    setEmail(DEMO_CREDENTIALS.email);
    setPassword(DEMO_CREDENTIALS.password);
    await authenticate(DEMO_CREDENTIALS.email, DEMO_CREDENTIALS.password);
  };

  const handleGoogleStartPress = async () => {
    const googleStartUrl = `${getApiBaseUrl()}/api/auth/mobile/google/start`;

    try {
      setGoogleLoading(true);
      await Linking.openURL(googleStartUrl);
      Alert.alert(
        'Continue Google sign-in',
        'Finish sign-in in the opened browser tab. If the browser shows a token, paste it into this app after the flow completes.'
      );
    } catch {
      Alert.alert('Unable to open browser', `Open this URL manually to continue Google sign-in:\n${googleStartUrl}`);
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleActivateEmailPress = async () => {
    if (!activationToken.trim()) {
      setActivationMessage('');
      setActivationError('Enter your activation token first.');
      return;
    }

    try {
      setActivationLoading(true);
      setActivationMessage('');
      setActivationError('');
      const result = await authAPI.activateEmail(activationToken.trim());
      setActivationMessage(result.message || 'Email activated successfully. You can sign in now.');
    } catch (error) {
      setActivationError(error.message || 'Activation failed. Check the token and try again.');
    } finally {
      setActivationLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.authContainer}
      >
        <ScrollView contentContainerStyle={styles.authScroll} keyboardShouldPersistTaps="handled">
          <View style={styles.heroCard}>
            <Text style={styles.heroTitle}>Shared Expenses</Text>
            <Text style={styles.heroSubtitle}>
              Keep your current web app exactly as it is and use this mobile app in parallel for iPhone-first daily tracking.
            </Text>
            <Text style={styles.heroHint}>
              API: {getApiUrl()}
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Sign in</Text>
            <Text style={styles.helperText}>
              Sign in with your existing Shared Expenses email and password.
            </Text>

            <Text style={styles.fieldLabel}>Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="you@example.com"
              placeholderTextColor="#9CA3AF"
              style={styles.input}
            />

            <Text style={styles.fieldLabel}>Password</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="••••••••"
              placeholderTextColor="#9CA3AF"
              style={styles.input}
            />

            <PrimaryButton
              label={loading ? 'Signing in...' : 'Sign in'}
              onPress={handleLoginPress}
              disabled={loading}
            />
            <SecondaryButton
              label={loading ? 'Signing in with demo user...' : 'Use demo user'}
              onPress={handleDemoLoginPress}
              disabled={loading}
            />
            <SecondaryButton
              label={googleLoading ? 'Opening Google sign-in...' : 'Continue with Google in browser'}
              onPress={handleGoogleStartPress}
              disabled={loading || googleLoading || activationLoading}
            />
            <Text style={styles.helperText}>
              Demo user: {DEMO_CREDENTIALS.email} / {DEMO_CREDENTIALS.password}
            </Text>
            <Text style={styles.helperText}>
              Google entry point opens: {`${getApiBaseUrl()}/api/auth/mobile/google/start`}
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Activate account</Text>
            <Text style={styles.helperText}>
              Paste the activation token from your email or activation page, then activate your account.
            </Text>

            <Text style={styles.fieldLabel}>Activation token</Text>
            <TextInput
              value={activationToken}
              onChangeText={setActivationToken}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Paste activation token"
              placeholderTextColor="#9CA3AF"
              style={styles.input}
            />
            <PrimaryButton
              label={activationLoading ? 'Activating account...' : 'Activate account'}
              onPress={handleActivateEmailPress}
              disabled={loading || googleLoading || activationLoading}
            />
            {!!activationMessage && <Text style={styles.successText}>{activationMessage}</Text>}
            {!!activationError && <Text style={styles.errorText}>{activationError}</Text>}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function DashboardScreen({ user, onOpenGroup, onOpenNotifications, onUserRefreshed }) {
  const [groups, setGroups] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [pendingDeleteApprovals, setPendingDeleteApprovals] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [undoAction, setUndoAction] = useState(null);
  const [personalSummary, setPersonalSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [createGroupVisible, setCreateGroupVisible] = useState(false);
  const [entryModal, setEntryModal] = useState({ visible: false, type: 'expense', groupId: '' });
  const [sampleLoading, setSampleLoading] = useState(false);

  const unreadPreview = useMemo(
    () => notifications.filter((item) => !item.isRead).slice(0, 3),
    [notifications]
  );

  const loadData = async (showLoader = true) => {
    try {
      if (showLoader) {
        setLoading(true);
      }

      const [groupsResult, invitationsResult, deleteApprovalsResult, notificationsResult, summaryResult, undoResult] = await Promise.all([
        groupsAPI.getGroups(),
        groupsAPI.getReceivedInvitations().catch(() => ({ success: false, data: [] })),
        groupsAPI.getPendingDeleteApprovals().catch(() => ({ success: false, data: [] })),
        inboxAPI.getNotifications({ limit: 200 }).catch(() => ({ success: false, data: { notifications: [], unreadCount: 0 } })),
        groupsAPI.getPersonalSummary().catch(() => ({ success: false })),
        undoAPI.getLatest().catch(() => ({ success: false, data: null }))
      ]);

      if (groupsResult.success) {
        setGroups(groupsResult.data);
      }

      if (invitationsResult.success) {
        setInvitations(invitationsResult.data || []);
      }

      if (deleteApprovalsResult.success) {
        setPendingDeleteApprovals(deleteApprovalsResult.data || []);
      }

      if (summaryResult.success) {
        setPersonalSummary(summaryResult.data || null);
      }

      if (notificationsResult.success) {
        setNotifications(notificationsResult.data.notifications);
        setUnreadCount(notificationsResult.data.unreadCount);
      }

      if (undoResult.success) {
        setUndoAction(undoResult.data || null);
      }
    } catch (error) {
      Alert.alert('Dashboard error', error.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateSample = async () => {
    try {
      setSampleLoading(true);
      const result = await groupsAPI.createSampleGroup();
      await onUserRefreshed();
      await loadData(false);
      Alert.alert('Sample ready', result.message || 'Sample example created successfully.');
      onOpenGroup(result.data.id);
    } catch (error) {
      Alert.alert('Sample group failed', error.message);
    } finally {
      setSampleLoading(false);
    }
  };

  const handleQuickAdd = (type, groupId = '') => {
    setEntryModal({
      visible: true,
      type,
      groupId: groupId || groups[0]?.id || ''
    });
  };

  const handleInvitationAction = async (requestId, action) => {
    try {
      await groupsAPI.respondToInvitation(requestId, action);
      await loadData(false);
      Alert.alert('Invitation updated', action === 'accept' ? 'Invitation accepted.' : 'Invitation declined.');
    } catch (error) {
      Alert.alert('Invitation action failed', error.message);
    }
  };

  const handleApproveDeletion = async (groupId) => {
    try {
      await groupsAPI.approveDeleteGroup(groupId);
      await loadData(false);
      Alert.alert('Approval recorded', 'Delete request approval has been saved.');
    } catch (error) {
      Alert.alert('Approval failed', error.message);
    }
  };

  const handleUndo = async () => {
    if (!undoAction?.id) {
      return;
    }

    try {
      await undoAPI.undo(undoAction.id);
      await loadData(false);
      Alert.alert('Action reverted', 'The latest action was undone.');
    } catch (error) {
      Alert.alert('Undo failed', error.message);
    }
  };

  if (loading) {
    return <LoadingScreen label="Loading dashboard..." />;
  }

  return (
    <>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.screenContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadData(false); }} />}
      >
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.screenTitle}>Hello, {user.name}</Text>
            <Text style={styles.screenSubtitle}>Your iPhone companion app is running in parallel with the web version.</Text>
          </View>
          <Pressable style={styles.bellButton} onPress={onOpenNotifications}>
            <Ionicons name="notifications-outline" size={18} color="#0f172a" />
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{unreadCount}</Text>
            </View>
          </Pressable>
        </View>

        {getApiUrl().includes('localhost') && (
          <View style={styles.warningBanner}>
            <Text style={styles.warningTitle}>iPhone setup reminder</Text>
            <Text style={styles.warningText}>
              Before testing on a real iPhone, set EXPO_PUBLIC_API_URL to your backend LAN address instead of localhost.
            </Text>
          </View>
        )}

        {personalSummary && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Across all groups</Text>
            <View style={styles.statRow}>
              <StatCard label="You get" value={personalSummary.getsTotal} currency={personalSummary.groups?.[0]?.currency || 'EUR'} tone="success" />
              <StatCard label="You owe" value={personalSummary.owesTotal} currency={personalSummary.groups?.[0]?.currency || 'EUR'} tone="danger" />
            </View>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Quick actions</Text>
          <View style={styles.buttonGrid}>
            <SecondaryButton label="Create group" onPress={() => setCreateGroupVisible(true)} />
            <SecondaryButton label={sampleLoading ? 'Creating sample...' : 'Sample example'} onPress={handleCreateSample} disabled={sampleLoading} />
            <SecondaryButton label="Quick expense" onPress={() => handleQuickAdd('expense')} disabled={groups.length === 0} />
            <SecondaryButton label="Quick payment" onPress={() => handleQuickAdd('payment')} disabled={groups.length === 0} />
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Invitations</Text>
            {invitations.length === 0 ? (
              <Text style={styles.mutedText}>No pending invitations.</Text>
            ) : (
              invitations.map((invite) => (
                <View key={invite.id} style={styles.groupCard}>
                  <Text style={styles.groupTitle}>{invite.group_name || 'Group invitation'}</Text>
                  <Text style={styles.metaText}>Invited by {invite.invited_by_name || invite.invited_by_email || 'a member'}</Text>
                  <View style={styles.groupActions}>
                    <SecondaryButton label="Accept" onPress={() => handleInvitationAction(invite.id, 'accept')} />
                    <SecondaryButton label="Decline" onPress={() => handleInvitationAction(invite.id, 'decline')} />
                  </View>
                </View>
              ))
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Pending delete approvals</Text>
            {pendingDeleteApprovals.length === 0 ? (
              <Text style={styles.mutedText}>No group deletion requests need your approval.</Text>
            ) : (
              pendingDeleteApprovals.map((item) => (
                <View key={item.group_id || item.groupId} style={styles.groupCard}>
                  <Text style={styles.groupTitle}>{item.group_name || item.groupName || 'Group'}</Text>
                  <Text style={styles.metaText}>
                    Requested by {item.requested_by_name || item.requestedByName || 'group admin'}
                  </Text>
                  <SecondaryButton
                    label="Approve delete"
                    onPress={() => handleApproveDeletion(item.group_id || item.groupId)}
                  />
                </View>
              ))
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Undo</Text>
            {!undoAction ? (
              <Text style={styles.mutedText}>No undo actions available right now.</Text>
            ) : (
              <>
                <Text style={styles.groupTitle}>{capitalizeWords(undoAction.action_type || undoAction.actionType || 'latest action')}</Text>
                <Text style={styles.metaText}>
                  {undoAction.entity_type || undoAction.entityType || 'record'} • expires {formatDateTime(undoAction.expires_at || undoAction.expiresAt)}
                </Text>
                <SecondaryButton label="Undo latest action" onPress={handleUndo} />
              </>
            )}
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <Text style={styles.cardTitle}>Unread notifications</Text>
            <Pressable onPress={onOpenNotifications}>
              <Text style={styles.linkText}>Open all</Text>
            </Pressable>
          </View>
          {unreadPreview.length === 0 ? (
            <Text style={styles.mutedText}>No unread notifications.</Text>
          ) : (
            unreadPreview.map((notification) => (
              <Pressable key={notification.id} style={styles.notificationPreview} onPress={onOpenNotifications}>
                <Text style={styles.notificationTitle}>{notification.title}</Text>
                <Text style={styles.notificationMessage}>{notification.message}</Text>
                <Text style={styles.metaText}>
                  {notification.group_name ? `${notification.group_name} • ` : ''}
                  {formatDateTime(notification.created_at)}
                </Text>
              </Pressable>
            ))
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Groups</Text>
          {groups.length === 0 ? (
            <Text style={styles.mutedText}>Create a real group or sample example to start using the mobile app.</Text>
          ) : (
            groups.map((group) => (
              <Pressable key={group.id} style={styles.groupCard} onPress={() => onOpenGroup(group.id)}>
                <View style={styles.sectionHeader}>
                  <View>
                    <Text style={styles.groupTitle}>{group.name}</Text>
                    <Text style={styles.metaText}>
                      {group.member_count} members • {group.currency}
                    </Text>
                  </View>
                  <View style={[styles.rolePill, group.is_disabled ? styles.rolePillMuted : null]}>
                    <Text style={styles.rolePillText}>
                      {group.is_disabled ? 'Disabled' : capitalizeWords(group.current_user_role || 'member')}
                    </Text>
                  </View>
                </View>
                {group.description ? <Text style={styles.groupDescription}>{group.description}</Text> : null}
                <View style={styles.groupActions}>
                  <SecondaryButton label="Open group" onPress={() => onOpenGroup(group.id)} />
                  {!group.is_disabled ? (
                    <SecondaryButton label="Add payment" onPress={() => handleQuickAdd('payment', group.id)} />
                  ) : null}
                </View>
              </Pressable>
            ))
          )}
        </View>
      </ScrollView>

      <CreateGroupModal
        visible={createGroupVisible}
        onClose={() => setCreateGroupVisible(false)}
        onCreated={async (newGroupId) => {
          setCreateGroupVisible(false);
          await loadData(false);
          onOpenGroup(newGroupId);
        }}
      />

      <EntryModal
        visible={Boolean(entryModal.visible)}
        type={entryModal.type}
        mode="create"
        entryId=""
        initialValues={null}
        groups={groups.filter((group) => !group.is_disabled)}
        defaultGroupId={entryModal.groupId}
        onClose={() => setEntryModal((current) => ({ ...current, visible: false }))}
        onSaved={async () => {
          setEntryModal((current) => ({ ...current, visible: false }));
          await loadData(false);
        }}
      />
    </>
  );
}

function NotificationsScreen({ onOpenGroup }) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = async () => {
    try {
      const result = await inboxAPI.getNotifications({ limit: 200 });
      if (result.success) {
        setNotifications(result.data.notifications);
        setUnreadCount(result.data.unreadCount);
      }
    } catch (error) {
      Alert.alert('Notifications error', error.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const markRead = async (notification) => {
    try {
      if (!notification.isRead) {
        const result = await inboxAPI.markRead(notification.id);
        setUnreadCount(result.data.unreadCount);
        setNotifications((current) =>
          current.map((item) => (item.id === notification.id ? { ...item, isRead: true } : item))
        );
      }

      const groupMatch = notification.actionUrl?.match(/^\/group\/(.+)$/);
      if (groupMatch) {
        onOpenGroup(groupMatch[1]);
      }
    } catch (error) {
      Alert.alert('Notification error', error.message);
    }
  };

  const markAllRead = async () => {
    try {
      await inboxAPI.markAllRead();
      setUnreadCount(0);
      setNotifications((current) => current.map((item) => ({ ...item, isRead: true })));
    } catch (error) {
      Alert.alert('Notification error', error.message);
    }
  };

  if (loading) {
    return <LoadingScreen label="Loading notifications..." />;
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.screenContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadData(); }} />}
    >
      <View style={styles.card}>
        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.cardTitle}>Notifications</Text>
            <Text style={styles.metaText}>{unreadCount} unread</Text>
          </View>
          <Pressable onPress={markAllRead} disabled={unreadCount === 0}>
            <Text style={[styles.linkText, unreadCount === 0 && styles.disabledText]}>Mark all as read</Text>
          </Pressable>
        </View>
        {notifications.length === 0 ? (
          <Text style={styles.mutedText}>No notifications yet.</Text>
        ) : (
          notifications.map((notification) => (
            <Pressable
              key={notification.id}
              style={[styles.notificationItem, notification.isRead ? styles.notificationRead : styles.notificationUnread]}
              onPress={() => markRead(notification)}
            >
              <Text style={styles.notificationTitle}>{notification.title}</Text>
              <Text style={styles.notificationMessage}>{notification.message}</Text>
              <Text style={styles.metaText}>
                {notification.group_name ? `${notification.group_name} • ` : ''}
                {formatDateTime(notification.created_at)}
              </Text>
              <Text style={styles.linkText}>Open</Text>
            </Pressable>
          ))
        )}
      </View>
    </ScrollView>
  );
}

function ProfileScreen({ onLogout, onUserRefreshed }) {
  const { user, updateProfile } = useAuth();
  const [name, setName] = useState(user.name || '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (password && password !== confirmPassword) {
      Alert.alert('Password mismatch', 'Password and confirm password must match.');
      return;
    }

    try {
      setSaving(true);
      const payload = { name: name.trim() };
      if (password) {
        payload.password = password;
      }
      await updateProfile(payload);
      setPassword('');
      setConfirmPassword('');
      await onUserRefreshed();
      Alert.alert('Profile updated', 'Your profile details were saved.');
    } catch (error) {
      Alert.alert('Profile error', error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Profile</Text>
        <Field label="Name" value={name} onChangeText={setName} placeholder="Your name" />
        <Field label="Email" value={user.email} editable={false} />
        <Field
          label="New password"
          value={password}
          onChangeText={setPassword}
          placeholder="Leave empty to keep unchanged"
          secureTextEntry
        />
        <Field
          label="Confirm password"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          placeholder="Repeat your password"
          secureTextEntry
        />
        <PrimaryButton label={saving ? 'Saving...' : 'Save profile'} onPress={handleSave} disabled={saving} />
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>iPhone launch checklist</Text>
        <Text style={styles.checklistItem}>• Keep the web app running exactly as it is.</Text>
        <Text style={styles.checklistItem}>• Point EXPO_PUBLIC_API_URL to your backend LAN URL for device testing.</Text>
        <Text style={styles.checklistItem}>• Start with this shared codebase and ship iOS first.</Text>
      </View>
      <View style={styles.card}>
        <PrimaryButton label="Logout" onPress={onLogout} tone="secondary" />
      </View>
    </ScrollView>
  );
}

function SupportScreen() {
  const { user } = useAuth();
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [category, setCategory] = useState('general');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [openSections, setOpenSections] = useState({
    terms: false,
    privacy: false,
    help: true,
    feedback: true
  });
  const [openFaq, setOpenFaq] = useState(0);
  const [sending, setSending] = useState(false);

  const toggleSection = (sectionKey) => {
    setOpenSections((current) => ({
      ...current,
      [sectionKey]: !current[sectionKey]
    }));
  };

  const handleSubmit = async () => {
    if (!name.trim() || !email.trim() || !subject.trim() || !message.trim()) {
      Alert.alert('Missing details', 'Add your name, email, subject, and message first.');
      return;
    }

    if (!email.includes('@')) {
      Alert.alert('Invalid email', 'Enter a valid email address.');
      return;
    }

    if (!termsAccepted) {
      Alert.alert('Consent required', 'Please confirm terms acceptance before sending feedback.');
      return;
    }

    try {
      setSending(true);
      const result = await supportAPI.submitFeedback({
        name: name.trim(),
        email: email.trim(),
        category,
        subject: subject.trim(),
        message: message.trim(),
        termsAccepted: true
      });
      setSubject('');
      setMessage('');
      setTermsAccepted(false);
      Alert.alert('Feedback sent', `${result.message || 'Thanks for your feedback.'} Ticket: ${result.data?.ticketNumber || 'N/A'}`);
    } catch (error) {
      Alert.alert('Feedback failed', error.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Support Center</Text>
        <Text style={styles.helperText}>Find policy details, quick answers, and send feedback from one place.</Text>
      </View>

      <View style={styles.card}>
        <Pressable style={styles.supportSectionHeader} onPress={() => toggleSection('terms')}>
          <Text style={styles.cardTitle}>Terms & Conditions</Text>
          <Text style={styles.linkText}>{openSections.terms ? 'Hide' : 'Show'}</Text>
        </Pressable>
        {openSections.terms &&
          SUPPORT_TERMS_SECTIONS.map((item) => (
            <Text key={item} style={styles.checklistItem}>
              • {item}
            </Text>
          ))}
      </View>

      <View style={styles.card}>
        <Pressable style={styles.supportSectionHeader} onPress={() => toggleSection('privacy')}>
          <Text style={styles.cardTitle}>Privacy Policy</Text>
          <Text style={styles.linkText}>{openSections.privacy ? 'Hide' : 'Show'}</Text>
        </Pressable>
        {openSections.privacy &&
          SUPPORT_PRIVACY_SECTIONS.map((item) => (
            <Text key={item} style={styles.checklistItem}>
              • {item}
            </Text>
          ))}
      </View>

      <View style={styles.card}>
        <Pressable style={styles.supportSectionHeader} onPress={() => toggleSection('help')}>
          <Text style={styles.cardTitle}>Help / FAQ</Text>
          <Text style={styles.linkText}>{openSections.help ? 'Hide' : 'Show'}</Text>
        </Pressable>
        {openSections.help &&
          SUPPORT_FAQS.map((faq, index) => {
            const isOpen = openFaq === index;
            return (
              <View key={faq.question} style={styles.faqItem}>
                <Pressable style={styles.supportSectionHeader} onPress={() => setOpenFaq(isOpen ? -1 : index)}>
                  <Text style={styles.faqQuestion}>{faq.question}</Text>
                  <Text style={styles.linkText}>{isOpen ? '−' : '+'}</Text>
                </Pressable>
                {isOpen ? <Text style={styles.helperText}>{faq.answer}</Text> : null}
              </View>
            );
          })}
      </View>

      <View style={styles.card}>
        <Pressable style={styles.supportSectionHeader} onPress={() => toggleSection('feedback')}>
          <Text style={styles.cardTitle}>Feedback</Text>
          <Text style={styles.linkText}>{openSections.feedback ? 'Hide' : 'Show'}</Text>
        </Pressable>
        {openSections.feedback && (
          <>
            <Text style={styles.fieldLabel}>Category</Text>
            <View style={styles.chipWrap}>
              {SUPPORT_FEEDBACK_CATEGORIES.map((item) => (
                <Pressable
                  key={item}
                  onPress={() => setCategory(item)}
                  style={[styles.chip, category === item && styles.chipActive]}
                >
                  <Text style={[styles.chipLabel, category === item && styles.chipLabelActive]}>{capitalizeWords(item)}</Text>
                </Pressable>
              ))}
            </View>
            <Field label="Name" value={name} onChangeText={setName} placeholder="Your name" />
            <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" />
            <Field label="Subject" value={subject} onChangeText={setSubject} placeholder="Short summary" />
            <Field
              label="Message"
              value={message}
              onChangeText={setMessage}
              placeholder="Describe your issue, request, or idea"
              multiline
            />
            <Pressable style={styles.checkboxRow} onPress={() => setTermsAccepted((current) => !current)}>
              <View style={[styles.checkbox, termsAccepted && styles.checkboxActive]}>
                {termsAccepted ? <Text style={styles.checkboxTick}>✓</Text> : null}
              </View>
              <Text style={styles.helperText}>I agree to the Terms & Conditions and allow storing this feedback for review.</Text>
            </Pressable>
            <PrimaryButton label={sending ? 'Sending...' : 'Submit feedback'} onPress={handleSubmit} disabled={sending} />
          </>
        )}
      </View>
    </ScrollView>
  );
}

function GroupDetailScreen({ groupId, onBack, onOpenNotifications }) {
  const [group, setGroup] = useState(null);
  const [settlement, setSettlement] = useState(null);
  const [history, setHistory] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [payments, setPayments] = useState([]);
  const [activity, setActivity] = useState([]);
  const [memberRequests, setMemberRequests] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [pendingDeleteRequest, setPendingDeleteRequest] = useState(null);
  const [summaryMonth, setSummaryMonth] = useState(getTodayDate().slice(0, 7));
  const [summary, setSummary] = useState(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [groupCurrency, setGroupCurrency] = useState('EUR');
  const [templateTitle, setTemplateTitle] = useState('');
  const [templateAmount, setTemplateAmount] = useState('');
  const [templateType, setTemplateType] = useState('expense');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [entryModal, setEntryModal] = useState({
    visible: false,
    type: 'expense',
    mode: 'create',
    entryId: '',
    initialValues: null
  });
  const [settlingMonth, setSettlingMonth] = useState('');

  const loadGroup = async () => {
    try {
      const [groupResult, settlementResult, historyResult, expensesResult, paymentsResult, activityResult, templateResult, memberRequestResult] = await Promise.all([
        groupsAPI.getGroup(groupId),
        settlementAPI.getSettlement(groupId),
        settlementAPI.getSettlementHistory(groupId),
        expensesAPI.getGroupExpenses(groupId),
        paymentsAPI.getGroupPayments(groupId),
        activityAPI.getGroupActivity(groupId).catch(() => ({ success: false, data: [] })),
        recurringAPI.getTemplates(groupId).catch(() => ({ success: false, data: [] })),
        groupsAPI.getMemberRequests(groupId).catch(() => ({ success: false, data: [] }))
      ]);

      if (groupResult.success) {
        setGroup(groupResult.data);
        setGroupName(groupResult.data.name || '');
        setGroupDescription(groupResult.data.description || '');
        setGroupCurrency(groupResult.data.currency || 'EUR');
      }

      if (settlementResult.success) {
        setSettlement(settlementResult.data);
      }

      if (historyResult.success) {
        setHistory(historyResult.data);
      }

      if (expensesResult.success) {
        setExpenses(expensesResult.data);
      }

      if (paymentsResult.success) {
        setPayments(paymentsResult.data);
      }

      if (activityResult.success) {
        setActivity(activityResult.data || []);
      }

      if (templateResult.success) {
        setTemplates(templateResult.data || []);
      }

      if (memberRequestResult.success) {
        setMemberRequests(memberRequestResult.data || []);
      }

      const pendingRequest = (groupResult.data?.deleteApprovals || []).find((item) => !item.approvedAt);
      setPendingDeleteRequest(pendingRequest || null);
    } catch (error) {
      Alert.alert('Group error', error.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadGroup();
  }, [groupId]);

  const handleSettle = async (month) => {
    try {
      setSettlingMonth(month);
      const result = await settlementAPI.settleMonth(groupId, month);
      Alert.alert('Month settled', result.warning || result.message || 'Settlement completed.');
      await loadGroup();
    } catch (error) {
      Alert.alert('Settle up unavailable', error.message);
    } finally {
      setSettlingMonth('');
    }
  };

  const handleUpdateGroup = async () => {
    if (!groupName.trim()) {
      Alert.alert('Group name required', 'Enter a group name.');
      return;
    }

    try {
      await groupsAPI.updateGroup(groupId, groupName.trim(), groupDescription.trim(), groupCurrency.trim().toUpperCase());
      await loadGroup();
      Alert.alert('Group updated', 'Group details were saved.');
    } catch (error) {
      Alert.alert('Update failed', error.message);
    }
  };

  const handleInviteMember = async () => {
    if (!inviteEmail.trim()) {
      Alert.alert('Email required', 'Enter the member email first.');
      return;
    }

    try {
      await groupsAPI.addMember(groupId, inviteEmail.trim());
      setInviteEmail('');
      await loadGroup();
      Alert.alert('Invite sent', 'Invitation has been sent to the member.');
    } catch (error) {
      Alert.alert('Invite failed', error.message);
    }
  };

  const handleMemberRequest = async (requestId, action) => {
    try {
      await groupsAPI.reviewMemberRequest(groupId, requestId, action);
      await loadGroup();
      Alert.alert('Request updated', `Member request ${action}d.`);
    } catch (error) {
      Alert.alert('Review failed', error.message);
    }
  };

  const handleUpdateMemberRole = async (member) => {
    const nextRole = member.role === 'manager' ? 'member' : 'manager';

    try {
      await groupsAPI.updateMemberRole(groupId, member.id, nextRole);
      await loadGroup();
      Alert.alert('Role updated', `${member.name} is now ${capitalizeWords(nextRole)}.`);
    } catch (error) {
      Alert.alert('Role update failed', error.message);
    }
  };

  const handleRemoveMember = async (member) => {
    try {
      await groupsAPI.removeMember(groupId, member.id, 'Removed from mobile app');
      await loadGroup();
      Alert.alert('Member removed', `${member.name} was removed from the group.`);
    } catch (error) {
      Alert.alert('Remove failed', error.message);
    }
  };

  const handleCreateTemplate = async () => {
    if (!templateTitle.trim() || !templateAmount) {
      Alert.alert('Missing details', 'Template title and amount are required.');
      return;
    }

    try {
      await recurringAPI.createTemplate(groupId, {
        entryType: templateType,
        title: templateTitle.trim(),
        amount: Number(templateAmount),
        frequency: 'monthly',
        dayOfMonth: 1
      });
      setTemplateTitle('');
      setTemplateAmount('');
      await loadGroup();
      Alert.alert('Template created', 'Recurring template saved.');
    } catch (error) {
      Alert.alert('Template failed', error.message);
    }
  };

  const handleUseTemplate = async (templateId) => {
    try {
      await recurringAPI.useTemplate(groupId, templateId, getTodayDate());
      await loadGroup();
      Alert.alert('Template used', 'Entry created from recurring template.');
    } catch (error) {
      Alert.alert('Template use failed', error.message);
    }
  };

  const handleDeleteTemplate = async (templateId) => {
    try {
      await recurringAPI.deleteTemplate(groupId, templateId);
      await loadGroup();
      Alert.alert('Template removed', 'Recurring template deleted.');
    } catch (error) {
      Alert.alert('Delete failed', error.message);
    }
  };

  const handleLoadSummary = async () => {
    if (!summaryMonth) {
      Alert.alert('Month required', 'Enter a month (YYYY-MM).');
      return;
    }

    try {
      const result = await reportsAPI.getMonthlySummary(groupId, summaryMonth);
      setSummary(result.data || null);
    } catch (error) {
      Alert.alert('Report failed', error.message);
    }
  };

  const handleExportSummary = async (format) => {
    if (!summaryMonth) {
      Alert.alert('Month required', 'Enter a month (YYYY-MM) before exporting.');
      return;
    }

    if (!summary) {
      Alert.alert('Load summary first', 'Load the monthly summary before exporting.');
      return;
    }

    try {
      const response = format === 'csv'
        ? await reportsAPI.downloadMonthlySummaryCsv(groupId, summaryMonth)
        : await reportsAPI.downloadMonthlySummaryPdf(groupId, summaryMonth);

      const canSaveOnWeb = Platform.OS === 'web'
        && Boolean(response.blob)
        && typeof document !== 'undefined'
        && typeof URL !== 'undefined'
        && typeof URL.createObjectURL === 'function';

      if (canSaveOnWeb) {
        const blobUrl = URL.createObjectURL(response.blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = response.filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(blobUrl);
        return;
      }

      Alert.alert(
        'Manual export needed',
        `This app build cannot save files directly.\n\nPlease export "${response.filename}" from the web app Monthly Summary screen.`
      );
    } catch (error) {
      Alert.alert('Export failed', error.message || 'Failed to export monthly report.');
    }
  };

  const handleRequestDelete = async () => {
    try {
      await groupsAPI.requestDeleteGroup(groupId);
      await loadGroup();
      Alert.alert('Delete requested', 'Group delete request has been created.');
    } catch (error) {
      Alert.alert('Request failed', error.message);
    }
  };

  const handleApproveDelete = async () => {
    try {
      await groupsAPI.approveDeleteGroup(groupId);
      await loadGroup();
      Alert.alert('Delete approved', 'Your approval has been recorded.');
    } catch (error) {
      Alert.alert('Approval failed', error.message);
    }
  };

  const handleDeleteExpense = async (expenseId) => {
    try {
      await expensesAPI.deleteExpense(expenseId);
      await loadGroup();
      Alert.alert('Expense deleted', 'The expense was removed.');
    } catch (error) {
      Alert.alert('Delete failed', error.message);
    }
  };

  const handleDeletePayment = async (paymentId) => {
    try {
      await paymentsAPI.deletePayment(paymentId);
      await loadGroup();
      Alert.alert('Payment deleted', 'The payment was removed.');
    } catch (error) {
      Alert.alert('Delete failed', error.message);
    }
  };

  const handleEditExpense = (expense) => {
    setEntryModal({
      visible: true,
      type: 'expense',
      mode: 'edit',
      entryId: expense.id,
      initialValues: {
        amount: expense.amount?.toString() || '',
        note: expense.note || '',
        date: expense.expense_date || getTodayDate(),
        attachment: expense.attachment || null
      }
    });
  };

  const handleEditPayment = (payment) => {
    setEntryModal({
      visible: true,
      type: 'payment',
      mode: 'edit',
      entryId: payment.id,
      initialValues: {
        amount: payment.amount?.toString() || '',
        paymentMethod: payment.payment_method || 'Cash',
        note: payment.customer_note || '',
        date: payment.payment_date || getTodayDate(),
        attachment: payment.attachment || null
      }
    });
  };

  if (loading) {
    return <LoadingScreen label="Loading group..." />;
  }

  return (
    <>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          style={styles.screen}
          contentContainerStyle={styles.screenContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadGroup(); }} />}
        >
          <View style={styles.sectionHeader}>
            <Pressable onPress={onBack}>
              <Text style={styles.linkText}>Back</Text>
            </Pressable>
            <Pressable onPress={onOpenNotifications}>
              <Ionicons name="notifications-outline" size={20} color="#2563eb" />
            </Pressable>
          </View>

          <View style={styles.card}>
            <Text style={styles.screenTitle}>{group?.name}</Text>
            {group?.description ? <Text style={styles.groupDescription}>{group.description}</Text> : null}
            <Text style={styles.metaText}>
              {group?.currency} • {capitalizeWords(group?.currentUserRole || 'member')}
            </Text>
            {group?.is_disabled ? (
              <Text style={styles.warningText}>This group is disabled and read-only.</Text>
            ) : null}
            <View style={styles.groupActions}>
              <SecondaryButton
                label="Add expense"
                onPress={() => setEntryModal({
                  visible: true,
                  type: 'expense',
                  mode: 'create',
                  entryId: '',
                  initialValues: null
                })}
                disabled={Boolean(group?.is_disabled)}
              />
              <SecondaryButton
                label="Add payment"
                onPress={() => setEntryModal({
                  visible: true,
                  type: 'payment',
                  mode: 'create',
                  entryId: '',
                  initialValues: null
                })}
                disabled={Boolean(group?.is_disabled)}
              />
            </View>
          </View>

          {settlement && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Open settlement</Text>
              <View style={styles.statRow}>
                <StatCard label="Received" value={settlement.totalReceived} currency={group?.currency} tone="success" />
                <StatCard label="Expenses" value={settlement.totalExpenses} currency={group?.currency} tone="danger" />
              </View>
              <View style={styles.statRow}>
                <StatCard label="Net" value={settlement.netProfit} currency={group?.currency} tone="neutral" />
                <StatCard label="Average share" value={settlement.perPersonShare} currency={group?.currency} tone="neutral" />
              </View>
              {settlement.totalReceived <= 0 ? (
                <Text style={styles.mutedText}>Waiting for received money before settle-up is available.</Text>
              ) : null}
              <Text style={styles.subsectionTitle}>Recommended transfers</Text>
              {settlement.transferSuggestions?.length ? (
                settlement.transferSuggestions.map((item, index) => (
                  <Text key={`${item.fromUserId}-${item.toUserId}-${index}`} style={styles.checklistItem}>
                    • {item.fromName} pays {item.toName} {formatCurrency(item.amount, group?.currency)}
                  </Text>
                ))
              ) : (
                <Text style={styles.mutedText}>No transfers needed right now.</Text>
              )}
            </View>
          )}

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Monthly settle-up</Text>
            {history.length === 0 ? (
              <Text style={styles.mutedText}>No monthly records yet.</Text>
            ) : (
              history.map((month) => (
                <View key={month.month} style={styles.monthRow}>
                  <View style={styles.monthInfo}>
                    <Text style={styles.groupTitle}>{formatMonth(month.month)}</Text>
                    <Text style={styles.metaText}>
                      {month.isSettled
                        ? `Settled by ${month.settledByName || 'a member'} on ${formatDate(month.settledAt)}`
                        : month.totalReceived > 0
                          ? 'Money received. Ready to settle.'
                          : 'Waiting for received money'}
                    </Text>
                  </View>
                  {!month.isSettled && !group?.is_disabled ? (
                    <PrimaryButton
                      label={settlingMonth === month.month ? 'Settling...' : 'Settle'}
                      onPress={() => handleSettle(month.month)}
                      disabled={settlingMonth === month.month || month.totalReceived <= 0}
                      compact
                    />
                  ) : null}
                </View>
              ))
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Members</Text>
            <Field
              label="Invite by email"
              value={inviteEmail}
              onChangeText={setInviteEmail}
              placeholder="member@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <SecondaryButton label="Send invitation" onPress={handleInviteMember} />
            {memberRequests.length > 0 ? (
              <>
                <Text style={styles.subsectionTitle}>Pending member requests</Text>
                {memberRequests.map((request) => (
                  <View key={request.id} style={styles.groupCard}>
                    <Text style={styles.groupTitle}>{request.invitedUserName || request.invited_user_name || 'Member request'}</Text>
                    <Text style={styles.metaText}>{request.invitedUserEmail || request.invited_user_email}</Text>
                    <View style={styles.groupActions}>
                      <SecondaryButton label="Approve" onPress={() => handleMemberRequest(request.id, 'approve')} />
                      <SecondaryButton label="Reject" onPress={() => handleMemberRequest(request.id, 'reject')} />
                    </View>
                  </View>
                ))}
              </>
            ) : null}
            {group?.members?.map((member) => (
              <View key={member.id} style={styles.memberRow}>
                <View>
                  <Text style={styles.groupTitle}>{member.name}</Text>
                  <Text style={styles.metaText}>{member.email}</Text>
                </View>
                <View style={styles.memberActions}>
                  <View style={styles.rolePill}>
                    <Text style={styles.rolePillText}>
                      {member.id === group.admin_id ? 'Admin' : capitalizeWords(member.role || 'member')}
                    </Text>
                  </View>
                  {member.id !== group.admin_id ? (
                    <>
                      <SecondaryButton label={member.role === 'manager' ? 'Set member' : 'Set manager'} onPress={() => handleUpdateMemberRole(member)} />
                      <SecondaryButton label="Remove" onPress={() => handleRemoveMember(member)} />
                    </>
                  ) : null}
                </View>
              </View>
            ))}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Recurring templates</Text>
            <Field label="Title" value={templateTitle} onChangeText={setTemplateTitle} placeholder="Monthly internet bill" />
            <Field label="Amount" value={templateAmount} onChangeText={setTemplateAmount} placeholder="100" keyboardType="decimal-pad" />
            <Text style={styles.fieldLabel}>Type</Text>
            <View style={styles.chipWrap}>
              {['expense', 'payment'].map((item) => (
                <Pressable
                  key={item}
                  onPress={() => setTemplateType(item)}
                  style={[styles.chip, templateType === item && styles.chipActive]}
                >
                  <Text style={[styles.chipLabel, templateType === item && styles.chipLabelActive]}>{capitalizeWords(item)}</Text>
                </Pressable>
              ))}
            </View>
            <SecondaryButton label="Create recurring template" onPress={handleCreateTemplate} />
            {templates.length === 0 ? (
              <Text style={styles.mutedText}>No recurring templates yet.</Text>
            ) : (
              templates.map((template) => (
                <View key={template.id} style={styles.groupCard}>
                  <Text style={styles.groupTitle}>{template.title}</Text>
                  <Text style={styles.metaText}>
                    {capitalizeWords(template.entry_type || template.entryType)} • {formatCurrency(template.amount, group?.currency)}
                  </Text>
                  <View style={styles.groupActions}>
                    <SecondaryButton label="Use now" onPress={() => handleUseTemplate(template.id)} />
                    <SecondaryButton label="Delete" onPress={() => handleDeleteTemplate(template.id)} />
                  </View>
                </View>
              ))
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Monthly report</Text>
            <Field label="Month (YYYY-MM)" value={summaryMonth} onChangeText={setSummaryMonth} placeholder="2026-05" />
            <SecondaryButton label="Load summary" onPress={handleLoadSummary} />
            <View style={styles.groupActions}>
              <SecondaryButton label="Export CSV" onPress={() => handleExportSummary('csv')} disabled={!summary} />
              <SecondaryButton label="Export PDF" onPress={() => handleExportSummary('pdf')} disabled={!summary} />
            </View>
            {summary ? (
              <>
                <Text style={styles.metaText}>Revenue: {formatCurrency(summary.totalReceived, group?.currency)}</Text>
                <Text style={styles.metaText}>Expenses: {formatCurrency(summary.totalExpenses, group?.currency)}</Text>
                <Text style={styles.metaText}>Net: {formatCurrency(summary.netProfit, group?.currency)}</Text>
              </>
            ) : (
              <Text style={styles.mutedText}>Load a month to view report summary.</Text>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Group settings</Text>
            <Field label="Group name" value={groupName} onChangeText={setGroupName} placeholder="Group name" />
            <Field label="Description" value={groupDescription} onChangeText={setGroupDescription} placeholder="Description" multiline />
            <Field label="Currency" value={groupCurrency} onChangeText={setGroupCurrency} placeholder="EUR" />
            <SecondaryButton label="Save group details" onPress={handleUpdateGroup} />
            {pendingDeleteRequest ? (
              <Text style={styles.warningText}>Delete request pending approvals.</Text>
            ) : null}
            <View style={styles.groupActions}>
              <SecondaryButton label="Request delete group" onPress={handleRequestDelete} />
              <SecondaryButton label="Approve delete" onPress={handleApproveDelete} />
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Activity</Text>
            {activity.length === 0 ? (
              <Text style={styles.mutedText}>No recent activity.</Text>
            ) : (
              activity.slice(0, 8).map((item) => (
                <TimelineRow
                  key={item.id}
                  title={item.title || capitalizeWords(item.activity_type || item.activityType || 'Activity')}
                  subtitle={item.description || ''}
                  meta={formatDateTime(item.created_at || item.createdAt)}
                />
              ))
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Latest expenses</Text>
            {expenses.slice(0, 5).map((expense) => (
              <View key={expense.id} style={styles.timelineRow}>
                <TimelineRow
                  title={formatCurrency(expense.amount, group?.currency)}
                  subtitle={expense.note || 'Expense'}
                  meta={`${expense.user_name || ''} • ${formatDate(expense.expense_date)}`}
                />
                <View style={styles.groupActions}>
                  <SecondaryButton label="Edit" onPress={() => handleEditExpense(expense)} disabled={Boolean(group?.is_disabled)} />
                  <SecondaryButton label="Delete" onPress={() => handleDeleteExpense(expense.id)} disabled={Boolean(group?.is_disabled)} />
                </View>
              </View>
            ))}
            {expenses.length === 0 ? <Text style={styles.mutedText}>No expenses yet.</Text> : null}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Latest payments</Text>
            {payments.slice(0, 5).map((payment) => (
              <View key={payment.id} style={styles.timelineRow}>
                <TimelineRow
                  title={formatCurrency(payment.amount, group?.currency)}
                  subtitle={payment.customer_note || payment.payment_method}
                  meta={`${payment.user_name || ''} • ${formatDate(payment.payment_date)}`}
                />
                <View style={styles.groupActions}>
                  <SecondaryButton label="Edit" onPress={() => handleEditPayment(payment)} disabled={Boolean(group?.is_disabled)} />
                  <SecondaryButton label="Delete" onPress={() => handleDeletePayment(payment.id)} disabled={Boolean(group?.is_disabled)} />
                </View>
              </View>
            ))}
            {payments.length === 0 ? <Text style={styles.mutedText}>No payments yet.</Text> : null}
          </View>
        </ScrollView>
      </SafeAreaView>

      <EntryModal
        visible={Boolean(entryModal.visible)}
        type={entryModal.type}
        mode={entryModal.mode}
        entryId={entryModal.entryId}
        initialValues={entryModal.initialValues}
        groups={group ? [{ id: group.id, name: group.name, currency: group.currency }] : []}
        defaultGroupId={groupId}
        onClose={() => setEntryModal((current) => ({ ...current, visible: false }))}
        onSaved={async () => {
          setEntryModal((current) => ({ ...current, visible: false }));
          await loadGroup();
        }}
      />
    </>
  );
}

function CreateGroupModal({ visible, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    setName('');
    setDescription('');
    setCurrency('EUR');
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      Alert.alert('Group name required', 'Please enter a group name.');
      return;
    }

    try {
      setSaving(true);
      const result = await groupsAPI.createGroup(name.trim(), description.trim(), currency.trim().toUpperCase());
      resetForm();
      await onCreated(result.data.id);
    } catch (error) {
      Alert.alert('Create group failed', error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppModal visible={visible} onClose={() => { resetForm(); onClose(); }} title="Create group">
      <Field label="Group name" value={name} onChangeText={setName} placeholder="Project ABC" />
      <Field label="Description" value={description} onChangeText={setDescription} placeholder="Optional" multiline />
      <Text style={styles.fieldLabel}>Currency</Text>
      <View style={styles.chipWrap}>
        {QUICK_CURRENCIES.map((item) => (
          <Pressable
            key={item}
            onPress={() => setCurrency(item)}
            style={[styles.chip, currency === item && styles.chipActive]}
          >
            <Text style={[styles.chipLabel, currency === item && styles.chipLabelActive]}>{item}</Text>
          </Pressable>
        ))}
      </View>
      <Field label="Custom currency code" value={currency} onChangeText={(value) => setCurrency(value.toUpperCase())} placeholder="EUR" />
      <PrimaryButton label={saving ? 'Creating...' : 'Create group'} onPress={handleCreate} disabled={saving} />
    </AppModal>
  );
}

function EntryModal({
  visible,
  type,
  mode = 'create',
  entryId = '',
  initialValues = null,
  groups,
  defaultGroupId,
  onClose,
  onSaved
}) {
  const isEditMode = mode === 'edit';
  const [groupId, setGroupId] = useState(defaultGroupId || '');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(getTodayDate());
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [attachment, setAttachment] = useState(null);
  const [currentAttachment, setCurrentAttachment] = useState(null);
  const [removeCurrentAttachment, setRemoveCurrentAttachment] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setGroupId(defaultGroupId || groups[0]?.id || '');
      if (isEditMode && initialValues) {
        setAmount(initialValues.amount || '');
        setNote(initialValues.note || '');
        setDate(initialValues.date || getTodayDate());
        setPaymentMethod(initialValues.paymentMethod || 'Cash');
        setCurrentAttachment(initialValues.attachment || null);
      } else {
        setAmount('');
        setNote('');
        setDate(getTodayDate());
        setPaymentMethod('Cash');
        setCurrentAttachment(null);
      }
      setAttachment(null);
      setRemoveCurrentAttachment(false);
    }
  }, [visible, defaultGroupId, groups, isEditMode, initialValues]);

  const pickAttachment = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['image/*', 'application/pdf'],
      copyToCacheDirectory: true,
      multiple: false
    });

    if (!result.canceled && result.assets?.length) {
      setAttachment(result.assets[0]);
      setRemoveCurrentAttachment(false);
    }
  };

  const handleSave = async () => {
    if (!amount || (!isEditMode && !groupId)) {
      Alert.alert('Missing details', isEditMode ? 'Enter amount first.' : 'Choose a group and amount first.');
      return;
    }

    if (isEditMode && !entryId) {
      Alert.alert('Update unavailable', 'Missing entry reference for update.');
      return;
    }

    try {
      setSaving(true);
      if (type === 'expense') {
        if (isEditMode) {
          await expensesAPI.updateExpense(entryId, amount, note, date, attachment, !attachment && removeCurrentAttachment);
        } else {
          await expensesAPI.addExpense(groupId, amount, note, date, attachment);
        }
      } else {
        if (isEditMode) {
          await paymentsAPI.updatePayment(
            entryId,
            amount,
            paymentMethod,
            note,
            date,
            attachment,
            !attachment && removeCurrentAttachment
          );
        } else {
          await paymentsAPI.recordPayment(groupId, amount, paymentMethod, note, date, attachment);
        }
      }
      await onSaved();
    } catch (error) {
      Alert.alert(
        type === 'expense'
          ? (isEditMode ? 'Update expense failed' : 'Add expense failed')
          : (isEditMode ? 'Update payment failed' : 'Add payment failed'),
        error.message
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppModal
      visible={Boolean(visible)}
      onClose={onClose}
      title={
        type === 'expense'
          ? (isEditMode ? 'Edit expense' : 'Add expense')
          : (isEditMode ? 'Edit payment' : 'Record payment')
      }
    >
      {!isEditMode ? (
        <>
          <Text style={styles.fieldLabel}>Group</Text>
          <View style={styles.groupSelection}>
            {groups.length === 0 ? (
              <Text style={styles.mutedText}>No active groups available.</Text>
            ) : (
              groups.map((group) => (
                <Pressable
                  key={group.id}
                  onPress={() => setGroupId(group.id)}
                  style={[styles.groupChip, group.id === groupId && styles.groupChipActive]}
                >
                  <Text style={[styles.groupChipLabel, group.id === groupId && styles.groupChipLabelActive]}>{group.name}</Text>
                </Pressable>
              ))
            )}
          </View>
        </>
      ) : null}
      <Field label="Amount" value={amount} onChangeText={setAmount} placeholder="200" keyboardType="decimal-pad" />
      {type === 'payment' ? (
        <>
          <Text style={styles.fieldLabel}>Payment method</Text>
          <View style={styles.chipWrap}>
            {PAYMENT_METHODS.map((item) => (
              <Pressable
                key={item}
                onPress={() => setPaymentMethod(item)}
                style={[styles.chip, paymentMethod === item && styles.chipActive]}
              >
                <Text style={[styles.chipLabel, paymentMethod === item && styles.chipLabelActive]}>{item}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
      <Field
        label={type === 'expense' ? 'Note' : 'Customer note'}
        value={note}
        onChangeText={setNote}
        placeholder={type === 'expense' ? 'Coffee beans' : 'Morning orders'}
      />
      <Field label="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} placeholder="2026-05-26" />
      <SecondaryButton label={attachment ? `Receipt: ${attachment.name}` : 'Pick receipt / PDF'} onPress={pickAttachment} />
      {isEditMode && currentAttachment && !attachment ? (
        <>
          <Text style={styles.metaText}>Current attachment: {currentAttachment.name || 'Existing file'}</Text>
          <SecondaryButton
            label={removeCurrentAttachment ? 'Keep current attachment' : 'Remove current attachment'}
            onPress={() => setRemoveCurrentAttachment((current) => !current)}
          />
          {removeCurrentAttachment ? (
            <Text style={styles.warningText}>Current attachment will be removed when you save.</Text>
          ) : null}
        </>
      ) : null}
      {attachment ? (
        <SecondaryButton label="Clear selected attachment" onPress={() => setAttachment(null)} />
      ) : null}
      <PrimaryButton
        label={
          saving
            ? 'Saving...'
            : type === 'expense'
              ? (isEditMode ? 'Update expense' : 'Save expense')
              : (isEditMode ? 'Update payment' : 'Save payment')
        }
        onPress={handleSave}
        disabled={Boolean(saving) || (!isEditMode && groups.length === 0)}
      />
    </AppModal>
  );
}

function LoadingScreen({ label }) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2563eb" />
        <Text style={styles.loadingText}>{label}</Text>
      </View>
    </SafeAreaView>
  );
}

function BottomTabs({ activeTab, onChange }) {
  return (
    <View style={styles.bottomTabs}>
      {TABS.map((tab) => (
        <Pressable key={tab.key} onPress={() => onChange(tab.key)} style={styles.bottomTab}>
          <Ionicons
            name={activeTab === tab.key ? tab.activeIcon : tab.icon}
            size={18}
            color={activeTab === tab.key ? '#ffffff' : '#94a3b8'}
          />
          <Text style={[styles.bottomTabLabel, activeTab === tab.key && styles.bottomTabLabelActive]}>
            {tab.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function AppModal({ visible, onClose, title, children }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.cardTitle}>{title}</Text>
            <Pressable onPress={onClose}>
              <Text style={styles.linkText}>Close</Text>
            </Pressable>
          </View>
          <ScrollView>{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Field({ label, multiline = false, ...props }) {
  return (
    <View style={styles.field}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <TextInput
        {...props}
        multiline={multiline}
        style={[styles.input, multiline && styles.inputMultiline, props.editable === false && styles.inputDisabled]}
        placeholderTextColor="#94a3b8"
      />
    </View>
  );
}

function PrimaryButton({ label, onPress, disabled = false, tone = 'primary', compact = false }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.primaryButton,
        tone === 'secondary' && styles.secondaryPrimaryButton,
        compact && styles.compactButton,
        disabled && styles.buttonDisabled
      ]}
    >
      <Text style={[styles.primaryButtonLabel, tone === 'secondary' && styles.secondaryPrimaryButtonLabel]}>{label}</Text>
    </Pressable>
  );
}

function SecondaryButton({ label, onPress, disabled = false }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.secondaryButton, disabled && styles.buttonDisabled]}>
      <Text style={styles.secondaryButtonLabel}>{label}</Text>
    </Pressable>
  );
}

function StatCard({ label, value, currency, tone }) {
  return (
    <View style={[styles.statCard, tone === 'success' && styles.statCardSuccess, tone === 'danger' && styles.statCardDanger]}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{formatCurrency(value, currency)}</Text>
    </View>
  );
}

function TimelineRow({ title, subtitle, meta }) {
  return (
    <View style={styles.timelineRow}>
      <Text style={styles.groupTitle}>{title}</Text>
      <Text style={styles.notificationMessage}>{subtitle}</Text>
      <Text style={styles.metaText}>{meta}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f8fafc'
  },
  appShell: {
    flex: 1
  },
  screen: {
    flex: 1
  },
  screenContent: {
    padding: 20,
    gap: 16,
    paddingBottom: 110
  },
  authContainer: {
    flex: 1
  },
  authScroll: {
    padding: 20,
    gap: 16,
    justifyContent: 'center',
    flexGrow: 1
  },
  heroCard: {
    backgroundColor: '#dbeafe',
    borderRadius: 24,
    padding: 24,
    gap: 10
  },
  heroTitle: {
    fontSize: 30,
    fontWeight: '800',
    color: '#0f172a'
  },
  heroSubtitle: {
    color: '#1e3a8a',
    fontSize: 15,
    lineHeight: 22
  },
  heroHint: {
    color: '#334155',
    fontSize: 12
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: '#e2e8f0',
    borderRadius: 16,
    padding: 4
  },
  segmentButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 12
  },
  segmentButtonActive: {
    backgroundColor: '#ffffff'
  },
  segmentLabel: {
    color: '#475569',
    fontWeight: '600'
  },
  segmentLabelActive: {
    color: '#0f172a'
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 18,
    gap: 12,
    shadowColor: '#0f172a',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2
  },
  screenTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0f172a'
  },
  screenSubtitle: {
    marginTop: 4,
    color: '#475569',
    maxWidth: '78%'
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12
  },
  bellButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14
  },
  bellLabel: {
    color: '#0f172a',
    fontWeight: '700'
  },
  badge: {
    minWidth: 26,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#2563eb',
    alignItems: 'center'
  },
  badgeText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 12
  },
  warningBanner: {
    backgroundColor: '#fef3c7',
    borderRadius: 18,
    padding: 16,
    gap: 6
  },
  warningTitle: {
    fontWeight: '700',
    color: '#92400e'
  },
  warningText: {
    color: '#92400e',
    lineHeight: 20
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0f172a'
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12
  },
  statRow: {
    flexDirection: 'row',
    gap: 12
  },
  statCard: {
    flex: 1,
    backgroundColor: '#eff6ff',
    borderRadius: 18,
    padding: 14
  },
  statCardSuccess: {
    backgroundColor: '#ecfdf5'
  },
  statCardDanger: {
    backgroundColor: '#fef2f2'
  },
  statLabel: {
    fontSize: 12,
    color: '#64748b',
    marginBottom: 8
  },
  statValue: {
    color: '#0f172a',
    fontSize: 18,
    fontWeight: '700'
  },
  buttonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10
  },
  primaryButton: {
    backgroundColor: '#2563eb',
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center'
  },
  primaryButtonLabel: {
    color: '#ffffff',
    fontWeight: '700'
  },
  secondaryPrimaryButton: {
    backgroundColor: '#e2e8f0'
  },
  secondaryPrimaryButtonLabel: {
    color: '#0f172a'
  },
  compactButton: {
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12
  },
  secondaryButtonLabel: {
    color: '#0f172a',
    fontWeight: '600'
  },
  buttonDisabled: {
    opacity: 0.5
  },
  mutedText: {
    color: '#64748b',
    lineHeight: 20
  },
  groupCard: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 18,
    padding: 16,
    gap: 10
  },
  groupTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a'
  },
  groupDescription: {
    color: '#475569',
    lineHeight: 20
  },
  groupActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10
  },
  rolePill: {
    backgroundColor: '#dbeafe',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999
  },
  rolePillMuted: {
    backgroundColor: '#e2e8f0'
  },
  rolePillText: {
    color: '#1d4ed8',
    fontSize: 12,
    fontWeight: '700'
  },
  notificationPreview: {
    borderWidth: 1,
    borderColor: '#dbeafe',
    backgroundColor: '#eff6ff',
    borderRadius: 16,
    padding: 14,
    gap: 6
  },
  notificationItem: {
    borderRadius: 16,
    padding: 14,
    gap: 6
  },
  notificationUnread: {
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe'
  },
  notificationRead: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0'
  },
  notificationTitle: {
    fontWeight: '700',
    color: '#0f172a'
  },
  notificationMessage: {
    color: '#475569',
    lineHeight: 20
  },
  metaText: {
    color: '#64748b',
    fontSize: 12
  },
  linkText: {
    color: '#2563eb',
    fontWeight: '700'
  },
  disabledText: {
    color: '#94a3b8'
  },
  bottomTabs: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 20,
    flexDirection: 'row',
    backgroundColor: '#0f172a',
    borderRadius: 22,
    paddingVertical: 8,
    paddingHorizontal: 8,
    justifyContent: 'space-between'
  },
  bottomTab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    gap: 4
  },
  bottomTabLabel: {
    color: '#94a3b8',
    fontWeight: '700',
    fontSize: 12
  },
  bottomTabLabelActive: {
    color: '#ffffff'
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end'
  },
  modalCard: {
    backgroundColor: '#ffffff',
    padding: 20,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '88%'
  },
  field: {
    marginBottom: 14
  },
  fieldLabel: {
    marginBottom: 8,
    color: '#334155',
    fontWeight: '600'
  },
  input: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#0f172a'
  },
  inputMultiline: {
    minHeight: 88,
    textAlignVertical: 'top'
  },
  inputDisabled: {
    color: '#64748b'
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 12
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#cbd5e1'
  },
  chipActive: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb'
  },
  chipLabel: {
    color: '#334155',
    fontWeight: '600'
  },
  chipLabelActive: {
    color: '#ffffff'
  },
  successText: {
    color: '#15803d',
    lineHeight: 20
  },
  helperText: {
    color: '#64748b',
    lineHeight: 20
  },
  supportSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12
  },
  faqItem: {
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingTop: 10,
    gap: 6
  },
  faqQuestion: {
    flex: 1,
    color: '#0f172a',
    fontWeight: '600'
  },
  errorText: {
    color: '#b91c1c',
    lineHeight: 20
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10
  },
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 1,
    borderColor: '#94a3b8',
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2
  },
  checkboxActive: {
    borderColor: '#2563eb',
    backgroundColor: '#2563eb'
  },
  checkboxTick: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700'
  },
  checklistItem: {
    color: '#334155',
    lineHeight: 22
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14
  },
  loadingText: {
    color: '#334155'
  },
  timelineRow: {
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingTop: 12
  },
  monthRow: {
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingTop: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    alignItems: 'center'
  },
  monthInfo: {
    flex: 1,
    gap: 4
  },
  subsectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    marginTop: 8
  },
  memberRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingTop: 12,
    gap: 12
  },
  memberActions: {
    alignItems: 'flex-end',
    gap: 8
  },
  groupSelection: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14
  },
  groupChip: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  groupChipActive: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb'
  },
  groupChipLabel: {
    color: '#0f172a',
    fontWeight: '600'
  },
  groupChipLabelActive: {
    color: '#ffffff'
  }
});
