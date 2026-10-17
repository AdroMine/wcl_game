/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        underworld: {
          dark: '#08090c',
          card: '#10121a',
          surface: '#161922',
          border: '#2a2e3d',
          gold: '#c4a45a',
          'gold-light': '#e5cb87',
          'gold-dark': '#8a7033',
          ivory: '#f4f0e8',
          muted: '#8e95a5',
        }
      },
      fontFamily: {
        serif: ['Cinzel', 'Georgia', 'Cambria', 'serif'],
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Courier New', 'monospace'],
      },
      boxShadow: {
        'beacon': '0 0 25px -3px var(--beacon-glow, rgba(196, 164, 90, 0.4))',
        'gold-glow': '0 0 20px -2px rgba(196, 164, 90, 0.35)',
      }
    },
  },
  plugins: [],
}
