/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        base: { 950: '#050810', 900: '#0a0f1a', 850: '#0e1524', 800: '#131c30', 700: '#1c2942' },
        saffron: { DEFAULT: '#FF9933', dim: '#e6862b' },
        indiagreen: { DEFAULT: '#138808', dim: '#0f6d06' },
        accent: { DEFAULT: '#22d3ee', dim: '#0ea5b7' },
        quantum: { DEFAULT: '#a78bfa', dim: '#7c5cf0' },
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        body: ['"Inter"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 24px -4px rgba(34,211,238,0.35)',
        glowPurple: '0 0 24px -4px rgba(167,139,250,0.35)',
        glowSaffron: '0 0 30px -6px rgba(255,153,51,0.45)',
      },
      backgroundImage: {
        'grid-fade': 'radial-gradient(circle at center, rgba(148,163,184,0.08) 1px, transparent 1px)',
      },
    },
  },
  plugins: [],
}
