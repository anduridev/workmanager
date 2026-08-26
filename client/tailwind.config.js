/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'sans-serif'],
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
        card: '0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.06)',
        pop: '0 20px 48px rgba(15, 23, 42, 0.18), 0 4px 12px rgba(15, 23, 42, 0.08)',
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
