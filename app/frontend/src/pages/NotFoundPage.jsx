import React from 'react';
import { Link } from 'react-router-dom';

export const NotFoundPage = () => {
  return (
    <div className="max-w-xl mx-auto px-4 py-20 text-center space-y-5">
      <div className="font-neon text-7xl md:text-8xl font-extrabold gradient-text animate-flicker">
        404
      </div>
      <p className="text-slate-300 text-sm">
        The portal you tried to enter doesn&apos;t exist in Jaynetic Zone.
      </p>
      <Link
        to="/"
        className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-gradient-to-r from-jaynetic-purple to-jaynetic-blue hover:brightness-110 shadow-neon-purple text-sm transition-all active:scale-95"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10" />
        </svg>
        Back to Home
      </Link>
    </div>
  );
};


