/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'jaynetic-bg': '#050814',
        'jaynetic-purple': '#7c3aed',
        'jaynetic-violet': '#a78bfa',
        'jaynetic-blue': '#22d3ee',
        'jaynetic-red': '#ef4444'
      },
      fontFamily: {
        display: ['Oswald', 'system-ui', 'sans-serif'],
        neon: ['Orbitron', 'system-ui', 'sans-serif'],
        body: ['Inter', 'system-ui', 'sans-serif']
      },
      boxShadow: {
        'neon-purple': '0 0 20px rgba(124, 58, 237, 0.45), 0 0 60px rgba(124, 58, 237, 0.15)',
        'neon-blue': '0 0 20px rgba(34, 211, 238, 0.4), 0 0 60px rgba(34, 211, 238, 0.12)'
      },
      keyframes: {
        marquee: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' }
        },
        'glitch-flicker': {
          '0%, 100%': { opacity: '1' },
          '92%': { opacity: '1' },
          '93%': { opacity: '0.4' },
          '94%': { opacity: '1' },
          '96%': { opacity: '0.6' },
          '97%': { opacity: '1' }
        }
      },
      animation: {
        marquee: 'marquee 22s linear infinite',
        flicker: 'glitch-flicker 4s linear infinite'
      }
    }
  },
  plugins: []
};


