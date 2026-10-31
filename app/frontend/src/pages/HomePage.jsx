import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence, useInView } from 'framer-motion';
import { Badge } from '../components/ui.jsx';

/* ═══════════════════════════════════════════════════
   DATA
   ═══════════════════════════════════════════════════ */
const bannerImages = [
  { src: '/images/banner-1.png', alt: 'Jaynetic Zone Banner 1' },
  { src: '/images/banner-2.png', alt: 'Jaynetic Zone Banner 2' },
  { src: '/images/banner-3.png', alt: 'Jaynetic Zone Banner 3' },
];

const galleryImages = [
  { src: '/images/img-1.jpg', alt: 'Gaming Setup 1', label: 'RGB Battlestation' },
  { src: '/images/img-2.png', alt: 'Gaming Setup 2', label: 'PS5 Lounge' },
  { src: '/images/img-3.png', alt: 'Gaming Setup 3', label: 'PC Arena' },
  { src: '/images/img-4.png', alt: 'Gaming Setup 4', label: 'Neon Zone' },
  { src: '/images/img-5.png', alt: 'Gaming Setup 5', label: 'Anime Corner' },
  { src: '/images/img-6.png', alt: 'Gaming Setup 6', label: 'Pro Setup' },
  { src: '/images/img-7.png', alt: 'Gaming Setup 7', label: 'Squad Area' },
];

const stats = [
  { value: '2', label: 'Simulator + Gaming PC', icon: '🏎️' },
  { value: '5', label: 'PS5 Consoles', icon: '🎮' },
  { value: '₹100', label: 'Per hour', icon: '⚡' },
];

const tickerItems = [
  'PS5 GAMING',
  'HIGH-END PCS',
  'RACING SIMULATOR',
  '₹100 / HOUR',
  'OPEN DAILY',
  'BOOK ONLINE',
  'WALK-INS WELCOME',
];

