import React, { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthApi } from '../api/client.js';
import { useAuth } from '../state/AuthContext.jsx';
import { Skeleton, ErrorState, EmptyState, Modal, Spinner, StatusBadge, PaymentBadge } from '../components/ui.jsx';

const formatTime12h = (t) => {
  if (!t) return '';
  const hour = parseInt(t.split(':')[0], 10);
  const h12 = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  const ampm = hour >= 12 ? 'PM' : 'AM';
  return `${h12}:00 ${ampm}`;
};

export const UserDashboard = () => {
  const authApi = useAuthApi();
  const queryClient = useQueryClient();
  const { user, updateUser } = useAuth();

  const sessionQuery = useQuery({
    queryKey: ['my-session'],
    queryFn: async () => {
      const res = await authApi.get('/sessions/me');
      return res.data;
    }
  });

  const bookingsQuery = useQuery({
    queryKey: ['my-bookings'],
    queryFn: async () => {
      const res = await authApi.get('/bookings/me');
      return res.data;
    }
  });

  const [remaining, setRemaining] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileForm, setProfileForm] = useState({ name: '', phone: '' });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileMsg, setProfileMsg] = useState('');

  useEffect(() => {
    if (user && !profileForm.name) {
      setProfileForm({ name: user.name || '', phone: user.phone || '' });
    }
  }, [user, profileForm.name]);

  useEffect(() => {
    if (!sessionQuery.data?.endsAt) {
      setRemaining('');
      return;
    }
    const interval = setInterval(() => {
      const end = new Date(sessionQuery.data.endsAt);
      const now = new Date();
      const diffMs = end.getTime() - now.getTime();
      if (diffMs <= 0) {
        setRemaining('00:00:00');
        clearInterval(interval);
        queryClient.invalidateQueries(['my-session']);
        return;
      }
      const totalSeconds = Math.floor(diffMs / 1000);
      const h = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
      const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
      const s = String(totalSeconds % 60).padStart(2, '0');
      setRemaining(`${h}:${m}:${s}`);
    }, 1000);
    return () => clearInterval(interval);
  }, [sessionQuery.data, queryClient]);

  const handleCancel = async (id) => {
    await authApi.delete(`/bookings/${id}`);
    queryClient.invalidateQueries(['my-bookings']);
  };

  const handleProfileSave = async (e) => {
    e.preventDefault();
    setProfileError('');
    setProfileMsg('');
    setProfileSaving(true);
    try {
      const res = await authApi.put('/users/me', profileForm);
      updateUser({ name: res.data.name, phone: res.data.phone });
      setProfileMsg('Profile updated ✓');
      setTimeout(() => {
        setProfileOpen(false);
        setProfileMsg('');
      }, 1200);
    } catch (err) {
      setProfileError(
        err.response?.data?.message ||
          err.response?.data?.errors?.[0]?.msg ||
          'Failed to update profile'
      );
    } finally {
      setProfileSaving(false);
    }
  };

  const activeSession = sessionQuery.data;
  const bookings = bookingsQuery.data;

  return (
    <div className="max-w-5xl mx-auto px-4 py-10 space-y-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl md:text-4xl">My Dashboard</h1>
          <p className="text-sm text-slate-300 mt-1">
            Track your active game session, upcoming bookings, and past visits.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setProfileForm({ name: user?.name || '', phone: user?.phone || '' });
            setProfileError('');
            setProfileMsg('');
            setProfileOpen(true);
          }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-white/20 hover:border-jaynetic-blue/50 hover:bg-white/5 text-sm transition-all"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          Edit Profile
        </button>
      </header>

      <section className="grid md:grid-cols-[1.2fr_1fr] gap-6">
        {/* Active Session */}
        <div className="glass-card rounded-2xl p-5 text-sm relative overflow-hidden">
          <div className="absolute inset-0 neon-grid opacity-40" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
              <h2 className="font-semibold">Active Session</h2>
            </div>
            {sessionQuery.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-6 w-28" />
              </div>
            ) : activeSession ? (
              <>
                <p className="text-slate-300">
                  Device:{' '}
                  <span className="text-slate-100">
                    {activeSession.device?.name} (Station{' '}
                    {activeSession.device?.stationNumber})
                  </span>
                </p>
                {remaining && (
                  <p className="mt-2 font-neon text-2xl text-jaynetic-blue neon-text">
                    {remaining}
                  </p>
                )}
                <p className="mt-2 text-xs text-slate-400">
                  Session started at{' '}
                  {new Date(activeSession.startedAt).toLocaleTimeString('en-IN')}.
                  Extend time at the counter and the timer will adjust.
                </p>
              </>
            ) : (
              <p className="text-slate-400 text-sm">
                No active session right now. Book a slot or walk in at the arena to
                start playing.
              </p>
            )}
          </div>
        </div>

        {/* Profile */}
        <div className="glass-card rounded-2xl p-5 text-sm">
          <h2 className="font-semibold mb-3">Profile</h2>
          <div className="flex items-center gap-4 mb-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-jaynetic-purple to-jaynetic-blue flex items-center justify-center font-neon text-xl font-bold shadow-neon-purple">
              {(user?.name || 'G').charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="font-semibold text-slate-100">{user?.name || 'Gamer'}</p>
              <p className="text-xs text-slate-400">{user?.email}</p>
              <p className="text-xs text-slate-500 mt-0.5">
                {user?.phone || 'No phone added'}
              </p>
            </div>
          </div>
          <p className="text-slate-400 text-xs leading-relaxed">
            Your account is used for online bookings and invoices. Update your name
            and phone so the arena can reach you for session starts.
          </p>
        </div>
      </section>

      {/* Bookings */}
      <section>
        <h2 className="font-display text-xl md:text-2xl mb-4">My Bookings</h2>
        {bookingsQuery.isLoading ? (
          <div className="bg-slate-900/70 border border-white/10 rounded-2xl p-4 space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : bookingsQuery.isError ? (
          <ErrorState
            message="Couldn't load your bookings."
            onRetry={() => queryClient.invalidateQueries(['my-bookings'])}
          />
        ) : !bookings?.length ? (
          <EmptyState
            icon="🎮"
            title="No bookings yet"
            desc="Once you book a slot, it will appear here. Head over to Book and reserve your first session!"
          />
        ) : (
          <div className="bg-slate-900/70 border border-white/10 rounded-2xl p-4 text-xs md:text-sm overflow-x-auto">
            <table className="min-w-full text-left border-collapse">
              <thead className="text-[11px] uppercase text-slate-400 border-b border-white/10">
                <tr>
                  <th className="py-2 pr-4">Date</th>
                  <th className="py-2 pr-4">Time</th>
                  <th className="py-2 pr-4">Device</th>
                  <th className="py-2 pr-4">Game</th>
                  <th className="py-2 pr-4">Amount</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Payment</th>
                  <th className="py-2 pr-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b._id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                    <td className="py-2.5 pr-4 whitespace-nowrap">
                      {new Date(b.date).toLocaleDateString('en-IN')}
                    </td>
                    <td className="py-2.5 pr-4 whitespace-nowrap">
                      {formatTime12h(b.startTime)} ({b.durationHours}h)
                    </td>
                    <td className="py-2.5 pr-4 whitespace-nowrap">
                      {b.device?.name || b.deviceType}
                    </td>
                    <td className="py-2.5 pr-4 text-slate-300">{b.gameName || '—'}</td>
                    <td className="py-2.5 pr-4 whitespace-nowrap">₹{b.totalAmount}</td>
                    <td className="py-2.5 pr-4">
                      <StatusBadge status={b.status} />
                    </td>
                    <td className="py-2.5 pr-4">
                      <PaymentBadge status={b.paymentStatus} />
                    </td>
                    <td className="py-2.5 pr-4">
                      <div className="flex flex-wrap gap-1.5 items-center">
                        {(b.status === 'pending' || b.status === 'confirmed') && (
                          <button
                            type="button"
                            onClick={() => handleCancel(b._id)}
                            className="px-2.5 py-1 rounded-full border border-red-400/40 text-red-300 hover:bg-red-500/10 text-[11px]"
                          >
                            Cancel
                          </button>
                        )}
                        {b.status !== 'cancelled' && b.paymentStatus !== 'paid' && (
                          <a
                            href={`/book?pay=${b._id}`}
                            onClick={(e) => e.preventDefault()}
                            className="px-2.5 py-1 rounded-full border border-amber-400/40 text-amber-300 hover:bg-amber-500/10 text-[11px]"
                            title="Pay at the counter or online during booking"
                          >
                            Unpaid
                          </a>
                        )}
                        <a
                          href={
                            (import.meta.env.VITE_API_BASE_URL ||
                              '/api') +
                            `/bookings/${b._id}/invoice`
                          }
                          className="px-2.5 py-1 rounded-full border border-white/20 hover:bg-white/10 text-[11px]"
                        >
                          Invoice
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Profile Edit Modal */}
      <Modal open={profileOpen} onClose={() => setProfileOpen(false)} title="Edit Profile">
        <form onSubmit={handleProfileSave} className="space-y-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Full Name</label>
            <input
              type="text"
              value={profileForm.name}
              onChange={(e) => setProfileForm((f) => ({ ...f, name: e.target.value }))}
              required
              className="w-full rounded-lg bg-black/40 border border-white/10 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-jaynetic-purple"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Phone</label>
            <input
              type="tel"
              value={profileForm.phone}
              onChange={(e) => setProfileForm((f) => ({ ...f, phone: e.target.value }))}
              placeholder="+91 XXXXX XXXXX"
              className="w-full rounded-lg bg-black/40 border border-white/10 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-jaynetic-purple"
            />
          </div>
          {profileError && (
            <p className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg p-3">
              {profileError}
            </p>
          )}
          {profileMsg && (
            <p className="text-emerald-400 text-xs bg-emerald-500/10 border border-emerald-400/20 rounded-lg p-3">
              {profileMsg}
            </p>
          )}
          <button
            type="submit"
            disabled={profileSaving}
            className="w-full py-3 rounded-full bg-gradient-to-r from-jaynetic-purple to-jaynetic-blue text-sm font-semibold hover:brightness-110 shadow-neon-purple transition-all active:scale-95 disabled:opacity-50"
          >
            {profileSaving ? (
              <span className="inline-flex items-center gap-2">
                <Spinner className="w-4 h-4" /> Saving...
              </span>
            ) : (
              'Save Changes'
            )}
          </button>
        </form>
      </Modal>
    </div>
  );
};
