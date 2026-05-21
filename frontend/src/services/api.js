// API Configuration
const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:5000/api').replace(/\/$/, '');

// Get token from localStorage
function getToken() {
  return localStorage.getItem('token');
}

// Generic API call function
async function apiCall(endpoint, method = 'GET', data = null) {
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
    }
  };

  // Add token if available
  const token = getToken();
  if (token) {
    options.headers['Authorization'] = `Bearer ${token}`;
  }

  // Add body if data provided
  if (data) {
    options.body = JSON.stringify(data);
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
  createGroup: (name, description) =>
    apiCall('/groups', 'POST', { name, description }),
  
  getGroups: () =>
    apiCall('/groups', 'GET'),
  
  getGroup: (id) =>
    apiCall(`/groups/${id}`, 'GET'),
  
  updateGroup: (id, name, description) =>
    apiCall(`/groups/${id}`, 'PUT', { name, description }),
  
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
  
  removeMember: (groupId, userId) =>
    apiCall(`/groups/${groupId}/members/${userId}`, 'DELETE')
};

// Expenses API
export const expensesAPI = {
  addExpense: (groupId, amount, note, expenseDate) =>
    apiCall('/expenses', 'POST', { groupId, amount, note, expenseDate }),
  
  getGroupExpenses: (groupId) =>
    apiCall(`/expenses/group/${groupId}`, 'GET'),
  
  getExpense: (id) =>
    apiCall(`/expenses/${id}`, 'GET'),
  
  updateExpense: (id, amount, note, expenseDate) =>
    apiCall(`/expenses/${id}`, 'PUT', { amount, note, expenseDate }),
  
  deleteExpense: (id) =>
    apiCall(`/expenses/${id}`, 'DELETE')
};

// Payments API
export const paymentsAPI = {
  recordPayment: (groupId, amount, paymentMethod, customerNote, paymentDate) =>
    apiCall('/payments', 'POST', { 
      groupId, 
      amount, 
      paymentMethod, 
      customerNote, 
      paymentDate 
    }),
  
  getGroupPayments: (groupId) =>
    apiCall(`/payments/group/${groupId}`, 'GET'),
  
  getPayment: (id) =>
    apiCall(`/payments/${id}`, 'GET'),
  
  updatePayment: (id, amount, paymentMethod, customerNote, paymentDate) =>
    apiCall(`/payments/${id}`, 'PUT', { 
      amount, 
      paymentMethod, 
      customerNote, 
      paymentDate 
    }),
  
  deletePayment: (id) =>
    apiCall(`/payments/${id}`, 'DELETE')
};

// Settlement API
export const settlementAPI = {
  getSettlement: (groupId) =>
    apiCall(`/settlement/group/${groupId}`, 'GET'),

  getSettlementHistory: (groupId) =>
    apiCall(`/settlement/group/${groupId}/history`, 'GET')
};
