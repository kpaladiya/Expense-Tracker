import React, { createContext, useContext, useEffect, useState } from 'react';
import { authAPI } from '../services/api';
import { clearToken, getToken, saveToken } from '../services/storage';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refreshUser = async () => {
    const token = await getToken();

    if (!token) {
      setUser(null);
      return null;
    }

    try {
      const result = await authAPI.getCurrentUser();
      if (result.success) {
        setUser(result.data);
        return result.data;
      }

      await clearToken();
      setUser(null);
      return null;
    } catch (refreshError) {
      await clearToken();
      setUser(null);
      return null;
    }
  };

  useEffect(() => {
    const bootstrap = async () => {
      await refreshUser();
      setLoading(false);
    };

    bootstrap();
  }, []);

  const login = async (email, password) => {
    setError('');
    const result = await authAPI.login(email, password);
    await saveToken(result.data.token);
    setUser(result.data);
    return result.data;
  };

  const googleLogin = async (credential) => {
    setError('');
    const result = await authAPI.googleLogin(credential);
    await saveToken(result.data.token);
    setUser(result.data);
    return result.data;
  };

  const restoreSession = async (token) => {
    setError('');
    await saveToken(token);
    const userData = await refreshUser();

    if (!userData) {
      throw new Error('Failed to restore the mobile session.');
    }

    return userData;
  };

  const updateProfile = async (data) => {
    setError('');
    const result = await authAPI.updateProfile(data);
    await saveToken(result.data.token);
    setUser(result.data);
    return result.data;
  };

  const logout = async () => {
    try {
      await authAPI.logout();
    } catch {
      // Ignore server logout errors and clear the local session.
    } finally {
      await clearToken();
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, error, login, googleLogin, restoreSession, updateProfile, refreshUser, logout, setError }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }

  return context;
}
