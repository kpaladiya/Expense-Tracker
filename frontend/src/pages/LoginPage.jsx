import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../services/AuthContext';
import { DollarSign, AlertCircle } from 'lucide-react';

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, register } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      if (isLogin) {
        await login(email, password);
        navigate('/');
      } else {
        const result = await register(email, password, name);
        setSuccess(result.message || 'Registration created. Check your email to activate your account.');
        setIsLogin(true);
        setPassword('');
      }
    } catch (err) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  // Default credentials for easy testing
  const fillDemoCredentials = () => {
    setEmail('admin@example.com');
    setPassword('admin123');
    setName('');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-full mb-4">
            <DollarSign className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Shared Expenses</h1>
          <p className="text-gray-600">Split costs fairly with your team</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-lg shadow-lg p-8">
          {/* Toggle */}
          <div className="flex gap-4 mb-6">
            <button
              onClick={() => {
                setIsLogin(true);
                setSuccess('');
              }}
              className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors ${
                isLogin
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Login
            </button>
            <button
              onClick={() => {
                setIsLogin(false);
                setSuccess('');
              }}
              className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors ${
                !isLogin
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Register
            </button>
          </div>

          {/* Error Alert */}
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          {success && (
            <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm text-green-800">{success}</p>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Full Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Loading...' : isLogin ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          {/* Demo Credentials */}
          <div className="mt-6 pt-6 border-t border-gray-200">
            <p className="text-sm text-gray-600 mb-3">Demo credentials:</p>
            <div className="space-y-2">
              <button
                onClick={fillDemoCredentials}
                className="w-full text-sm px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded text-gray-700 font-medium transition-colors text-left"
              >
                👤 Admin: admin@example.com
              </button>
              <button
                onClick={() => {
                  setEmail('usera@example.com');
                  setPassword('password123');
                  setName('');
                }}
                className="w-full text-sm px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded text-gray-700 font-medium transition-colors text-left"
              >
                👤 User A: usera@example.com
              </button>
              <button
                onClick={() => {
                  setEmail('userb@example.com');
                  setPassword('password123');
                  setName('');
                }}
                className="w-full text-sm px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded text-gray-700 font-medium transition-colors text-left"
              >
                👤 User B: userb@example.com
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-2">Password for all demo accounts: their password or admin123</p>
          </div>
        </div>
      </div>
    </div>
  );
}
