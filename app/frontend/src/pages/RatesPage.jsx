import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { Skeleton, ErrorState } from '../components/ui.jsx';

export const RatesPage = () => {
  const ratesQuery = useQuery({
    queryKey: ['rates'],
    queryFn: async () => {
      const res = await api.get('/rates');
      return res.data;
    }
  });

  const devicesQuery = useQuery({
    queryKey: ['devices'],
    queryFn: async () => {
      const res = await api.get('/devices');
      return res.data.summary;
    }
  });

  const rates = ratesQuery.data;
  const devicesSummary = devicesQuery.data;
  const loading = ratesQuery.isLoading || devicesQuery.isLoading;
  const failed = ratesQuery.isError || devicesQuery.isError;

  const rateMap =
    rates?.reduce((acc, r) => {
      acc[r.type] = r.pricePerHour;
      return acc;
    }, {}) || {};

  return (
    <div className="max-w-5xl mx-auto px-4 py-10 space-y-10">
      {/* Header Banner */}
      <div className="relative rounded-2xl overflow-hidden border border-white/10 h-40 md:h-52">
        <img
          src="/images/banner-2.png"
          alt="Rates Banner"
          className="w-full h-full object-cover"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-jaynetic-bg/90 via-jaynetic-bg/50 to-transparent" />
        <div className="absolute inset-0 flex items-center px-6 md:px-10">
          <div>
            <p className="inline-block text-[11px] uppercase tracking-[0.3em] text-jaynetic-blue bg-jaynetic-blue/10 px-3 py-1 rounded-full mb-2">
              Pricing
            </p>
            <h1 className="font-neon text-3xl md:text-4xl tracking-wide">Hourly Rates</h1>
            <p className="text-sm text-slate-300 mt-2">
              Transparent, simple pricing for every type of gamer. All rates are per
              hour, billed in INR.
            </p>
          </div>
        </div>
      </div>

      {failed ? (
        <ErrorState
          message="Couldn't load live rates from the server. Showing the standard rate card below."
          onRetry={() => {
            ratesQuery.refetch();
            devicesQuery.refetch();
          }}
        />
      ) : loading ? (
        <div className="grid md:grid-cols-3 gap-5 text-sm pt-6">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 space-y-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-32" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          ))}
        </div>
      ) : (
        <section className="grid md:grid-cols-3 gap-5 text-sm pt-6">
          <RateCard
            title="PS5 Console"
            rate={rateMap['ps5'] ?? 130}
            description="Next-gen console experience with comfy couch setups. 5 consoles available."
            highlight
            count={devicesSummary?.ps5}
          />
          <RateCard
            title="Gaming PC"
            rate={rateMap['gaming-pc'] ?? 120}
            description="High-end RGB rig with high-refresh monitor for competitive play."
            count={devicesSummary?.gamingPc}
          />
          <RateCard
            title="Racing Simulator"
            rate={rateMap['racing-sim'] ?? 150}
            description="Immersive racing sim setup — dual-use as Gaming PC too."
            count={devicesSummary?.racingSim}
          />
        </section>
      )}

      <section className="text-xs md:text-sm text-slate-300 space-y-2">
        <h2 className="font-semibold text-slate-100">Notes</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>Minimum booking is 1 hour, maximum 6 hours per session.</li>
          <li>
            Payment is handled at the counter — walk in or book online and pay
            when you arrive.
          </li>
        </ul>
      </section>
    </div>
  );
};

const RateCard = ({ title, rate, description, highlight, count }) => {
  return (
    <div className={`relative overflow-visible rounded-2xl pt-8 w-full md:w-auto md:inline-block`}>
      {highlight && (
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 px-3 py-1 rounded-full bg-jaynetic-purple text-[10px] uppercase tracking-[0.2em] font-semibold z-30 whitespace-nowrap shadow-neon-purple">
          Most Popular
        </div>
      )}
      <div
        className={`relative rounded-2xl border p-5 bg-slate-900/70 h-full transition-all hover:-translate-y-1 ${
          highlight
            ? 'border-jaynetic-purple/80 shadow-lg shadow-jaynetic-purple/40'
            : 'border-white/10 hover:border-jaynetic-blue/30 hover:shadow-jaynetic-blue/10'
        }`}
      >
        <div className="absolute inset-0 slash-hover rounded-2xl pointer-events-none z-10" />
        <div className="relative z-20">
          <h3 className="font-semibold text-lg mb-1">{title}</h3>
          <p className="text-3xl font-neon font-bold mb-2">
            ₹{rate}
            <span className="text-xs text-slate-400 ml-1 font-body font-normal">/ hour</span>
          </p>
          <p className="text-xs text-slate-300 mb-3">{description}</p>
          {typeof count === 'number' && (
            <p className="text-[11px] text-slate-400">
              Devices available: <span className="text-slate-100">{count}</span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
