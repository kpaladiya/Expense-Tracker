import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { authAPI } from '../services/api';
import SiteFooter from '../components/SiteFooter';

export default function ActivateAccountPage() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState('loading');
  const [message, setMessage] = useState('Activating your account...');

  useEffect(() => {
    const token = searchParams.get('token');

    if (!token) {
      setStatus('error');
      setMessage('Activation token is missing from the link.');
      return;
    }

    authAPI.activateEmail(token)
      .then((result) => {
        setStatus('success');
        setMessage(result.message || 'Email verified successfully. You can now log in.');
      })
      .catch((error) => {
        setStatus('error');
        setMessage(error.message || 'Failed to activate account.');
      });
  }, [searchParams]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex flex-col">
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-lg shadow-lg p-8 text-center">
          {status === 'success' ? (
            <CheckCircle2 className="w-14 h-14 text-green-600 mx-auto mb-4" />
          ) : status === 'error' ? (
            <AlertCircle className="w-14 h-14 text-red-600 mx-auto mb-4" />
          ) : (
            <div className="w-14 h-14 mx-auto mb-4 rounded-full border-4 border-blue-200 border-t-blue-600 animate-spin" />
          )}

          <h1 className="text-2xl font-bold text-gray-900 mb-3">
            {status === 'success' ? 'Account activated' : status === 'error' ? 'Activation failed' : 'Activating account'}
          </h1>
          <p className="text-gray-600 mb-6">{message}</p>

          {(status === 'success' || status === 'error') && (
            <Link
              to="/login"
              className="inline-flex items-center justify-center px-5 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
            >
              Go to login
            </Link>
          )}
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