const services = [
  {
    title: 'PC Gaming Zone',
    desc: 'PCs with high-refresh monitors for esports titles and AAA games.',
    icon: (
      <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    title: 'PS5 Lounge',
    desc: 'Bean bag and gaming chair setup, PS5 DualSense controllers, and split screen fun for your squad.',
    icon: (
      <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    title: 'Walk-in & Online Booking',
    desc: 'Reserve your slot online or walk in – our admins can start / end sessions instantly.',
    icon: (
      <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
];

/* ═══════════════════════════════════════════════════
   HELPERS — reveal wrapper
   ═══════════════════════════════════════════════════ */
const RevealSection = ({ children, className = '', delay = 0 }) => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-80px' });
  return (
    <motion.section
      ref={ref}
      className={className}
      initial={{ opacity: 0, y: 50 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.section>
  );
};

/* ═══════════════════════════════════════════════════
   AMBIENT PARTICLES
   ═══════════════════════════════════════════════════ */
const AmbientParticles = () => {
  const particles = useMemo(
    () =>
      Array.from({ length: 30 }, (_, i) => ({
        id: i,
        size: Math.random() * 4 + 2,
        x: Math.random() * 100,
        y: Math.random() * 100,
        delay: Math.random() * 5,
        duration: Math.random() * 4 + 4,
        color:
          Math.random() > 0.5
            ? 'rgba(124, 58, 237, 0.35)'
            : 'rgba(34, 211, 238, 0.3)',
      })),
    []
  );

  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden" aria-hidden>
      {particles.map((p) => (
        <span
          key={p.id}
          className="particle"
          style={{
            width: p.size,
            height: p.size,
            left: `${p.x}%`,
            top: `${p.y}%`,
            background: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
          }}
        />
      ))}
    </div>
  );
};

/* ═══════════════════════════════════════════════════
   TICKER / MARQUEE STRIP
   ═══════════════════════════════════════════════════ */
const TickerStrip = () => {
  const doubled = [...tickerItems, ...tickerItems];
  return (
    <div className="relative overflow-hidden border-y border-jaynetic-purple/30 bg-jaynetic-purple/10 backdrop-blur-sm py-2.5 select-none">
      <div className="ticker-track gap-8 pr-8">
        {doubled.map((item, i) => (
          <span key={i} className="flex items-center gap-8 shrink-0">
            <span className="font-neon text-[11px] md:text-xs tracking-[0.25em] text-jaynetic-violet uppercase">
              {item}
            </span>
            <span className="text-jaynetic-blue">✦</span>
          </span>
        ))}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════
   HERO
   ═══════════════════════════════════════════════════ */
const Hero = () => {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-b from-jaynetic-bg/80 via-jaynetic-bg/60 to-jaynetic-bg" />
        <div className="absolute inset-0 bg-gradient-to-r from-jaynetic-bg/90 via-transparent to-jaynetic-bg/70" />
        <div className="absolute inset-0 neon-grid" />
      </div>

      <div className="relative max-w-7xl mx-auto px-4 pt-20 md:pt-28 pb-16 md:pb-24">
        <motion.p
          className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-jaynetic-blue bg-jaynetic-blue/10 border border-jaynetic-blue/30 px-4 py-1.5 rounded-full backdrop-blur-sm"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2 }}
        >
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          Vadodara • Gujarat • India
        </motion.p>

        <motion.h1
          className="mt-6 font-neon font-extrabold text-4xl md:text-6xl lg:text-7xl leading-[1.05] tracking-wide"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.7 }}
        >
          <span className="block text-white/90">UNLEASH YOUR</span>
          <span className="gradient-text animate-flicker">INNER GAMER</span>
        </motion.h1>

        <motion.p
          className="mt-6 text-slate-300 text-sm md:text-base max-w-xl leading-relaxed"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
        >
          Jaynetic Zone is a high-energy, anime-inspired gaming arena in Vadodara.
          Premium hourly gaming with PS5 consoles, high-end PCs, competitive setups,
          and a unique Demon Slayer-themed vibe.
        </motion.p>

        <motion.div
          className="mt-8 flex flex-wrap gap-4"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.65 }}
        >
          <Link
            to="/book"
            className="pulse-glow slash-hover inline-flex items-center gap-2 px-8 py-4 rounded-full bg-gradient-to-r from-jaynetic-purple to-jaynetic-blue text-sm font-semibold tracking-wide hover:brightness-110 transition-all active:scale-95 shadow-neon-purple"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Book Now
          </Link>
          <Link
            to="/rates"
            className="inline-flex items-center gap-2 px-7 py-4 rounded-full border border-white/25 backdrop-blur-sm text-sm hover:bg-white/5 hover:border-jaynetic-blue/50 transition-all active:scale-95"
          >
            View Rates
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </Link>
        </motion.div>

        {/* Hero stat chips */}
        <motion.div
          className="mt-12 grid grid-cols-3 gap-3 max-w-xl"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8 }}
        >
          {stats.map((s) => (
            <div
              key={s.label}
              className="rounded-xl border border-white/10 bg-black/30 backdrop-blur-sm p-3 text-center hover:border-jaynetic-purple/50 transition-colors"
            >
              <div className="text-xl md:text-2xl">{s.icon}</div>
              <div className="stat-value font-display text-lg md:text-xl font-semibold mt-1">
                {s.value}
              </div>
              <div className="text-[10px] md:text-[11px] text-slate-400 mt-0.5 leading-tight">
                {s.label}
              </div>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
};

/* ═══════════════════════════════════════════════════
   BANNER CAROUSEL
   ═══════════════════════════════════════════════════ */
const BannerCarousel = () => {
  const [current, setCurrent] = useState(0);
  const [progress, setProgress] = useState(0);

  const INTERVAL = 5000;

  const next = useCallback(() => {
    setCurrent((prev) => (prev + 1) % bannerImages.length);
    setProgress(0);
  }, []);

  const prev = useCallback(() => {
    setCurrent((prev) => (prev - 1 + bannerImages.length) % bannerImages.length);
    setProgress(0);
  }, []);

  useEffect(() => {
    const timer = setInterval(next, INTERVAL);
    return () => clearInterval(timer);
  }, [next]);

  useEffect(() => {
    const tick = setInterval(() => {
      setProgress((p) => Math.min(p + 100 / (INTERVAL / 50), 100));
    }, 50);
    return () => clearInterval(tick);
  }, [current]);

  return (
    <motion.div
      className="relative w-full aspect-[16/9] md:aspect-[2.4/1] rounded-3xl overflow-hidden border border-white/10 shadow-2xl shadow-jaynetic-purple/20"
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
    >
      <AnimatePresence mode="wait">
        <motion.img
          key={current}
          src={bannerImages[current].src}
          alt={bannerImages[current].alt}
          className="absolute inset-0 w-full h-full object-cover"
          initial={{ opacity: 0, scale: 1.08 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.7 }}
          loading="lazy"
        />
      </AnimatePresence>

      <div className="absolute inset-0 bg-gradient-to-t from-jaynetic-bg/90 via-jaynetic-bg/20 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-jaynetic-bg/60 via-transparent to-transparent" />

      <button
        onClick={prev}
        className="absolute left-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/40 backdrop-blur-sm border border-white/20 flex items-center justify-center hover:bg-white/10 hover:border-jaynetic-purple/50 transition-all z-10 group"
        aria-label="Previous banner"
      >
        <svg className="w-5 h-5 group-hover:text-jaynetic-blue transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
      </button>
      <button
        onClick={next}
        className="absolute right-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/40 backdrop-blur-sm border border-white/20 flex items-center justify-center hover:bg-white/10 hover:border-jaynetic-purple/50 transition-all z-10 group"
        aria-label="Next banner"
      >
        <svg className="w-5 h-5 group-hover:text-jaynetic-blue transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
      </button>

      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2.5 z-10">
        {bannerImages.map((_, i) => (
          <button
            key={i}
            onClick={() => { setCurrent(i); setProgress(0); }}
            className="relative h-2 rounded-full overflow-hidden transition-all"
            style={{ width: i === current ? 32 : 10 }}
            aria-label={`Go to banner ${i + 1}`}
          >
            <span className="absolute inset-0 bg-white/25 rounded-full" />
            {i === current && (
              <motion.span
                className="absolute inset-0 rounded-full bg-gradient-to-r from-jaynetic-purple to-jaynetic-blue"
                style={{ width: `${progress}%` }}
              />
            )}
          </button>
        ))}
      </div>
    </motion.div>
  );
};

/* ═══════════════════════════════════════════════════
   STAT CARD (animated)
   ═══════════════════════════════════════════════════ */
const StatCard = ({ stat, index }) => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });
  return (
    <motion.div
      ref={ref}
      className="glass-card rounded-2xl p-5 text-center group"
      initial={{ opacity: 0, y: 30 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5, delay: index * 0.15 }}
    >
      <div className="text-2xl mb-2 group-hover:scale-110 transition-transform">{stat.icon}</div>
      <div className="stat-value text-3xl md:text-4xl font-display font-semibold">{stat.value}</div>
      <div className="text-xs md:text-sm text-slate-400 mt-1">{stat.label}</div>
    </motion.div>
  );
};

