import axios from 'axios';

const TOKEN_KEY = 'workpa_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res.data,
  (err) => {
    if (err.response?.status === 401 && !err.config.url.includes('/auth/')) {
      setToken(null);
      window.dispatchEvent(new Event('workpa:unauthorized'));
    }
    const message = err.response?.data?.error || err.message || 'Request failed';
    return Promise.reject(new Error(message));
  }
);

export default api;

// ---- typed helpers ----
export const Auth = {
  status: () => api.get('/auth/status'),
  login: (username, password) => api.post('/auth/login', { username, password }),
  me: () => api.get('/auth/me'),
  changePassword: (currentPassword, newPassword) => api.post('/auth/change-password', { currentPassword, newPassword }),
};

export const Tasks = {
  list: (params) => api.get('/tasks', { params }),
  meta: () => api.get('/tasks/meta'),
  get: (id) => api.get(`/tasks/${id}`),
  create: (data) => api.post('/tasks', data),
  update: (id, data) => api.put(`/tasks/${id}`, data),
  setStatus: (id, status) => api.patch(`/tasks/${id}/status`, { status }),
  remove: (id) => api.delete(`/tasks/${id}`),
  addNote: (id, text) => api.post(`/tasks/${id}/notes`, { text }),
  updateNote: (id, noteId, text) => api.put(`/tasks/${id}/notes/${noteId}`, { text }),
  removeNote: (id, noteId) => api.delete(`/tasks/${id}/notes/${noteId}`),
};

export const Projects = {
  list: () => api.get('/projects'),
  get: (id) => api.get(`/projects/${id}`),
  create: (data) => api.post('/projects', data),
  update: (id, data) => api.put(`/projects/${id}`, data),
  remove: (id, deleteTasks) => api.delete(`/projects/${id}`, { params: deleteTasks ? { deleteTasks: true } : {} }),
};

export const Notes = {
  list: (params) => api.get('/notes', { params }),
  create: (data) => api.post('/notes', data),
  update: (id, data) => api.put(`/notes/${id}`, data),
  remove: (id) => api.delete(`/notes/${id}`),
};

export const Daily = {
  get: (date) => api.get('/daily', { params: { date } }),
  history: (days) => api.get('/daily/history', { params: { days } }),
  setFocus: (date, focus) => api.put(`/daily/${date}`, { focus }),
  addItem: (date, data) => api.post(`/daily/${date}/items`, typeof data === 'string' ? { text: data } : data),
  updateItem: (date, itemId, data) => api.patch(`/daily/${date}/items/${itemId}`, data),
  moveItem: (date, itemId, toDate) => api.post(`/daily/${date}/items/${itemId}/move`, { toDate }),
  removeItem: (date, itemId) => api.delete(`/daily/${date}/items/${itemId}`),
  carryOver: (date, itemIds) => api.post(`/daily/${date}/carryover`, { itemIds }),
};

export const Members = {
  list: (all) => api.get('/members', { params: all ? { all: true } : {} }),
  create: (data) => api.post('/members', data),
  update: (id, data) => api.put(`/members/${id}`, data),
  remove: (id) => api.delete(`/members/${id}`),
};

export const Targets = {
  list: (params) => api.get('/targets', { params }),
  get: (id) => api.get(`/targets/${id}`),
  create: (data) => api.post('/targets', data),
  update: (id, data) => api.put(`/targets/${id}`, data),
  setStatus: (id, status) => api.patch(`/targets/${id}/status`, { status }),
  remove: (id) => api.delete(`/targets/${id}`),
  addFollowUp: (id, data) => api.post(`/targets/${id}/followups`, data),
  removeFollowUp: (id, fid) => api.delete(`/targets/${id}/followups/${fid}`),
  snooze: (id, minutes) => api.post(`/targets/${id}/snooze`, { minutes }),
};

export const Reminders = {
  list: (includeDone) => api.get('/reminders', { params: { includeDone } }),
  create: (data) => api.post('/reminders', data),
  update: (id, data) => api.put(`/reminders/${id}`, data),
  snooze: (id, minutes) => api.post(`/reminders/${id}/snooze`, { minutes }),
  remove: (id) => api.delete(`/reminders/${id}`),
};

export const Push = {
  publicKey: () => api.get('/push/vapid-public-key'),
  subscribe: (subscription, label) => api.post('/push/subscribe', { subscription, label }),
  unsubscribe: (endpoint) => api.post('/push/unsubscribe', { endpoint }),
  test: () => api.post('/push/test'),
};

export const Notifications = {
  list: (unread) => api.get('/notifications', { params: { unread } }),
  digestPreview: () => api.get('/notifications/digest'),
  sendDigest: () => api.post('/notifications/digest'),
  read: (id) => api.patch(`/notifications/${id}/read`),
  readAll: () => api.patch('/notifications/read-all'),
  remove: (id) => api.delete(`/notifications/${id}`),
  clearRead: () => api.delete('/notifications'),
};

export const Integrations = {
  azdo: () => api.get('/integrations/azdo'),
  azdoSyncAll: (force) => api.post('/integrations/azdo/sync-all', { force }),
  azdoPull: () => api.post('/integrations/azdo/pull'),
  azdoSyncProject: (id) => api.post(`/integrations/azdo/sync/project/${id}`),
  azdoSyncTask: (id) => api.post(`/integrations/azdo/sync/task/${id}`),
};

export const Dashboard = {
  get: () => api.get('/dashboard'),
};

export const Expenses = {
  list: (params) => api.get('/expenses', { params }),
  meta: () => api.get('/expenses/meta'),
  summary: (month) => api.get('/expenses/summary', { params: { month } }),
  create: (data) => api.post('/expenses', data),
  update: (id, data) => api.put(`/expenses/${id}`, data),
  remove: (id) => api.delete(`/expenses/${id}`),
  settings: () => api.get('/expenses/settings'),
  saveSettings: (data) => api.put('/expenses/settings', data),
  testMail: (data) => api.post('/expenses/settings/test-mail', data),
  testAI: (data) => api.post('/expenses/settings/test-ai', data),
  sync: (data) => api.post('/expenses/sync', data || {}),
  insights: () => api.get('/expenses/insights'),
  generateInsights: () => api.post('/expenses/insights'),
  parsePreview: (data) => api.post('/expenses/parse-preview', data),
  scanPreview: (days) => api.post('/expenses/scan-preview', { days }),
  gmailAuthUrl: () => api.get('/expenses/gmail/auth-url'),
  gmailDisconnect: () => api.post('/expenses/gmail/disconnect'),
  gmailTest: () => api.post('/expenses/gmail/test'),
};
