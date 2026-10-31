import React, { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../state/AuthContext.jsx';

const baseNavLinkClass =
  'text-sm px-4 py-2.5 rounded-xl border border-transparent hover:bg-white/[0.06] transition-all duration-200';

const navLinkClass = ({ isActive }) =>
  `${baseNavLinkClass} ${
    isActive
      ? 'border-white/10 bg-white/[0.06] text-white font-medium'
      : 'text-slate-300 hover:text-white'
  }`;

const NavLinks = ({ onNavigate }) => {
  const { isAuthenticated, isAdmin } = useAuth();
  return (
    <>
      <NavLink to="/" onClick={onNavigate} className={navLinkClass}>
        Home
      </NavLink>
      <NavLink to="/rates" onClick={onNavigate} className={navLinkClass}>
        Rates
      </NavLink>
      <NavLink to="/book" onClick={onNavigate} className={navLinkClass}>
        Book
      </NavLink>
      {isAuthenticated && (
        <NavLink to="/dashboard" onClick={onNavigate} className={navLinkClass}>
          Dashboard
        </NavLink>
      )}
      {isAdmin && (
        <NavLink to="/admin" onClick={onNavigate} className={navLinkClass}>
          Admin
        </NavLink>
      )}
    </>
  );
};

const ScrollToTopButton = () => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 600);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          type="button"
          aria-label="Scroll to top"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-6 right-6 z-40 w-11 h-11 rounded-full bg-gradient-to-br from-jaynetic-purple to-jaynetic-blue text-white flex items-center justify-center shadow-neon-purple hover:brightness-110 transition-all"
          initial={{ opacity: 0, y: 20, scale: 0.8 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.8 }}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        </motion.button>
      )}
    </AnimatePresence>
  );
};