/* ═══════════════════════════════════════════════════
   SERVICE CARD
   ═══════════════════════════════════════════════════ */
const ServiceCard = ({ service, index }) => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });
  return (
    <motion.div
      ref={ref}
      className="glass-card glow-border rounded-2xl p-6 slash-hover"
      initial={{ opacity: 0, y: 30 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5, delay: index * 0.12 }}
    >
      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-jaynetic-purple/30 to-jaynetic-blue/20 flex items-center justify-center mb-4 text-jaynetic-blue">
        {service.icon}
      </div>
      <h3 className="font-display text-lg tracking-wide mb-2">{service.title}</h3>
      <p className="text-sm text-slate-400 leading-relaxed">{service.desc}</p>
    </motion.div>
  );
};

/* ═══════════════════════════════════════════════════
   GALLERY IMAGE
   ═══════════════════════════════════════════════════ */
const GalleryImage = ({ img, index }) => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });
  return (
    <motion.div
      ref={ref}
      className="gallery-item aspect-[3/4] border border-white/10 bg-slate-900/50"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={isInView ? { opacity: 1, scale: 1 } : {}}
      transition={{ duration: 0.5, delay: index * 0.08 }}
    >
      <img src={img.src} alt={img.alt} className="w-full h-full object-cover object-top" loading="lazy" />
      <div className="overlay flex items-end p-4">
        <span className="text-xs font-medium tracking-wide text-white/90">{img.label}</span>
      </div>
    </motion.div>
  );
};

