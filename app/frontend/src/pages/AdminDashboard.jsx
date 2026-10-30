import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthApi } from '../api/client.js';
import { Skeleton, ErrorState, StatusBadge, PaymentBadge } from '../components/ui.jsx';

const StatCard = ({ label, value, icon, loading }) => (
  <div className="glass-card rounded-2xl p-4 flex items-center gap-4">
    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-jaynetic-purple/30 to-jaynetic-blue/20 flex items-center justify-center text-xl shrink-0">
      {icon}
    </div>
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-0.5 truncate">
        {label}
      </div>
      {loading ? (
        <Skeleton className="h-6 w-16" />
      ) : (
        <div className="text-lg font-semibold text-white truncate">{value}</div>
      )}
    </div>
  </div>
);

export const AdminDashboard = () => {
  const authApi = useAuthApi();
  const queryClient = useQueryClient();
  const [range, setRange] = useState('today');

  const { data: rates, isLoading: loadingRates } = useQuery({
    queryKey: ['rates'],
    queryFn: async () => {
      const res = await authApi.get('/rates');
      return res.data;
    }
  });

  const { data: devicesSummary, isLoading: loadingDevices } = useQuery({
    queryKey: ['devices'],
    queryFn: async () => {
      const res = await authApi.get('/devices');
      return res.data.summary;
    }
  });

  const bookingsQuery = useQuery({
    queryKey: ['admin-bookings', range],
    queryFn: async () => {
      const res = await authApi.get('/bookings', { params: { range } });
      return res.data;
    }
  });

  const { data: revenue } = useQuery({
    queryKey: ['revenue', range],
    queryFn: async () => {
      const res = await authApi.get('/bookings/revenue/summary', {
        params: { range }
      });
      return res.data;
    }
  });

  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await authApi.get('/users');
      return res.data;
    }
  });

  const sessionsQuery = useQuery({
    queryKey: ['sessions'],
    queryFn: async () => {
      const res = await authApi.get('/sessions');
      return res.data;
    }
  });

  const handleRateChange = async (type, pricePerHour) => {
    await authApi.put('/rates', { type, pricePerHour });
    queryClient.invalidateQueries(['rates']);
  };

  const handleEndSession = async (id) => {
    await authApi.put(`/sessions/${id}/end`);
    queryClient.invalidateQueries(['sessions']);
    queryClient.invalidateQueries(['devices']);
  };

  const bookings = bookingsQuery.data;
  const users = usersQuery.data;
  const sessions = sessionsQuery.data;

  return (
    <div className="max-w-6xl mx-auto px-4 py-10 space-y-8 text-xs md:text-sm">
      <header className="space-y-2">
        <h1 className="font-display text-3xl md:text-4xl">Admin Dashboard</h1>
        <p className="text-slate-300">
          Manage inventory, bookings, sessions, rates, and view revenue at a
          glance.
        </p>
      </header>

      <section className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="PS5 Consoles" value={devicesSummary?.ps5 ?? '-'} icon="🎮" loading={loadingDevices} />
        <StatCard label="Gaming PC" value={devicesSummary?.gamingPc ?? '-'} icon="🖥️" loading={loadingDevices} />
        <StatCard label="Racing Simulator" value={devicesSummary?.racingSim ?? '-'} icon="🏎️" loading={loadingDevices} />
        <StatCard
          label={`Revenue (${range})`}
          value={revenue ? `₹${revenue.totalRevenue}` : '—'}
          icon="💰"
        />
      </section>

      <section className="grid md:grid-cols-[1.4fr_1fr] gap-6">
        <div className="bg-slate-900/70 border border-white/10 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Bookings</h2>
            <select
              value={range}
              onChange={(e) => setRange(e.target.value)}
              className="rounded-md bg-black/40 border border-white/10 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-jaynetic-purple [color-scheme:dark]"
            >
              <option value="today">Today</option>
              <option value="upcoming">Upcoming</option>
              <option value="past">Past</option>
            </select>
          </div>
          {bookingsQuery.isLoading ? (
            <div className="space-y-3">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : bookingsQuery.isError ? (
            <ErrorState
              message="Couldn't load bookings."
              onRetry={() => queryClient.invalidateQueries(['admin-bookings', range])}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left border-collapse">
                <thead className="text-[11px] uppercase text-slate-400 border-b border-white/10">
                  <tr>
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">User</th>
                    <th className="py-2 pr-3">Device</th>
                    <th className="py-2 pr-3">Game</th>
                    <th className="py-2 pr-3">Amount</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Payment</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings?.map((b) => (
                    <tr key={b._id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {new Date(b.date).toLocaleDateString('en-IN')} {b.startTime}
                      </td>
                      <td className="py-2 pr-3">
                        {b.user?.name || 'Walk-in'} <br />
                        <span className="text-slate-400 text-[10px]">{b.user?.email}</span>
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {b.device?.name || b.deviceType}
                      </td>
                      <td className="py-2 pr-3 text-slate-300">{b.gameName || '—'}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">₹{b.totalAmount}</td>
                      <td className="py-2 pr-3">
                        <StatusBadge status={b.status} />
                      </td>
                      <td className="py-2 pr-3">
                        <PaymentBadge status={b.paymentStatus} />
                      </td>
                    </tr>
                  ))}
                  {!bookings?.length && (
                    <tr>
                      <td className="py-3 text-slate-400" colSpan={7}>
                        No bookings in this range.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="bg-slate-900/70 border border-white/10 rounded-2xl p-4">
            <h2 className="font-semibold mb-3">Rates</h2>
            {loadingRates ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-7 w-full" />
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {rates?.map((r) => (
                  <div key={r._id} className="flex items-center justify-between gap-2">
                    <span className="capitalize">{r.type}</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-500">₹</span>
                      <input
                        type="number"
                        defaultValue={r.pricePerHour}
                        className="w-20 rounded-md bg-black/40 border border-white/10 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-jaynetic-purple"
                        onBlur={(e) =>
                          handleRateChange(r.type, Number(e.target.value))
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-slate-900/70 border border-white/10 rounded-2xl p-4">
            <h2 className="font-semibold mb-3">
              Active Sessions{' '}
              <span className="text-[10px] text-slate-500 font-normal">
                ({sessions?.length || 0})
              </span>
            </h2>
            {sessionsQuery.isLoading ? (
              <div className="space-y-2">
                {[0, 1].map((i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : sessionsQuery.isError ? (
              <ErrorState message="Couldn't load sessions." onRetry={() => queryClient.invalidateQueries(['sessions'])} />
            ) : (
              <div className="space-y-2">
                {sessions?.map((s) => (
                  <div
                    key={s._id}
                    className="flex items-center justify-between gap-2 text-[11px] rounded-lg border border-white/5 bg-black/20 p-2"
                  >
                    <div className="min-w-0">
                      <div className="truncate">
                        {s.device?.name} (Station {s.device?.stationNumber})
                      </div>
                      <div className="text-slate-400 truncate">
                        {s.user?.name || 'Walk-in'} •{' '}
                        {new Date(s.startedAt).toLocaleTimeString('en-IN')}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleEndSession(s._id)}
                      className="px-2.5 py-1 rounded-full border border-red-400/50 text-red-300 hover:bg-red-500/10 shrink-0 transition-all"
                    >
                      End
                    </button>
                  </div>
                ))}
                {!sessions?.length && (
                  <p className="text-slate-400 text-xs">No active sessions.</p>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="bg-slate-900/70 border border-white/10 rounded-2xl p-4">
        <h2 className="font-semibold mb-3">
          Registered Users{' '}
          <span className="text-[10px] text-slate-500 font-normal">
            ({users?.length || 0})
          </span>
        </h2>
        {usersQuery.isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : usersQuery.isError ? (
          <ErrorState message="Couldn't load users." onRetry={() => queryClient.invalidateQueries(['users'])} />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left border-collapse">
              <thead className="text-[11px] uppercase text-slate-400 border-b border-white/10">
                <tr>
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Email</th>
                  <th className="py-2 pr-3">Role</th>
                  <th className="py-2 pr-3">Joined</th>
                </tr>
              </thead>
              <tbody>
                {users?.map((u) => (
                  <tr key={u._id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                    <td className="py-2 pr-3">{u.name}</td>
                    <td className="py-2 pr-3">{u.email}</td>
                    <td className="py-2 pr-3 capitalize">{u.role}</td>
                    <td className="py-2 pr-3">
                      {new Date(u.createdAt).toLocaleDateString('en-IN')}
                    </td>
                  </tr>
                ))}
                {!users?.length && (
                  <tr>
                    <td className="py-3 text-slate-400" colSpan={4}>
                      No users yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
