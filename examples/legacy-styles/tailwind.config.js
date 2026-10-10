// A Tailwind 3 config, as a ported project would have it. The kit loads it
// with Tailwind 4's @config, and adds back Tailwind 3's defaults.
module.exports = {
  content: ['./src/**/*.{ts,html}'],
  theme: {
    extend: {
      colors: {
        brand: { 50: '#eef4ff', 600: '#2f55d4', 800: '#1e3a8a' },
      },
    },
  },
  plugins: [
    function ({ addComponents }) {
      addComponents({ '.card-title': { fontWeight: '600', letterSpacing: '-0.01em' } });
    },
  ],
};
