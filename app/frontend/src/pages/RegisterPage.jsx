import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api } from '../api/client.js';
import { useAuth } from '../state/AuthContext.jsx';

export const RegisterPage = () => {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    phone: ''
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  React.useEffect(() => {
    if (isAuthenticated) navigate('/dashboard', { replace: true });
  }, [isAuthenticated, navigate]);

  const handleChange = (e) => {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    setLoading(true);
    try {
      const res = await api.post('/auth/register', form);
      login(res.data.token, res.data.user);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.response?.data?.errors?.[0]?.msg ||
          'Registration failed'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 py-16 space-y-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-jaynetic-purple to-jaynetic-blue flex items-center justify-center shadow-lg shadow-jaynetic-purple/50"
      >
        <span className="text-3xl">📝</span>
      </motion.div>
      <motion.h1
        className="font-display text-3xl md:text-4xl text-center"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        Register
      </motion.h1>

      <motion.form
        onSubmit={handleSubmit}
        className="bg-slate-900/70 border border-white/10 rounded-2xl p-6 space-y-4"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <div>
          <label className="block text-slate-300 text-sm mb-1">
            Full Name *
          </label>
          <input
            type="text"
            name="name"
            value={form.name}
            onChange={handleChange}
            required
            autoComplete="name"
            className="w-full rounded-lg bg-black/40 border border-white/10 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-jaynetic-purple"
          />
        </div>
        <div>
          <label className="block text-slate-300 text-sm mb-1">Email *</label>
          <input
            type="email"
            name="email"
            value={form.email}
            onChange={handleChange}
            required
            autoComplete="email"
            className="w-full rounded-lg bg-black/40 border border-white/10 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-jaynetic-purple"
          />
        </div>
        <div>
          <label className="block text-slate-300 text-sm mb-1">Phone</label>
          <input
            type="tel"
            name="phone"
            value={form.phone}
            onChange={handleChange}
            autoComplete="tel"
            className="w-full rounded-lg bg-black/40 border border-white/10 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-jaynetic-purple"
          />
        </div>
        <div>
          <label className="block text-slate-300 text-sm mb-1">
            Password * <span className="text-slate-500">(min 6 chars)</span>
          </label>
          <input
            type="password"
            name="password"
            value={form.password}
            onChange={handleChange}
            required
            minLength={6}
            autoComplete="new-password"
            className="w-full rounded-lg bg-black/40 border border-white/10 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-jaynetic-purple"
          />
        </div>

        {error && (
          <p className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg p-3">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className={`w-full py-3 rounded-full text-sm font-medium shadow-lg transition-all ${
            loading
              ? 'bg-slate-600 cursor-not-allowed'
              : 'bg-gradient-to-r from-jaynetic-purple to-jaynetic-blue shadow-jaynetic-purple/40'
          }`}
        >
          {loading ? 'Creating account...' : 'Create Account'}
        </button>

        <p className="text-center text-slate-400 text-xs">
          Already have an account?{' '}
          <Link to="/login" className="text-jaynetic-blue underline">
            Login
          </Link>
        </p>
      </motion.form>
    </div>
  );
};


