/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 主色：价格橙红（比价 / 省钱场景）
        brand: {
          50: '#FFF5EF',
          100: '#FFE8D9',
          200: '#FFCCB0',
          300: '#FFA87C',
          400: '#FF7D45',
          500: '#FF5A1F',
          600: '#F03E00',
          700: '#C43200',
          800: '#9A2A00',
          900: '#7A2200',
        },
        // 中国习惯：降价 = 红，涨价 = 绿
        down: '#E1251B',
        up: '#16A34A',
        jd: '#E1251B',
        taobao: '#FF5000',
        pdd: '#E22E1F',
      },
      boxShadow: {
        card: '0 1px 2px rgba(15, 23, 42, 0.04), 0 8px 24px -12px rgba(15, 23, 42, 0.12)',
        pop: '0 8px 32px -8px rgba(240, 62, 0, 0.35)',
      },
      borderRadius: {
        xl2: '18px',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          'Roboto',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
        num: ['"DIN Alternate"', '"SF Pro Display"', 'Menlo', 'Consolas', 'monospace'],
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.35s ease-out both',
        shimmer: 'shimmer 1.4s infinite',
      },
    },
  },
  plugins: [],
};
