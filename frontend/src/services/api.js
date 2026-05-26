// API Configuration
const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:5000/api').replace(/\/$/, '');
const API_BASE_URL = API_URL.replace(/\/api$/, '');

// Get token from localStorage
function getToken() {
  return localStorage.getItem('token');
}

function createHeaders(data) {
  const headers = {};

  if (!(data instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const token = getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

// Generic API call function
async function apiCall(endpoint, method = 'GET', data = null) {
  const options = {
    method,
    headers: createHeaders(data)
  };

  // Add body if data provided
  if (data) {
    options.body = data instanceof FormData ? data : JSON.stringify(data);
  }

  try {
    const response = await fetch(`${API_URL}${endpoint}`, options);
    const contentType = response.headers.get('content-type') || '';
    const isJsonResponse = contentType.includes('application/json');
    const result = isJsonResponse
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      if (isJsonResponse) {
        throw new Error(result.error || 'API Error');
      }

      if (response.status === 504) {
        throw new Error('The server timed out while processing the request. Check SMTP settings and backend logs.');
      }

      throw new Error(`Unexpected server response (${response.status})`);
    }

    return result;
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
}

async function downloadFile(endpoint) {
  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'GET',
    headers: createHeaders(null)
  });

  if (!response.ok) {
    let errorMessage = 'Failed to download file';

    try {
      const data = await response.json();
      errorMessage = data.error || errorMessage;
    } catch {
      // Ignore invalid JSON and use the generic message.
    }

    throw new Error(errorMessage);
  }

  const blob = await response.blob();
  const contentDisposition = response.headers.get('content-disposition') || '';
  const filenameMatch = contentDisposition.match(/filename="([^"]+)"/);

  return {
    blob,
    filename: filenameMatch?.[1] || 'download'
  };
}

function buildQuery(params = {}) {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.set(key, value);
    }
  });

  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}

function buildExpenseFormData(groupId, amount, note, expenseDate, attachment, removeAttachment = false) {
  const formData = new FormData();
  formData.append('groupId', groupId);
  formData.append('amount', amount);
  formData.append('note', note || '');
  formData.append('expenseDate', expenseDate);

  if (attachment) {
    formData.append('attachment', attachment);
  }

  if (removeAttachment) {
    formData.append('removeAttachment', 'true');
  }

  return formData;
}

function buildPaymentFormData(groupId, amount, paymentMethod, customerNote, paymentDate, attachment, removeAttachment = false) {
  const formData = new FormData();
  formData.append('groupId', groupId);
  formData.append('amount', amount);
  formData.append('paymentMethod', paymentMethod);
  formData.append('customerNote', customerNote || '');
  formData.append('paymentDate', paymentDate);

  if (attachment) {
    formData.append('attachment', attachment);
  }

  if (removeAttachment) {
    formData.append('removeAttachment', 'true');
  }

  return formData;
}

// Auth API
export const authAPI = {
  register: (email, password, name) =>
    apiCall('/auth/register', 'POST', { email, password, name }),
  
  login: (email, password) =>
    apiCall('/auth/login', 'POST', { email, password }),

  googleLogin: (credential) =>
    apiCall('/auth/google', 'POST', { credential }),

  updateProfile: (data) =>
    apiCall('/auth/profile', 'PUT', data),

  activateEmail: (token) =>
    apiCall('/auth/activate', 'POST', { token }),
  
  logout: () =>
    apiCall('/auth/logout', 'POST'),
  
  getCurrentUser: () =>
    apiCall('/auth/me', 'GET')
};

// Groups API
export const groupsAPI = {
  createGroup: (name, description, currency) =>
    apiCall('/groups', 'POST', { name, description, currency }),
  
  getGroups: () =>
    apiCall('/groups', 'GET'),

  getPersonalSummary: () =>
    apiCall('/groups/personal-summary', 'GET'),

  createSampleGroup: () =>
    apiCall('/groups/sample', 'POST'),
  
  getGroup: (id) =>
    apiCall(`/groups/${id}`, 'GET'),
  
  updateGroup: (id, name, description, currency) =>
    apiCall(`/groups/${id}`, 'PUT', { name, description, currency }),
  
  addMember: (groupId, email) =>
    apiCall(`/groups/${groupId}/members`, 'POST', { email }),

  getReceivedInvitations: () =>
    apiCall('/groups/invitations/received', 'GET'),

  respondToInvitation: (requestId, action) =>
    apiCall(`/groups/invitations/${requestId}/respond`, 'POST', { action }),

  getMemberRequests: (groupId) =>
    apiCall(`/groups/${groupId}/member-requests`, 'GET'),

  reviewMemberRequest: (groupId, requestId, action) =>
    apiCall(`/groups/${groupId}/member-requests/${requestId}/review`, 'POST', { action }),
  
  removeMember: (groupId, userId, reason) =>
    apiCall(`/groups/${groupId}/members/${userId}`, 'DELETE', { reason }),

  updateMemberRole: (groupId, userId, role) =>
    apiCall(`/groups/${groupId}/members/${userId}/role`, 'PUT', { role }),

  requestDeleteGroup: (groupId) =>
    apiCall(`/groups/${groupId}/delete-request`, 'POST'),

  approveDeleteGroup: (groupId) =>
    apiCall(`/groups/${groupId}/delete-request/approve`, 'POST'),

  getPendingDeleteApprovals: () =>
    apiCall('/groups/deletion-requests/pending', 'GET')
};