export const Layout = ({ children }) => {
  const { isAuthenticated, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  return (
    <div className="min-h-screen flex flex-col jaynetic-gradient relative">
      <header className="sticky top-0 z-40 border-b border-white/[0.08] bg-[#070a13]/85 shadow-[0_8px_30px_rgba(0,0,0,0.2)] backdrop-blur-2xl">
        <div className="max-w-7xl mx-auto px-4 py-3.5 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5 group">
            <div className="w-10 h-10 rounded-xl overflow-hidden border border-white/10 shadow-neon-purple group-hover:scale-105 transition-transform">
              <img src="/images/l3.png" alt="Jaynetic Zone Logo" className="w-full h-full object-cover" />
            </div>
            <div className="leading-tight">
              <div className="font-neon text-sm md:text-base font-semibold tracking-[0.16em] text-transparent bg-clip-text bg-gradient-to-r from-jaynetic-violet via-white to-jaynetic-blue">
                JAYNETIC ZONE
              </div>
              <div className="mt-0.5 text-[9px] uppercase tracking-[0.2em] text-slate-500">
                Vadodara <span className="text-jaynetic-blue/70">•</span> PS5 & PC Gaming
              </div>
            </div>
          </Link>

          <nav className="hidden lg:flex items-center gap-1">
            <NavLinks />
          </nav>

          <div className="flex items-center gap-2">
            {!isAuthenticated ? (
              <>
                <Link
                  to="/login"
                  className="hidden md:inline-flex text-xs md:text-sm px-4 py-2 rounded-xl border border-white/10 text-slate-300 hover:bg-white/[0.06] hover:border-white/20 hover:text-white transition-all"
                >
                  Login
                </Link>
                <Link
                  to="/register"
                  className="hidden md:inline-flex text-xs md:text-sm px-4 py-2 rounded-xl bg-gradient-to-r from-jaynetic-purple to-jaynetic-blue font-medium hover:brightness-110 shadow-neon-purple transition-all"
                >
                  Register
                </Link>
              </>
            ) : (
              <button
                onClick={logout}
                className="hidden md:inline-flex text-xs md:text-sm px-4 py-2 rounded-xl border border-red-400/30 text-red-300 hover:bg-red-500/10 transition-all"
              >
                Logout
              </button>
            )}

            {/* Mobile hamburger */}
            <button
              type="button"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              onClick={() => setMenuOpen((o) => !o)}
              className="lg:hidden w-10 h-10 rounded-xl border border-white/10 bg-white/[0.03] flex flex-col items-center justify-center gap-1.5 hover:bg-white/[0.08] transition-colors"
            >
              <span
                className={`block h-0.5 w-5 bg-white rounded transition-all duration-300 ${
                  menuOpen ? 'rotate-45 translate-y-2' : ''
                }`}
              />
              <span
                className={`block h-0.5 w-5 bg-white rounded transition-all duration-300 ${
                  menuOpen ? 'opacity-0' : ''
                }`}
              />
              <span
                className={`block h-0.5 w-5 bg-white rounded transition-all duration-300 ${
                  menuOpen ? '-rotate-45 -translate-y-2' : ''
                }`}
              />
            </button>
          </div>
        </div>

        {/* Mobile drawer */}
        <AnimatePresence>
          {menuOpen && (
            <motion.div
              className="lg:hidden absolute inset-x-0 top-full border-b border-white/10 bg-jaynetic-bg/95 backdrop-blur-xl shadow-2xl shadow-black/60"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="px-4 py-4 flex flex-col gap-1">
                <NavLinks onNavigate={() => setMenuOpen(false)} />
                <div className="border-t border-white/10 my-2" />
                {!isAuthenticated ? (
                  <div className="flex gap-2">
                    <Link
                      to="/login"
                      onClick={() => setMenuOpen(false)}
                      className="flex-1 text-center px-4 py-2.5 rounded-full border border-white/25 hover:bg-white/10 text-sm"
                    >
                      Login
                    </Link>
                    <Link
                      to="/register"
                      onClick={() => setMenuOpen(false)}
                      className="flex-1 text-center px-4 py-2.5 rounded-full bg-gradient-to-r from-jaynetic-purple to-jaynetic-blue text-sm"
                    >
                      Register
                    </Link>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      logout();
                      setMenuOpen(false);
                    }}
                    className="w-full px-4 py-2.5 rounded-full border border-red-400/50 text-red-300 hover:bg-red-500/10 text-sm"
                  >
                    Logout
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-white/10 bg-black/60 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 py-10 grid gap-8 md:grid-cols-3">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg overflow-hidden">
                <img src="/images/l3.png" alt="Jaynetic Zone Logo" className="w-full h-full object-cover" />
              </div>
              <span className="font-neon text-sm tracking-[0.2em]">JAYNETIC ZONE</span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed max-w-xs">
              A high-energy, anime-inspired gaming arena in Vadodara. PS5 consoles,
              high-end PCs and a racing simulator — play by the hour.
            </p>
          </div>

          <div>
            <h3 className="font-display text-sm uppercase tracking-widest text-slate-200 mb-3">
              Quick Links
            </h3>
            <ul className="space-y-2 text-xs text-slate-400">
              <li>
                <Link to="/rates" className="hover:text-jaynetic-blue transition-colors">
                  Hourly Rates
                </Link>
              </li>
              <li>
                <Link to="/book" className="hover:text-jaynetic-blue transition-colors">
                  Book a Slot
                </Link>
              </li>
              <li>
                <Link to="/dashboard" className="hover:text-jaynetic-blue transition-colors">
                  My Dashboard
                </Link>
              </li>
              <li>
                <Link to="/login" className="hover:text-jaynetic-blue transition-colors">
                  Login / Register
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="font-display text-sm uppercase tracking-widest text-slate-200 mb-3">
              Reach Us
            </h3>
            <ul className="space-y-2 text-xs text-slate-400">
              <li>
                <a href="tel:+918758173436" className="hover:text-jaynetic-blue transition-colors">
                  📞 +91-87581-73436
                </a>
              </li>
              <li>
                <a
                  href="mailto:jayneticplays88@gmail.com"
                  className="hover:text-jaynetic-blue transition-colors break-all"
                >
                  ✉️ jayneticplays88@gmail.com
                </a>
              </li>
              <li>📍 Vadodara, Gujarat, India</li>
              <li>🕒 Open daily • Walk-ins welcome</li>
            </ul>
          </div>
        </div>
        <div className="border-t border-white/10">
          <div className="max-w-7xl mx-auto px-4 py-4 text-[11px] text-slate-500 flex flex-col md:flex-row items-center justify-between gap-2">
            <span>© {new Date().getFullYear()} Jaynetic Zone, Vadodara.</span>
            <span>Unleash your inner gamer. PS5 • High-end PC • Anime vibes.</span>
          </div>
        </div>
      </footer>

      <ScrollToTopButton />
    </div>
  );
};
