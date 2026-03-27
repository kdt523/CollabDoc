import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { login as apiLogin, register as apiRegister } from '../api.js';

const AuthContext = createContext(null);

function base64UrlDecode(str) {
  const output = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = output.length % 4 === 0 ? '' : '='.repeat(4 - (output.length % 4));
  const decoded = atob(output + pad);
  // JWT payload is JSON.
  return decodeURIComponent(
    decoded
      .split('')
      .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
      .join('')
  );
}

function decodeJwtPayload(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const payloadJson = base64UrlDecode(parts[1]);
  return JSON.parse(payloadJson);
}

export function AuthProvider({ children }) {
  const navigate = useNavigate();
  const location = useLocation();

  const [token, setToken] = useState(() => localStorage.getItem('token') || null);
  const [user, setUser] = useState(() => {
    const existing = localStorage.getItem('token');
    if (!existing) return null;
    const payload = decodeJwtPayload(existing);
    if (!payload) return null;
    return { id: payload.userId, email: payload.email, name: payload.name };
  });

  const isAuthenticated = !!token && !!user;

  useEffect(() => {
    if (!isAuthenticated && token) {
      // Token is present but payload is invalid.
      localStorage.removeItem('token');
      setToken(null);
      setUser(null);
    }
  }, [isAuthenticated, token]);

  const authValue = useMemo(() => {
    async function login(email, password) {
      const result = await apiLogin({ email, password });
      localStorage.setItem('token', result.token);
      setToken(result.token);
      setUser(result.user);

      const from = location.state?.from?.pathname;
      navigate(from || '/dashboard', { replace: true });
    }

    async function register(name, email, password) {
      const result = await apiRegister({ name, email, password });
      localStorage.setItem('token', result.token);
      setToken(result.token);
      setUser(result.user);

      const from = location.state?.from?.pathname;
      navigate(from || '/dashboard', { replace: true });
    }

    function logout() {
      localStorage.removeItem('token');
      setToken(null);
      setUser(null);
      navigate('/login', { replace: true });
    }

    function loginWithToken(tkn, userObj) {
      localStorage.setItem('token', tkn);
      setToken(tkn);
      setUser(userObj);
      navigate('/dashboard', { replace: true });
    }

    return {
      user,
      token,
      isAuthenticated,
      login,
      register,
      logout,
      loginWithToken,
    };
  }, [isAuthenticated, location.state, navigate, user, token]);

  return React.createElement(AuthContext.Provider, { value: authValue }, children);
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