/* ═══════════════════════════════════════════════════
   SECTION LABEL (reusable heading pattern)
   ═══════════════════════════════════════════════════ */
const SectionLabel = ({ tag, title, subtitle }) => (
  <div className="mb-10">
    {tag && (
      <span className="inline-block text-[11px] uppercase tracking-[0.3em] text-jaynetic-blue bg-jaynetic-blue/10 px-3 py-1 rounded-full mb-3">
        {tag}
      </span>
    )}
    <h2 className="font-display text-3xl md:text-4xl tracking-wide">{title}</h2>
    {subtitle && <p className="text-sm md:text-base text-slate-400 mt-3 max-w-2xl leading-relaxed">{subtitle}</p>}
  </div>
);

/* ═══════════════════════════════════════════════════
   CONTACT FORM
   ═══════════════════════════════════════════════════ */
const ContactForm = () => {
  const [form, setForm] = useState({ name: '', email: '', phone: '', message: '' });
  const [success, setSuccess] = useState('');

  const handleChange = (e) => {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const subject = encodeURIComponent(`Contact - ${form.name} | Jaynetic Zone`);
    const body = encodeURIComponent(
      `JAYNETIC ZONE - CONTACT MESSAGE\n${'='.repeat(40)}\n\nName: ${form.name}\nEmail: ${form.email}\nPhone: ${form.phone || 'Not provided'}\n\nMessage:\n${form.message}\n\n${'='.repeat(40)}\nSent from Jaynetic Zone Contact Form`
    );
    window.open(`mailto:jayneticplays88@gmail.com?subject=${subject}&body=${body}`, '_blank');
    setSuccess('Your email client has been opened. Please send the email to reach us!');
    setForm({ name: '', email: '', phone: '', message: '' });
    setTimeout(() => setSuccess(''), 8000);
  };

  const inputClasses =
    'w-full rounded-xl bg-white/[0.04] border border-white/10 px-4 py-2.5 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-jaynetic-purple/50 focus:border-jaynetic-purple/40 transition-all';

  return (
    <form onSubmit={handleSubmit} className="mt-6 glass-card rounded-2xl p-6 space-y-4">
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Name</label>
          <input name="name" value={form.name} onChange={handleChange} required className={inputClasses} placeholder="Your name" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Email</label>
          <input type="email" name="email" value={form.email} onChange={handleChange} required className={inputClasses} placeholder="you@email.com" />
        </div>
      </div>
      <div>
        <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Phone (optional)</label>
        <input name="phone" value={form.phone} onChange={handleChange} className={inputClasses} placeholder="+91 XXXXX XXXXX" />
      </div>
      <div>
        <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Message</label>
        <textarea
          name="message"
          value={form.message}
          onChange={handleChange}
          rows={3}
          required
          className={inputClasses + ' resize-none'}
          placeholder="Tell us what's on your mind..."
        />
      </div>
      {success && (
        <motion.p
          className="text-emerald-400 text-xs bg-emerald-500/10 px-3 py-2 rounded-lg"
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
        >
          ✅ {success}
        </motion.p>
      )}
      <button
        type="submit"
        className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-gradient-to-r from-jaynetic-purple to-jaynetic-blue text-sm font-medium hover:shadow-neon-purple transition-all active:scale-95"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
        Send Message
      </button>
    </form>
  );
};

/* ═══════════════════════════════════════════════════
   HOME PAGE
   ═══════════════════════════════════════════════════ */
