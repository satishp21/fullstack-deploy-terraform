import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { api, useAuthApi } from '../api/client.js';
import { useAuth } from '../state/AuthContext.jsx';
import { Link } from 'react-router-dom';
import { Modal, Spinner, Badge } from '../components/ui.jsx';

const DEVICE_TYPES = [
  { value: 'ps5', label: 'PS5 Console', icon: '🎮', count: 5, description: 'Next-gen console with comfy couch setup' },
  { value: 'gaming-pc', label: 'Gaming PC', icon: '🖥️', count: 1, description: 'High-end RGB rig for competitive play' },
  { value: 'racing-sim', label: 'Racing Simulator', icon: '🏎️', count: 1, description: 'Immersive racing sim setup' }
];

const OPENING_HOUR = 12;
const CLOSING_HOUR = 24;
const ALL_HOURS = Array.from(
  { length: CLOSING_HOUR - OPENING_HOUR },
  (_, i) => `${(OPENING_HOUR + i).toString().padStart(2, '0')}:00`
);

const getLocalDate = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatTime12hFull = (hhmm) => {
  if (!hhmm) return '';
  const h = parseInt(hhmm.split(':')[0], 10);
  if (h === 24) return '12:00 AM (midnight)';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:00 ${h >= 12 && h < 24 ? 'PM' : 'AM'}`;
};

const formatTime12h = (t) => {
  const hour = parseInt(t.split(':')[0], 10);
  const h12 = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  const ampm = hour >= 12 ? 'PM' : 'AM';
  return `${h12}:00 ${ampm}`;
};

const loadRazorpay = () =>
  new Promise((resolve, reject) => {
    if (window.Razorpay) {
      resolve(window.Razorpay);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(window.Razorpay);
    script.onerror = () => reject(new Error('Failed to load Razorpay SDK'));
    document.body.appendChild(script);
  });

export const BookingPage = () => {
  const { isAuthenticated, user } = useAuth();
  const authApi = useAuthApi();
  const queryClient = useQueryClient();

  const [selectedType, setSelectedType] = useState('ps5');
  const [selectedDate, setSelectedDate] = useState(getLocalDate);
  const [fromTime, setFromTime] = useState('');
  const [toTime, setToTime] = useState('');
  const [gameName, setGameName] = useState('');
  const [bookingSuccess, setBookingSuccess] = useState(null);
  const [bookingError, setBookingError] = useState('');
  const [payMode, setPayMode] = useState('full');
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [payProcessing, setPayProcessing] = useState(false);
  const [payError, setPayError] = useState('');
  const [paySuccess, setPaySuccess] = useState(null);

  const { data: availability, isLoading: loadingSlots, isError: slotsError, refetch: refetchSlots } = useQuery({
    queryKey: ['availability', selectedType, selectedDate],
    queryFn: async () => {
      const res = await api.get('/bookings/availability', {
        params: { deviceType: selectedType, date: selectedDate }
      });
      return res.data;
    },
    enabled: Boolean(selectedType && selectedDate)
  });

  const { data: rates } = useQuery({
    queryKey: ['rates'],
    queryFn: async () => {
      const res = await api.get('/rates');
      return res.data;
    }
  });

  const rateMap = useMemo(
    () =>
      rates?.reduce((acc, r) => {
        acc[r.type] = r.pricePerHour;
        return acc;
      }, {}) || {},
    [rates]
  );

  const durationHours = fromTime && toTime
    ? parseInt(toTime) - parseInt(fromTime)
    : 0;
  const currentRate = rateMap[selectedType] || 0;
  const totalAmount = currentRate * durationHours;

  const toOptions = fromTime
    ? Array.from({ length: Math.min(6, 24 - parseInt(fromTime)) }, (_, i) => {
        const h = parseInt(fromTime) + i + 1;
        return h === 24 ? '24:00' : `${h.toString().padStart(2, '0')}:00`;
      })
    : [];

  const isRangeAvailable = () => {
    if (!availability?.slots || !fromTime || !toTime) return false;
    const from = parseInt(fromTime);
    const to = parseInt(toTime);
    for (let h = from; h < to; h++) {
      const slotTime = `${h.toString().padStart(2, '0')}:00`;
      const slot = availability.slots.find((s) => s.startTime === slotTime);
      if (!slot || !slot.available) return false;
    }
    return true;
  };

  const bookMutation = useMutation({
    mutationFn: async (payload) => {
      const res = await authApi.post('/bookings', payload);
      return res.data;
    },
    onSuccess: (data) => {
      setBookingSuccess(data);
      setBookingError('');
      setFromTime('');
      setToTime('');
      setGameName('');
      queryClient.invalidateQueries(['availability', selectedType, selectedDate]);
      queryClient.invalidateQueries(['my-bookings']);
    },
    onError: (err) => {
      setBookingError(
        err.response?.data?.message ||
          err.response?.data?.errors?.[0]?.msg ||
          'Booking failed. Please try again.'
      );
      setBookingSuccess(null);
    }
  });

  const handleBook = () => {
    if (!fromTime || !toTime) return;
    setBookingError('');
    setBookingSuccess(null);
    bookMutation.mutate({
      deviceType: selectedType,
      date: selectedDate,
      startTime: fromTime,
      durationHours,
      gameName: gameName.trim() || undefined
    });
  };

  const handlePay = async (mode) => {
    setPayMode(mode);
    setPayProcessing(true);
    setPayError('');
    setPaySuccess(null);
    try {
      const booking = bookingSuccess;
      if (!booking) throw new Error('No booking to pay for');

      const orderRes = await authApi.post('/payments/order', {
        bookingId: booking._id,
        mode
      });
      const { key, order } = orderRes.data;

      const Razorpay = await loadRazorpay();

      const options = {
        key,
        amount: order.amount,
        currency: order.currency || 'INR',
        name: 'Jaynetic Zone',
        description: `${booking.deviceType} booking • ${formatTime12h(booking.startTime)} on ${new Date(booking.date).toLocaleDateString('en-IN')}`,
        order_id: order.id,
        prefill: {
          name: user?.name || '',
          email: user?.email || '',
          contact: user?.phone || ''
        },
        theme: { color: '#7c3aed' },
        handler: async (response) => {
          setPayProcessing(true);
          try {
            const verifyRes = await authApi.post('/payments/verify', {
              bookingId: booking._id,
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature
            });
            setPaySuccess(verifyRes.data.booking);
            setPayError('');
            queryClient.invalidateQueries(['my-bookings']);
          } catch (err) {
            setPayError(
              err.response?.data?.message || 'Payment verification failed. Please contact us.'
            );
          } finally {
            setPayProcessing(false);
          }
        },
        modal: {
          ondismiss: () => setPayProcessing(false)
        }
      };

      const rzp = new Razorpay(options);
      rzp.on('payment.failed', (resp) => {
        setPayError(
          resp.error?.description || 'Payment failed. Please try again or pay at the counter.'
        );
        setPayProcessing(false);
      });
      rzp.open();
      setPayProcessing(false);
    } catch (err) {
      setPayError(err.message || 'Unable to start payment. Please try again or pay at the counter.');
      setPayProcessing(false);
    }
  };

  const selectedDeviceInfo = DEVICE_TYPES.find((d) => d.value === selectedType);
  const minDate = getLocalDate();

  return (
    <div className="max-w-6xl mx-auto px-4 py-10 space-y-8">
      <h1 className="sr-only">Book Your Gaming Session</h1>

      {!isAuthenticated && (
        <div className="bg-yellow-800/30 border border-yellow-500/30 rounded-xl p-4 text-sm text-yellow-200 flex items-center gap-3">
          <span className="text-2xl">🔒</span>
          <div>
            You need to{' '}
            <Link to="/login" className="underline text-yellow-100">
              login
            </Link>{' '}
            or{' '}
            <Link to="/register" className="underline text-yellow-100">
              register
            </Link>{' '}
            to book a slot. Browsing availability is free!
          </div>
        </div>
      )}

      {/* Step 1: Choose Device Type */}
      <section>
        <h2 className="font-display text-xl md:text-2xl mb-4">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-jaynetic-purple text-sm mr-2">
            1
          </span>
          Choose System
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {DEVICE_TYPES.map((dt) => (
            <button
              key={dt.value}
              onClick={() => {
                setSelectedType(dt.value);
                setFromTime('');
                setToTime('');
                setBookingSuccess(null);
                setBookingError('');
              }}
              className={`relative text-left rounded-xl border p-4 transition-all hover:border-jaynetic-purple/60 ${
                selectedType === dt.value
                  ? 'border-jaynetic-purple bg-jaynetic-purple/20 shadow-lg shadow-jaynetic-purple/30'
                  : 'border-white/10 bg-slate-900/70'
              }`}
            >
              <div className="text-3xl mb-2">{dt.icon}</div>
              <h3 className="font-semibold text-base">{dt.label}</h3>
              <p className="text-xs text-slate-300 mt-1">{dt.description}</p>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs text-slate-400">
                  {dt.count} available
                </span>
                <span className="text-sm font-semibold text-jaynetic-blue">
                  ₹{rateMap[dt.value] || '—'}/hr
                </span>
              </div>
              {selectedType === dt.value && (
                <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-jaynetic-purple flex items-center justify-center">
                  <svg
                    className="w-3 h-3 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={3}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
              )}
            </button>
          ))}
        </div>
      </section>

      {/* Step 2: Choose Date */}
      <section>
        <h2 className="font-display text-xl md:text-2xl mb-4">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-jaynetic-purple text-sm mr-2">
            2
          </span>
          Pick a Date
        </h2>
        <input
          type="date"
          value={selectedDate}
          min={minDate}
          onChange={(e) => {
            setSelectedDate(e.target.value);
            setFromTime('');
            setToTime('');
            setBookingSuccess(null);
            setBookingError('');
          }}
          className="rounded-lg bg-black/40 border border-white/10 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-jaynetic-purple [color-scheme:dark]"
        />
      </section>

      {/* Step 3: Choose Time */}
      <section>
        <h2 className="font-display text-xl md:text-2xl mb-4">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-jaynetic-purple text-sm mr-2">
            3
          </span>
          Select Time
        </h2>

        {loadingSlots ? (
          <div className="flex items-center gap-2 text-sm text-slate-400 py-4">
            <Spinner className="w-5 h-5 text-jaynetic-purple" />
            Loading available slots...
          </div>
        ) : slotsError ? (
          <div className="text-sm text-red-300 bg-red-500/10 border border-red-400/20 rounded-xl p-4 flex items-center justify-between gap-4">
            <span>Couldn't load availability right now.</span>
            <button
              type="button"
              onClick={() => refetchSlots()}
              className="px-3 py-1.5 rounded-full border border-red-400/40 text-xs hover:bg-red-500/10 transition-all shrink-0"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <label className="text-xs text-slate-400 uppercase tracking-widest">From</label>
              <select
                value={fromTime}
                onChange={(e) => {
                  setFromTime(e.target.value);
                  setToTime('');
                  setBookingSuccess(null);
                  setBookingError('');
                }}
                className="rounded-lg bg-black/40 border border-white/10 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-jaynetic-purple [color-scheme:dark] min-w-[140px]"
              >
                <option value="">-- Select --</option>
                {ALL_HOURS.map((h) => {
                  const slot = availability?.slots?.find((s) => s.startTime === h);
                  const available = slot ? slot.available : false;
                  return (
                    <option key={h} value={h} disabled={!available}>
                      {formatTime12hFull(h)}{!available ? ' (booked)' : ''}
                    </option>
                  );
                })}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-slate-400 uppercase tracking-widest">To</label>
              <select
                value={toTime}
                onChange={(e) => {
                  setToTime(e.target.value);
                  setBookingSuccess(null);
                  setBookingError('');
                }}
                disabled={!fromTime}
                className="rounded-lg bg-black/40 border border-white/10 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-jaynetic-purple [color-scheme:dark] min-w-[140px] disabled:opacity-40"
              >
                <option value="">-- Select --</option>
                {toOptions.map((h) => (
                  <option key={h} value={h}>
                    {formatTime12hFull(h)}
                  </option>
                ))}
              </select>
            </div>

            {durationHours > 0 && (
              <div className="text-sm bg-slate-900/70 border border-white/10 rounded-xl px-4 py-2">
                <span className="text-slate-400">{durationHours} hr{durationHours > 1 ? 's' : ''} &nbsp;•&nbsp; </span>
                <span className="text-jaynetic-blue font-semibold">₹{totalAmount}</span>
              </div>
            )}
          </div>
        )}

        {fromTime && toTime && !isRangeAvailable() && (
          <p className="mt-3 text-sm text-red-400">This time range is not fully available. Please choose a different time.</p>
        )}
      </section>

      {/* Step 4: Confirm */}
      {fromTime && toTime && isRangeAvailable() && (
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-slate-900/70 border border-white/10 rounded-2xl p-6 space-y-4"
        >
          <h2 className="font-display text-xl md:text-2xl">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-jaynetic-purple text-sm mr-2">
              4
            </span>
            Confirm Booking
          </h2>

          <div>
            <label className="block text-slate-300 text-sm mb-1">
              Game Name <span className="text-slate-500">(optional)</span>
            </label>
            <input
              type="text"
              value={gameName}
              onChange={(e) => setGameName(e.target.value)}
              maxLength={100}
              placeholder="e.g. FIFA 24, GTA V, Valorant, Fortnite..."
              className="w-full max-w-md rounded-lg bg-black/40 border border-white/10 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-jaynetic-purple"
            />
          </div>

          <div className="bg-black/30 rounded-xl p-4 space-y-2 text-sm max-w-md">
            <div className="flex justify-between">
              <span className="text-slate-400">System</span>
              <span>
                {selectedDeviceInfo?.icon} {selectedDeviceInfo?.label}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Date</span>
              <span>
                {new Date(selectedDate).toLocaleDateString('en-IN', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric'
                })}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Time</span>
              <span>
                {formatTime12hFull(fromTime)} – {formatTime12hFull(toTime)} ({durationHours} hr{durationHours > 1 ? 's' : ''})
              </span>
            </div>
            {gameName.trim() && (
              <div className="flex justify-between">
                <span className="text-slate-400">Game</span>
                <span>{gameName.trim()}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-white/10 pt-2 font-semibold text-base">
              <span>Total</span>
              <span className="text-jaynetic-blue">₹{totalAmount}</span>
            </div>
          </div>

          {bookingError && (
            <p className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg p-3">
              {bookingError}
            </p>
          )}

          {bookingSuccess && (
            <div className="text-emerald-400 text-sm bg-emerald-400/10 border border-emerald-400/20 rounded-lg p-4 space-y-1">
              <p className="font-semibold">Booking Confirmed!</p>
              <p>
                Your {selectedDeviceInfo?.label} session is booked for{' '}
                {formatTime12h(bookingSuccess.startTime)} on{' '}
                {new Date(bookingSuccess.date).toLocaleDateString('en-IN')}.
              </p>
              <p className="text-xs text-emerald-300">
                Booking ID: {bookingSuccess._id} • Station:{' '}
                {bookingSuccess.device?.stationNumber || 'Assigned'}
              </p>
              {bookingSuccess.notificationSent === false && (
                <p className="text-xs text-amber-300">
                  Your booking is confirmed, but we couldn't email the venue.
                  Please call +91-87581-73436 to confirm your session.
                </p>
              )}
              <div className="pt-2 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setPayModalOpen(true);
                    setPayError('');
                    setPaySuccess(null);
                  }}
                  disabled={paySuccess || bookingSuccess.paymentStatus === 'paid'}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-gradient-to-r from-jaynetic-purple to-jaynetic-blue text-xs font-semibold hover:brightness-110 shadow-neon-purple transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  💳 Pay Online
                </button>
                {bookingSuccess.paymentStatus === 'paid' && (
                  <Badge tone="success">Payment received ✓</Badge>
                )}
              </div>
            </div>
          )}

          {isAuthenticated ? (
            <button
              type="button"
              onClick={handleBook}
              disabled={bookMutation.isPending || Boolean(bookingSuccess)}
              className={`inline-flex items-center px-8 py-3 rounded-full text-sm font-medium shadow-lg transition-all ${
                bookMutation.isPending || bookingSuccess
                  ? 'bg-slate-600 cursor-not-allowed'
                  : 'bg-gradient-to-r from-jaynetic-purple to-jaynetic-blue shadow-jaynetic-purple/40 hover:shadow-jaynetic-purple/60'
              }`}
            >
              {bookMutation.isPending ? (
                <>
                  <Spinner className="-ml-1 mr-2 h-4 w-4" />
                  Booking...
                </>
              ) : bookingSuccess ? (
                'Booked ✓'
              ) : (
                'Confirm Booking'
              )}
            </button>
          ) : (
            <Link
              to="/login"
              className="inline-flex items-center px-8 py-3 rounded-full bg-gradient-to-r from-jaynetic-purple to-jaynetic-blue text-sm font-medium shadow-lg shadow-jaynetic-purple/40"
            >
              Login to Book
            </Link>
          )}

          <p className="text-[11px] text-slate-400">
            You can also pay at the counter when you arrive.
          </p>
        </motion.section>
      )}

      {/* Payment Modal */}
      <Modal
        open={payModalOpen}
        onClose={() => {
          if (!payProcessing) setPayModalOpen(false);
        }}
        title="Pay for your booking"
      >
        {paySuccess ? (
          <div className="space-y-3 text-center py-2">
            <div className="text-4xl">🎉</div>
            <p className="text-emerald-400 font-semibold">Payment Successful!</p>
            <p className="text-xs text-slate-400">
              Your booking is now confirmed. See you at the arena!
            </p>
            <button
              type="button"
              onClick={() => setPayModalOpen(false)}
              className="w-full py-2.5 rounded-full bg-gradient-to-r from-jaynetic-purple to-jaynetic-blue text-sm"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="text-xs text-slate-400 mb-1">Amount due</p>
              <p className="font-neon text-3xl font-bold text-jaynetic-blue">
                ₹{bookingSuccess?.totalAmount || totalAmount}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => handlePay('full')}
                disabled={payProcessing}
                className={`rounded-xl border p-4 text-left transition-all hover:border-jaynetic-purple/60 ${
                  payMode === 'full' ? 'border-jaynetic-purple bg-jaynetic-purple/15' : 'border-white/10 bg-slate-900/70'
                }`}
              >
                <div className="text-sm font-semibold">Pay Full</div>
                <div className="text-xs text-slate-400 mt-1">
                  ₹{bookingSuccess?.totalAmount || totalAmount} now
                </div>
              </button>
              <button
                type="button"
                onClick={() => handlePay('partial')}
                disabled={payProcessing}
                className={`rounded-xl border p-4 text-left transition-all hover:border-jaynetic-purple/60 ${
                  payMode === 'partial' ? 'border-jaynetic-purple bg-jaynetic-purple/15' : 'border-white/10 bg-slate-900/70'
                }`}
              >
                <div className="text-sm font-semibold">50% Advance</div>
                <div className="text-xs text-slate-400 mt-1">
                  ₹{Math.round((bookingSuccess?.totalAmount || totalAmount) * 0.5)} now
                </div>
              </button>
            </div>

            {payError && (
              <p className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg p-3">
                {payError}
              </p>
            )}

            {payProcessing && (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Spinner className="w-4 h-4 text-jaynetic-purple" />
                Processing payment...
              </div>
            )}

            <button
              type="button"
              onClick={() => handlePay(payMode)}
              disabled={payProcessing}
              className="w-full py-3 rounded-full bg-gradient-to-r from-jaynetic-purple to-jaynetic-blue text-sm font-semibold hover:brightness-110 shadow-neon-purple transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {payProcessing ? 'Starting checkout...' : `Pay ₹${Math.round((bookingSuccess?.totalAmount || totalAmount) * (payMode === 'partial' ? 0.5 : 1))}`}
            </button>

            <p className="text-[11px] text-slate-500 text-center">
              Powered by Razorpay • UPI, cards, netbanking & wallets accepted
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
};