// Expenses API
export const expensesAPI = {
  addExpense: (groupId, amount, note, expenseDate, attachment = null) =>
    apiCall('/expenses', 'POST', buildExpenseFormData(groupId, amount, note, expenseDate, attachment)),
  
  getGroupExpenses: (groupId, filters = {}) =>
    apiCall(`/expenses/group/${groupId}${buildQuery(filters)}`, 'GET'),
  
  getExpense: (id) =>
    apiCall(`/expenses/${id}`, 'GET'),
  
  updateExpense: (id, amount, note, expenseDate, attachment = null, removeAttachment = false) =>
    apiCall(`/expenses/${id}`, 'PUT', buildExpenseFormData('', amount, note, expenseDate, attachment, removeAttachment)),
  
  deleteExpense: (id) =>
    apiCall(`/expenses/${id}`, 'DELETE')
};

// Payments API
export const paymentsAPI = {
  recordPayment: (groupId, amount, paymentMethod, customerNote, paymentDate, attachment = null) =>
    apiCall('/payments', 'POST', buildPaymentFormData(groupId, amount, paymentMethod, customerNote, paymentDate, attachment)),
  
  getGroupPayments: (groupId, filters = {}) =>
    apiCall(`/payments/group/${groupId}${buildQuery(filters)}`, 'GET'),
  
  getPayment: (id) =>
    apiCall(`/payments/${id}`, 'GET'),
  
  updatePayment: (id, amount, paymentMethod, customerNote, paymentDate, attachment = null, removeAttachment = false) =>
    apiCall(`/payments/${id}`, 'PUT', buildPaymentFormData('', amount, paymentMethod, customerNote, paymentDate, attachment, removeAttachment)),
  
  deletePayment: (id) =>
    apiCall(`/payments/${id}`, 'DELETE')
};

// Settlement API
export const settlementAPI = {
  getSettlement: (groupId) =>
    apiCall(`/settlement/group/${groupId}`, 'GET'),

  getSettlementHistory: (groupId) =>
    apiCall(`/settlement/group/${groupId}/history`, 'GET'),

  settleMonth: (groupId, month) =>
    apiCall(`/settlement/group/${groupId}/settle`, 'POST', { month })
};

// Support API
export const supportAPI = {
  submitFeedback: (data) =>
    apiCall('/support/feedback', 'POST', data)
};

export const inboxAPI = {
  getNotifications: (filters = {}) =>
    apiCall(`/inbox${buildQuery(filters)}`, 'GET'),

  markRead: (id) =>
    apiCall(`/inbox/${id}/read`, 'POST'),

  markAllRead: () =>
    apiCall('/inbox/read-all', 'POST')
};

export const activityAPI = {
  getGroupActivity: (groupId, filters = {}) =>
    apiCall(`/activity/group/${groupId}${buildQuery(filters)}`, 'GET')
};

export const reportsAPI = {
  getMonthlySummary: (groupId, month) =>
    apiCall(`/reports/group/${groupId}/monthly-summary${buildQuery({ month })}`, 'GET'),

  downloadMonthlySummaryCsv: (groupId, month) =>
    downloadFile(`/reports/group/${groupId}/export.csv${buildQuery({ month })}`),

  downloadMonthlySummaryPdf: (groupId, month) =>
    downloadFile(`/reports/group/${groupId}/export.pdf${buildQuery({ month })}`)
};

export const recurringAPI = {
  getTemplates: (groupId) =>
    apiCall(`/recurring/group/${groupId}`, 'GET'),

  createTemplate: (groupId, data) =>
    apiCall(`/recurring/group/${groupId}`, 'POST', data),

  updateTemplate: (groupId, templateId, data) =>
    apiCall(`/recurring/group/${groupId}/${templateId}`, 'PUT', data),

  deleteTemplate: (groupId, templateId) =>
    apiCall(`/recurring/group/${groupId}/${templateId}`, 'DELETE'),

  useTemplate: (groupId, templateId, date) =>
    apiCall(`/recurring/group/${groupId}/${templateId}/use`, 'POST', { date })
};

export const undoAPI = {
  getLatest: () =>
    apiCall('/undo/latest', 'GET'),

  undo: (id) =>
    apiCall(`/undo/${id}`, 'POST')
};

export function getApiBaseUrl() {
  return API_BASE_URL;
}
