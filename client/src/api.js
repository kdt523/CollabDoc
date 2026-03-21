const API_BASE = '/api';

async function parseJsonSafe(res) {
  try {
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

async function apiRequest(path, { method = 'GET', body, token, headers = {} } = {}) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await parseJsonSafe(res);
  if (!res.ok) {
    const message = data?.message || res.statusText;
    const err = new Error(message);
    err.code = data?.code || res.status;
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

export function register({ name, email, password }) {
  return apiRequest('/auth/register', {
    method: 'POST',
    body: { name, email, password },
  });
}

export function login({ email, password }) {
  return apiRequest('/auth/login', {
    method: 'POST',
    body: { email, password },
  });
}

export function getDocs(token) {
  return apiRequest('/docs', { token });
}

export function createDoc(token, title) {
  return apiRequest('/docs', { method: 'POST', token, body: { title } });
}

export function getDocMeta(token, docId) {
  return apiRequest(`/docs/${docId}`, { token });
}

export function patchDocTitle(token, docId, title) {
  return apiRequest(`/docs/${docId}/title`, {
    method: 'PATCH',
    token,
    body: { title },
  });
}

export function shareDoc(token, docId) {
  return apiRequest(`/docs/${docId}/share`, {
    method: 'POST',
    token,
    body: { role: 'viewer' },
  });
}

export function joinSharedDoc(token, shareToken) {
  return apiRequest(`/docs/join/${encodeURIComponent(shareToken)}`, {
    method: 'POST',
    token,
    headers: { Accept: 'application/json' },
  });
}

export function getDocVersions(token, docId) {
  return apiRequest(`/docs/${docId}/versions`, { token });
}

export function createDocVersion(token, docId, name) {
  return apiRequest(`/docs/${docId}/versions`, {
    method: 'POST',
    token,
    body: { name },
  });
}

export function restoreDocVersion(token, docId, versionId) {
  return apiRequest(`/docs/${docId}/versions/${versionId}/restore`, {
    method: 'POST',
    token,
  });
}


