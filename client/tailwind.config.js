/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'sans-serif'],
      },
      colors: {
        primary: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
        },
      },
      boxShadow: {
        card: '0 1px 2px rgba(16, 24, 40, 0.04), 0 10px 30px -14px rgba(16, 24, 40, 0.14)',
        lift: '0 4px 12px rgba(16, 24, 40, 0.06), 0 18px 40px -16px rgba(16, 24, 40, 0.18)',
        glow: '0 8px 24px -8px rgba(79, 70, 229, 0.55)',
        pop: '0 20px 48px rgba(15, 23, 42, 0.18), 0 4px 12px rgba(15, 23, 42, 0.08)',
      },
      backgroundImage: {
        brand: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
        'brand-soft': 'linear-gradient(135deg, #eef2ff 0%, #f5f3ff 100%)',
        page: 'radial-gradient(1200px 500px at 15% -10%, #e9edff 0%, transparent 60%), radial-gradient(900px 400px at 110% 0%, #f3e8ff 0%, transparent 55%)',
      },
      keyframes: {
        fade: { from: { opacity: 0 }, to: { opacity: 1 } },
        pop: { from: { opacity: 0, transform: 'scale(0.97)' }, to: { opacity: 1, transform: 'none' } },
        up: { from: { opacity: 0, transform: 'translateY(24px)' }, to: { opacity: 1, transform: 'none' } },
        slide: { from: { opacity: 0, transform: 'translateX(24px)' }, to: { opacity: 1, transform: 'none' } },
      },
      animation: {
        fade: 'fade 0.15s ease-out',
        pop: 'pop 0.15s ease-out',
        up: 'up 0.2s ease-out',
        slide: 'slide 0.2s ease-out',
      },
    },
  },
  plugins: [],
};
