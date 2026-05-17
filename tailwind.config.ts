/**
 * @file tailwind.config.ts
 * @description Tailwind CSS v4 配置
 *
 * 设计令牌通过 CSS 变量桥接（tokens.css @theme），
 * 所有 --la-* 颜色变量可直接用 bg-la-* / text-la-* 等类名消费。
 */
import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],

  /* 通过 class="dark" / class="light" 切换主题 */
  darkMode: 'class',

  theme: {
    extend: {
      /* ── 颜色（桥接 tokens.css --la-* 变量）── */
      colors: {
        la: {
          /* 背景 */
          'bg-app':      'var(--la-bg-app)',
          'bg-sidebar':  'var(--la-bg-sidebar)',
          'bg-toolbar':  'var(--la-bg-toolbar)',
          'bg-raised':   'var(--la-bg-raised)',
          'bg-overlay':  'var(--la-bg-overlay)',
          'bg-hover':    'var(--la-bg-hover)',
          'bg-active':   'var(--la-bg-active)',
          'bg-selected': 'var(--la-bg-selected)',

          /* 文字 */
          'text-primary':   'var(--la-text-primary)',
          'text-secondary': 'var(--la-text-secondary)',
          'text-tertiary':  'var(--la-text-tertiary)',
          'text-disabled':  'var(--la-text-disabled)',

          /* 强调 */
          'accent':         'var(--la-accent)',
          'accent-hover':   'var(--la-accent-hover)',
          'accent-pressed': 'var(--la-accent-pressed)',
          'accent-subtle':  'var(--la-accent-subtle)',

          /* 功能色 */
          'danger':         'var(--la-danger)',
          'danger-subtle':  'var(--la-danger-subtle)',
          'success':        'var(--la-success)',
          'favorite':       'var(--la-favorite)',

          /* 边框 */
          'border':         'var(--la-border)',
          'border-strong':  'var(--la-border-strong)',
          'divider':        'var(--la-divider)',
        },
      },

      /* ── 字体 ── */
      fontFamily: {
        sans: ['Segoe UI Variable', 'Segoe UI', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['Cascadia Code', 'Consolas', 'SF Mono', 'monospace'],
      },

      /* ── 字号 ── */
      fontSize: {
        'xs':   ['11px', { lineHeight: '1.4' }],
        'sm':   ['13px', { lineHeight: '1.4' }],
        'base': ['15px', { lineHeight: '1.4' }],
        'md':   ['17px', { lineHeight: '1.4' }],
        'lg':   ['20px', { lineHeight: '1.3' }],
        'xl':   ['24px', { lineHeight: '1.2' }],
        '2xl':  ['28px', { lineHeight: '1.2' }],
      },

      /* ── 圆角 ── */
      borderRadius: {
        'none':  '0',
        'xs':    '2px',
        'sm':    '4px',
        'md':    '8px',
        'lg':    '12px',
        'xl':    '16px',
        'full':  '9999px',
        DEFAULT: '8px',
      },

      /* ── 间距（补充 Tailwind 默认值）── */
      spacing: {
        '13': '52px',
        '18': '72px',
        '22': '88px',
        '30': '120px',
      },

      /* ── 布局尺寸 ── */
      width: {
        sidebar:     'var(--la-sidebar-w)',
        'sidebar-sm': 'var(--la-sidebar-w-icon)',
        exif:        'var(--la-exif-panel-w)',
      },
      height: {
        toolbar:   'var(--la-toolbar-h)',
        statusbar: 'var(--la-statusbar-h)',
        titlebar:  'var(--la-titlebar-h)',
      },

      /* ── z-index ── */
      zIndex: {
        base:       '0',
        raised:     '10',
        dropdown:   '100',
        sticky:     '200',
        overlay:    '300',
        modal:      '400',
        preview:    '500',
        toast:      '600',
        tooltip:    '700',
        titlebar:   '800',
      },

      /* ── 过渡时长 ── */
      transitionDuration: {
        instant: '80ms',
        fast:    '150ms',
        normal:  '250ms',
        medium:  '350ms',
        slow:    '400ms',
      },

      /* ── 缓动 ── */
      transitionTimingFunction: {
        apple:  'cubic-bezier(0.2, 0, 0, 1)',
        spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        smooth: 'cubic-bezier(0.4, 0, 0.2, 1)',
      },

      /* ── 动画 ── */
      animation: {
        'fade-in':    'la-fade-in var(--la-dur-fast) var(--la-ease-out) both',
        'scale-in':   'la-scale-in var(--la-dur-fast) var(--la-ease-out) both',
        'slide-up':   'la-slide-up-in var(--la-dur-fast) var(--la-ease-spring) both',
        'panel-in':   'la-slide-in-right var(--la-dur-normal) var(--la-ease-out) both',
        'panel-out':  'la-slide-out-right var(--la-dur-normal) var(--la-ease-out) both',
        'shimmer':    'la-shimmer 1.5s linear infinite',
        'spin-slow':  'la-spin 0.7s linear infinite',
        'heart-pop':  'la-heart-pop var(--la-dur-normal) var(--la-ease-spring) both',
      },

      /* ── 阴影 ── */
      boxShadow: {
        'sm':      'var(--la-shadow-sm)',
        'md':      'var(--la-shadow-md)',
        'lg':      'var(--la-shadow-lg)',
        'overlay': 'var(--la-shadow-overlay)',
      },

      /* ── 背景模糊 ── */
      backdropBlur: {
        glass: 'var(--la-bg-glass-blur)',
      },
    },
  },

  plugins: [],
}

export default config
