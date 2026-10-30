import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export const Spinner = ({ className = 'w-5 h-5' }) => (
  <svg className={`animate-spin ${className}`} viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

export const Skeleton = ({ className = '' }) => (
  <div className={`animate-pulse rounded-lg bg-white/[0.06] ${className}`} />
);

export const Badge = ({ children, tone = 'neutral' }) => {
  const tones = {
    neutral: 'bg-slate-500/15 text-slate-300 border-white/10',
    success: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/20',
    warning: 'bg-amber-500/15 text-amber-300 border-amber-400/20',
    danger: 'bg-red-500/15 text-red-300 border-red-400/20',
    info: 'bg-jaynetic-blue/15 text-cyan-300 border-jaynetic-blue/30',
    purple: 'bg-jaynetic-purple/20 text-violet-200 border-jaynetic-purple/40'
  };
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] uppercase tracking-wider font-semibold ${tones[tone] || tones.neutral}`}
    >
      {children}
    </span>
  );
};

export const StatusBadge = ({ status }) => {
  const map = {
    confirmed: ['success', 'Confirmed'],
    pending: ['warning', 'Pending'],
    cancelled: ['danger', 'Cancelled'],
    completed: ['info', 'Completed']
  };
  const [tone, label] = map[status] || ['neutral', status];
  return <Badge tone={tone}>{label}</Badge>;
};

export const PaymentBadge = ({ status }) => {
  const map = {
    paid: ['success', 'Paid'],
    partial: ['warning', 'Partial'],
    unpaid: ['danger', 'Unpaid'],
    refunded: ['neutral', 'Refunded']
  };
  const [tone, label] = map[status] || ['neutral', status || 'Unpaid'];
  return <Badge tone={tone}>{label}</Badge>;
};

export const ErrorState = ({ message = 'Something went wrong', onRetry }) => (
  <div className="rounded-2xl border border-red-400/20 bg-red-500/5 p-6 text-center space-y-3">
    <div className="text-2xl">⚠️</div>
    <p className="text-sm text-red-300">{message}</p>
    {onRetry && (
      <button
        type="button"
        onClick={onRetry}
        className="px-4 py-2 rounded-full border border-red-400/40 text-xs text-red-200 hover:bg-red-500/10 transition-all"
      >
        Try again
      </button>
    )}
  </div>
);

export const EmptyState = ({ icon = '🎮', title = 'Nothing here yet', desc = 'Once you add something, it will show up here.' }) => (
  <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-10 text-center space-y-2">
    <div className="text-3xl">{icon}</div>
    <h3 className="font-display text-lg tracking-wide">{title}</h3>
    <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">{desc}</p>
  </div>
);

export const Modal = ({ open, onClose, title, children, wide = false }) => (
  <AnimatePresence>
    {open && (
      <motion.div
        className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/70 backdrop-blur-sm p-0 md:p-6"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          onClick={(e) => e.stopPropagation()}
          className={`w-full max-h-[90vh] overflow-y-auto rounded-t-3xl md:rounded-2xl border border-white/10 bg-jaynetic-bg shadow-2xl shadow-jaynetic-purple/20 ${
            wide ? 'max-w-3xl' : 'max-w-md'
          }`}
          initial={{ opacity: 0, y: 40, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 40, scale: 0.98 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
            <h2 className="font-display text-lg tracking-wide">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors text-slate-300"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="px-6 py-5">{children}</div>
        </motion.div>
      </motion.div>
    )}
  </AnimatePresence>
);
