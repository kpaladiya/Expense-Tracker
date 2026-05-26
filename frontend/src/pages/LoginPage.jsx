import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../services/AuthContext';
import { DollarSign, AlertCircle } from 'lucide-react';
import SiteFooter from '../components/SiteFooter';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const GOOGLE_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, googleLogin } = useAuth();
  const searchParams = new URLSearchParams(window.location.search);
  const mobileReturnUrl = searchParams.get('returnUrl') || '';
  const mobileMode = searchParams.get('mobile') === '1' && isAllowedMobileReturnUrl(mobileReturnUrl);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const googleButtonRef = useRef(null);

  const finalizeLogin = (authData) => {
    if (!mobileMode) {
      navigate('/');
      return;
    }

    if (!authData?.token) {
      setError('No mobile token was returned.');
      return;
    }

    const destination = new URL(mobileReturnUrl);
    destination.searchParams.set('token', authData.token);
    window.location.assign(destination.toString());
  };

  const exchangeMobileGoogleCredential = async (credential) => {
    const response = await fetch(`${window.location.origin}/api/auth/google`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ credential })
    });

    const result = await response.json().catch(() => null);

    if (!response.ok || !result?.success || !result?.data?.token) {
      throw new Error(result?.error || 'Google sign-in failed');
    }

    return result.data;
  };

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !googleButtonRef.current) {
      return undefined;
    }

    let isActive = true;

    const handleGoogleCredential = async (response) => {
      if (!response?.credential || !isActive) {
        return;
      }

      setError('');
      setLoading(true);

      try {
        const authData = mobileMode
          ? await exchangeMobileGoogleCredential(response.credential)
          : await googleLogin(response.credential);
        finalizeLogin(authData);
      } catch (err) {
        setError(err.message || 'Google sign-in failed');
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    };

    const renderGoogleButton = () => {
      if (!window.google?.accounts?.id || !googleButtonRef.current || !isActive) {
        return;
      }

      googleButtonRef.current.innerHTML = '';
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleGoogleCredential
      });
      window.google.accounts.id.renderButton(googleButtonRef.current, {
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        width: 320
      });
    };

    const existingScript = document.querySelector(`script[src="${GOOGLE_SCRIPT_SRC}"]`);
    let handleScriptLoad = null;

    if (existingScript && window.google?.accounts?.id) {
      renderGoogleButton();
    } else if (existingScript) {
      handleScriptLoad = () => renderGoogleButton();
      existingScript.addEventListener('load', handleScriptLoad);
    } else {
      const script = document.createElement('script');
      script.src = GOOGLE_SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.onload = renderGoogleButton;
      document.body.appendChild(script);
    }

    return () => {
      isActive = false;
      if (existingScript && handleScriptLoad) {
        existingScript.removeEventListener('load', handleScriptLoad);
      }
    };
  }, [googleLogin, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const authData = await login(email, password);
      finalizeLogin(authData);
    } catch (err) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex flex-col">
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-full mb-4">
              <DollarSign className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Shared Expenses</h1>
            <p className="text-gray-600">Split costs fairly with your team</p>
          </div>

          <div className="bg-white rounded-lg shadow-lg p-8">
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-gray-900">Sign in</h2>
              <p className="text-sm text-gray-600 mt-1">
                {mobileMode
                  ? 'Continue with Google to sign in and return to the mobile app.'
                  : 'Use your email and password, or continue with Google.'}
              </p>
            </div>

            {error && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}

            {!mobileMode && (
              <>
                <form onSubmit={handleSubmit} className="space-y-4">
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
                    {loading ? 'Loading...' : 'Sign In'}
                  </button>
                </form>

                <div className="my-6 flex items-center gap-3">
                  <div className="h-px flex-1 bg-gray-200" />
                  <span className="text-xs font-medium uppercase tracking-wide text-gray-400">or</span>
                  <div className="h-px flex-1 bg-gray-200" />
                </div>
              </>
            )}

            {GOOGLE_CLIENT_ID ? (
              <div className="flex justify-center">
                <div ref={googleButtonRef} className="min-h-[44px]" />
              </div>
            ) : (
              <p className="text-sm text-gray-500 text-center">
                Google sign-in is available after you set <code>VITE_GOOGLE_CLIENT_ID</code> in the frontend environment.
              </p>
            )}
          </div>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}

function isAllowedMobileReturnUrl(value) {
  if (!value) {
    return false;
  }

  try {
    const parsed = new URL(value);
    return ['sharedexpenses:', 'exp:', 'exps:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}
