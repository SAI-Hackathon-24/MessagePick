/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 品牌主色：微信绿 → 聊斋墨青
        jade: {
          50: '#eefbf4',
          100: '#d6f5e3',
          200: '#b0e9cb',
          300: '#7bd7ab',
          400: '#45bd87',
          500: '#07C160', // WeChat Green
          600: '#059a4d',
          700: '#047a3f',
          800: '#066134',
          900: '#06502d',
        },
        // 深色底：墨色 / 宣纸
        ink: {
          50: '#f6f7f9',
          100: '#eceef2',
          200: '#d4d9e2',
          300: '#a8b1c1',
          400: '#77839a',
          500: '#556074',
          600: '#3f4859',
          700: '#2b3242',
          800: '#1c2230',
          900: '#121722',
          950: '#0b0f17',
        },
        // 强调色：通知优先级 / 热梗渐变
        amber: {
          400: '#fbbf24',
          500: '#f59e0b',
        },
        coral: {
          400: '#fb7185',
          500: '#f43f5e',
        },
      },
      fontFamily: {
        sans: [
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          '"Noto Sans SC"',
          'system-ui',
          '-apple-system',
          'sans-serif',
        ],
        mono: ['"JetBrains Mono"', '"SFMono-Regular"', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(11,15,23,0.04), 0 8px 24px -12px rgba(11,15,23,0.18)',
        'card-hover': '0 2px 4px rgba(11,15,23,0.06), 0 16px 40px -16px rgba(11,15,23,0.28)',
        glow: '0 0 0 1px rgba(7,193,96,0.35), 0 8px 32px -8px rgba(7,193,96,0.45)',
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.125rem',
        '3xl': '1.5rem',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.55' },
        },
        'draw-line': {
          '0%': { strokeDashoffset: '1' },
          '100%': { strokeDashoffset: '0' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.28s ease-out both',
        'pulse-soft': 'pulse-soft 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
