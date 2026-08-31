import React, { createContext, useState, useContext, useEffect } from 'react';
import { authAPI } from '../services/api';

// Create auth context
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Check if user is already logged in
  const refreshUser = async () => {
    const token = localStorage.getItem('token');

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

      localStorage.removeItem('token');
      setUser(null);
      return null;
    } catch (err) {
      console.error('Auth check error:', err);
      localStorage.removeItem('token');
      setUser(null);
      return null;
    }
  };

  useEffect(() => {
    const checkAuth = async () => {
      await refreshUser();
      setLoading(false);
    };

    checkAuth();
  }, []);

  const login = async (email, password) => {
    try {
      setError(null);
      const result = await authAPI.login(email, password);
      
      if (result.success) {
        localStorage.setItem('token', result.data.token);
        setUser(result.data);
        return result.data;
      } else {
        throw new Error(result.error);
      }
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const register = async (email, password, name) => {
    try {
      setError(null);
      const result = await authAPI.register(email, password, name);

      if (!result.success) {
        throw new Error(result.error);
      }

      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const updateProfile = async (data) => {
    try {
      setError(null);
      const result = await authAPI.updateProfile(data);

      if (result.success) {
        localStorage.setItem('token', result.data.token);
        setUser(result.data);
        return result.data;
      }

      throw new Error(result.error);
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const logout = async () => {
    try {
      await authAPI.logout();
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      localStorage.removeItem('token');
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, error, login, register, updateProfile, refreshUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// Hook to use auth context
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
