/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg:        '#fafaf8',
        surface:   '#ffffff',
        surface2:  '#f3f2ee',
        surface3:  '#eceae4',
        border:    '#ddd9d0',
        border2:   '#c8c4ba',
        ink:       '#1c1a16',
        ink: {
          DEFAULT: '#1c1a16',
          50:  '#f8f8f6', 100: '#f0efe9', 200: '#e0ddd4',
          300: '#c8c4ba', 400: '#a8a498', 500: '#888480',
          600: '#605c58', 700: '#403c38',  800: '#28261e', 900: '#1c1a16',
        },
        amber: {
          DEFAULT: '#b07c1a',
          dim:    '#8a6218',
          glow:   '#e09a20',
          muted:  '#d4b87a',
        },
        sage: {
          DEFAULT: '#3a7a50',
          dim:    '#2a5a3a',
          muted:  '#8ab8a0',
        },
        rust: {
          DEFAULT: '#b04030',
          dim:    '#7a2e20',
        },
        paper:     '#fffdf5',
      },
      fontFamily: {
        mono:  ['"Courier Prime"', '"Courier New"', 'monospace'],
        serif: ['"Lora"', 'Georgia', 'serif'],
        sans:  ['"DM Sans"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 4px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.04)',
        lift: '0 4px 16px rgba(0,0,0,0.10), 0 0 0 1px rgba(0,0,0,0.04)',
        modal:'0 24px 80px rgba(0,0,0,0.15)',
      },
      animation: {
        'fade-in':    'fadeIn 0.3s ease forwards',
        'slide-up':   'slideUp 0.2s ease forwards',
        'bounce-in':  'bounceIn 0.25s cubic-bezier(0.34,1.56,0.64,1) forwards',
      },
      keyframes: {
        fadeIn:  { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: { from: { opacity: '0', transform: 'translateY(10px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        bounceIn:{ from: { opacity: '0', transform: 'scale(0.92)' }, to: { opacity: '1', transform: 'scale(1)' } },
      },
    },
  },
  plugins: [],
}