export const HomePage = () => {
  return (
    <div className="relative">
      <AmbientParticles />

      <div className="relative z-10">
        {/* ──────── HERO ──────── */}
        <Hero />

        {/* ──────── TICKER ──────── */}
        <TickerStrip />

        {/* ──────── FEATURED / CAROUSEL ──────── */}
        <section className="max-w-7xl mx-auto px-4 pt-16">
          <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
            <SectionLabel
              tag="Inside the arena"
              title="Take a Look Around"
              subtitle="From cozy couch co-op to hardcore esports — explore the zones."
            />
            <Badge tone="purple">5 PS5 • 2 PCs • 1 Racing Sim</Badge>
          </div>
          <BannerCarousel />
        </section>

        {/* ──────── STATS ──────── */}
        <RevealSection className="max-w-6xl mx-auto px-4 py-12">
          <div className="grid sm:grid-cols-3 gap-5">
            {stats.map((stat, i) => (
              <StatCard key={i} stat={stat} index={i} />
            ))}
          </div>
        </RevealSection>

        {/* ──────── DIVIDER ──────── */}
        <div className="section-divider max-w-4xl mx-auto my-4" />

        {/* ──────── ABOUT ──────── */}
        <RevealSection className="max-w-6xl mx-auto px-4 py-16">
          <div className="text-center max-w-3xl mx-auto">
            <SectionLabel
              tag="Who we are"
              title="About Jaynetic Zone"
              subtitle="Located in Vadodara, Jaynetic Zone blends anime aesthetics with futuristic PS5 and PC setups. Whether you are grinding ranked, exploring open worlds, or chilling with friends, our hourly packages and session management keep your experience smooth."
            />
            <p className="text-sm text-slate-400 leading-relaxed mx-auto max-w-2xl">
              Clean air-conditioned arena, ergonomic chairs, RGB-lit rigs, and
              fiber internet – curated for serious gamers and casual squads alike.
            </p>
          </div>
        </RevealSection>

        {/* ──────── SERVICES ──────── */}
        <RevealSection className="max-w-6xl mx-auto px-4 py-8">
          <SectionLabel
            tag="What we offer"
            title="Our Services"
            subtitle="Everything you need for the ultimate gaming session."
          />
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {services.map((s, i) => (
              <ServiceCard key={i} service={s} index={i} />
            ))}
          </div>
        </RevealSection>

        {/* ──────── DIVIDER ──────── */}
        <div className="section-divider max-w-4xl mx-auto my-4" />

        {/* ──────── GALLERY ──────── */}
        <RevealSection className="max-w-6xl mx-auto px-4 py-16">
          <SectionLabel
            tag="Our vibe"
            title="Gallery Vibes"
            subtitle="Step into a high-energy esports atmosphere powered by neon aesthetics, elite gaming rigs, and pro-level racing simulators. Take a look at where champions play."
          />
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {galleryImages.map((img, i) => (
              <GalleryImage key={i} img={img} index={i} />
            ))}
          </div>
        </RevealSection>

        {/* ──────── DIVIDER ──────── */}
        <div className="section-divider max-w-4xl mx-auto my-4" />

        {/* ──────── CONTACT & MAP ──────── */}
        <RevealSection className="max-w-6xl mx-auto px-4 py-16 pb-20">
          <div className="grid md:grid-cols-[1.1fr_1fr] gap-10">
            <div>
              <SectionLabel
                tag="Get in touch"
                title="Contact & Location"
                subtitle="Jaynetic Zone, Vadodara, Gujarat, India. Reach us for group bookings, custom events, and night sessions."
              />
              <ul className="text-sm text-slate-400 space-y-3 mb-2">
                <li className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-lg bg-jaynetic-purple/20 flex items-center justify-center text-jaynetic-blue shrink-0">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                  </span>
                  <a href="tel:+918758173436" className="hover:text-jaynetic-blue transition-colors">+91-87581-73436</a>
                </li>
                <li className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-lg bg-jaynetic-purple/20 flex items-center justify-center text-jaynetic-blue shrink-0">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </span>
                  <a href="mailto:jayneticplays88@gmail.com" className="hover:text-jaynetic-blue transition-colors">jayneticplays88@gmail.com</a>
                </li>
              </ul>
              <ContactForm />
            </div>
            <div className="h-72 md:h-full min-h-[320px] rounded-2xl overflow-hidden border border-white/10 shadow-xl shadow-jaynetic-purple/10">
              <iframe
                title="Jaynetic Zone Location"
                src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d806!2d73.1840411!3d22.3094522!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x395fcf0048fcfec7%3A0x6863cd992a2d84a4!2sJaynetic%20game%20zone!5e0!3m2!1sen!2sin!4v1700000000000"
                width="100%"
                height="100%"
                style={{ border: 0 }}
                allowFullScreen=""
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>
          </div>
        </RevealSection>
      </div>
    </div>
  );
};
