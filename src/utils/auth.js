export const TOKEN_KEY = 'chat_token';
export const USER_KEY = 'chat_user';

export function setToken(token) {
  if (!token) return;
  localStorage.setItem(TOKEN_KEY, token);
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function removeToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function setUser(user) {
  if (!user) return;
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch (e) {
  }
}

export function getUser() {
  try {
    const s = localStorage.getItem(USER_KEY);
    return s ? JSON.parse(s) : null;
  } catch (e) {
    return null;
  }
}

export function removeUser() {
  localStorage.removeItem(USER_KEY);
}

export function authHeader() {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}
