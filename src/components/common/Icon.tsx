/**
 * @file src/components/common/Icon.tsx
 * @description 轻量内联 SVG 图标系统（v3 — 全量合并版）
 *
 * 合并来源：
 *   原始版  — images / heart / clock / folder / book / plus / settings / trash 等基础图标
 *   v2设置版 — monitor / palette / download-cloud / cpu / database / about /
 *              sun / moon / scan / external-link / refresh-cw（设置页专用）
 *   v2批量版 — check-square / square（批量操作）
 *   v3私密版 — lock / lock-open / shield / rotate-ccw / x-circle（私密相册/回收站）
 *
 * 设计原则（始终不变）：
 *   SF Symbols 风格，1.5px 线宽，圆角线帽，20×20 viewBox，零外部依赖
 */

import { memo } from 'react'

export type IconName =
  // ── 基础图标（原始版）──
  | 'images'
  | 'heart'
  | 'heart-fill'
  | 'clock'
  | 'folder'
  | 'folder-open'
  | 'book'
  | 'plus'
  | 'settings'
  | 'trash'
  | 'trash-fill'
  | 'chevron-right'
  | 'chevron-down'
  | 'chevron-left'
  | 'check'
  | 'x'
  | 'search'
  | 'grid'
  | 'waterfall'
  | 'info'
  | 'star'
  | 'star-fill'
  | 'rotate-cw'
  | 'share'
  | 'import'
  | 'collapse'
  | 'expand'
  | 'dots-h'
  | 'pencil'
  | 'eye'
  | 'camera'
  | 'map-pin'
  // ── 设置页图标（v2 settings）──
  | 'monitor'
  | 'palette'
  | 'download-cloud'
  | 'cpu'
  | 'database'
  | 'about'
  | 'sun'
  | 'moon'
  | 'scan'
  | 'external-link'
  | 'refresh-cw'
  // ── 批量操作图标（v2 batch）──
  | 'check-square'
  | 'square'
  // ── 私密相册/回收站图标（v3）──
  | 'lock'
  | 'lock-open'
  | 'shield'
  | 'rotate-ccw'
  | 'x-circle'
  // ── 标签系统图标（Phase-B M-12）──
  | 'tag'

interface IconProps {
  name:         IconName
  size?:        number
  color?:       string
  strokeWidth?: number
  className?:   string
  style?:       React.CSSProperties
}

// ─────────────────────────────────────────────────────────
//  SVG 路径库（20×20 坐标系）
// ─────────────────────────────────────────────────────────

const PATHS: Record<IconName, React.ReactNode> = {

  // ════════════════════════════════════════════════════
  //  基础图标（原始版，完整保留）
  // ════════════════════════════════════════════════════

  images: (
    <>
      <rect x="2" y="5" width="13" height="11" rx="1.5" />
      <path d="M5 5V4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-1" />
      <circle cx="6.5" cy="9" r="1.2" />
      <path d="M2 13l3-3 2.5 2.5L11 9l4 5H2" strokeLinejoin="round" />
    </>
  ),

  heart: (
    <path d="M10 16.5S2 11.5 2 6.5a4 4 0 0 1 8-1 4 4 0 0 1 8 1c0 5-8 10-8 10z" strokeLinejoin="round" />
  ),

  'heart-fill': (
    <path d="M10 16.5S2 11.5 2 6.5a4 4 0 0 1 8-1 4 4 0 0 1 8 1c0 5-8 10-8 10z" fill="currentColor" stroke="none" />
  ),

  clock: (
    <>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 6v4l2.5 2.5" strokeLinecap="round" />
    </>
  ),

  folder: (
    <path d="M2 6a1 1 0 0 1 1-1h5l1.5 2H17a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6z" strokeLinejoin="round" />
  ),

  'folder-open': (
    <>
      <path d="M2 6a1 1 0 0 1 1-1h5l1.5 2H17a1 1 0 0 1 1 1v1H2V6z" strokeLinejoin="round" />
      <path d="M2 9h16l-1.5 7H3.5L2 9z" strokeLinejoin="round" />
    </>
  ),

  book: (
    <>
      <path d="M4 3h10a1 1 0 0 1 1 1v13l-5.5-2L4 17V4a1 1 0 0 1 0 0" strokeLinejoin="round" />
      <path d="M4 3a1 1 0 0 0-1 1v13" />
    </>
  ),

  plus: (
    <>
      <line x1="10" y1="3" x2="10" y2="17" strokeLinecap="round" />
      <line x1="3"  y1="10" x2="17" y2="10" strokeLinecap="round" />
    </>
  ),

  settings: (
    <>
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.22 4.22l1.42 1.42M14.36 14.36l1.42 1.42M4.22 15.78l1.42-1.42M14.36 5.64l1.42-1.42" strokeLinecap="round" />
    </>
  ),

  trash: (
    <>
      <path d="M3 5h14M8 5V3h4v2" strokeLinecap="round" />
      <path d="M4 5l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12" strokeLinejoin="round" />
    </>
  ),

  'trash-fill': (
    <>
      <path d="M3 5h14M8 5V3h4v2" strokeLinecap="round" />
      <path d="M4 5l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12z" fill="currentColor" stroke="none" />
    </>
  ),

  'chevron-right': (
    <polyline points="7 4 13 10 7 16" strokeLinecap="round" strokeLinejoin="round" />
  ),

  'chevron-down': (
    <polyline points="4 7 10 13 16 7" strokeLinecap="round" strokeLinejoin="round" />
  ),

  'chevron-left': (
    <polyline points="13 4 7 10 13 16" strokeLinecap="round" strokeLinejoin="round" />
  ),

  check: (
    <polyline points="3 10 8 15 17 5" strokeLinecap="round" strokeLinejoin="round" />
  ),

  x: (
    <>
      <line x1="4" y1="4" x2="16" y2="16" strokeLinecap="round" />
      <line x1="16" y1="4" x2="4"  y2="16" strokeLinecap="round" />
    </>
  ),

  search: (
    <>
      <circle cx="8.5" cy="8.5" r="5.5" />
      <line x1="12.5" y1="12.5" x2="17" y2="17" strokeLinecap="round" />
    </>
  ),

  grid: (
    <>
      <rect x="2"  y="2"  width="7" height="7" rx="1" />
      <rect x="11" y="2"  width="7" height="7" rx="1" />
      <rect x="2"  y="11" width="7" height="7" rx="1" />
      <rect x="11" y="11" width="7" height="7" rx="1" />
    </>
  ),

  waterfall: (
    <>
      <rect x="2"  y="2"  width="7" height="10" rx="1" />
      <rect x="11" y="2"  width="7" height="6"  rx="1" />
      <rect x="11" y="10" width="7" height="8"  rx="1" />
      <rect x="2"  y="14" width="7" height="4"  rx="1" />
    </>
  ),

  info: (
    <>
      <circle cx="10" cy="10" r="8" />
      <line x1="10" y1="9" x2="10" y2="14" strokeLinecap="round" />
      <circle cx="10" cy="6.5" r="0.8" fill="currentColor" stroke="none" />
    </>
  ),

  star: (
    <polygon points="10,2 12.4,7.5 18.5,8 14,12 15.6,18 10,15 4.4,18 6,12 1.5,8 7.6,7.5" strokeLinejoin="round" />
  ),

  'star-fill': (
    <polygon points="10,2 12.4,7.5 18.5,8 14,12 15.6,18 10,15 4.4,18 6,12 1.5,8 7.6,7.5" fill="currentColor" stroke="none" />
  ),

  'rotate-cw': (
    <>
      <path d="M14.5 2.5a8 8 0 1 1-9 1.5" strokeLinecap="round" />
      <polyline points="14.5 2.5 14.5 6.5 10.5 6.5" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),

  share: (
    <>
      <rect x="8" y="2" width="10" height="10" rx="1.5" />
      <path d="M12 12v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4" strokeLinecap="round" />
    </>
  ),

  import: (
    <>
      <path d="M2 6a1 1 0 0 1 1-1h5l1.5 2H17a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6z" strokeLinejoin="round" />
      <line x1="10" y1="9" x2="10" y2="14" strokeLinecap="round" />
      <polyline points="7 12 10 15 13 12" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),

  collapse: (
    <>
      <rect x="2" y="2" width="16" height="16" rx="2" />
      <line x1="7" y1="2" x2="7" y2="18" />
      <polyline points="11 8 9 10 11 12" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),

  expand: (
    <>
      <rect x="2" y="2" width="16" height="16" rx="2" />
      <line x1="7" y1="2" x2="7" y2="18" />
      <polyline points="10 8 12 10 10 12" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),

  'dots-h': (
    <>
      <circle cx="4"  cy="10" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="10" cy="10" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="16" cy="10" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),

  pencil: (
    <>
      <path d="M13.5 2.5l4 4-10 10H3.5v-4l10-10z" strokeLinejoin="round" />
      <line x1="11.5" y1="4.5" x2="15.5" y2="8.5" />
    </>
  ),

  eye: (
    <>
      <path d="M1 10s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z" />
      <circle cx="10" cy="10" r="2.5" />
    </>
  ),

  camera: (
    <>
      <path d="M2 7a1 1 0 0 1 1-1h2l1.5-2h7L15 6h2a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7z" strokeLinejoin="round" />
      <circle cx="10" cy="11" r="3" />
    </>
  ),

  'map-pin': (
    <>
      <path d="M10 2a5 5 0 0 1 5 5c0 4-5 10-5 10S5 11 5 7a5 5 0 0 1 5-5z" strokeLinejoin="round" />
      <circle cx="10" cy="7" r="1.8" />
    </>
  ),

  // ════════════════════════════════════════════════════
  //  设置页图标（v2 settings，完整保留）
  // ════════════════════════════════════════════════════

  // 显示器（通用/通知设置）
  monitor: (
    <>
      <rect x="2" y="3" width="16" height="11" rx="1.5" />
      <path d="M7 17h6M10 14v3" strokeLinecap="round" />
    </>
  ),

  // 调色板（外观设置）
  palette: (
    <>
      <circle cx="10" cy="10" r="7.5" />
      <circle cx="7"  cy="8"  r="1.3" fill="currentColor" stroke="none" />
      <circle cx="13" cy="8"  r="1.3" fill="currentColor" stroke="none" />
      <circle cx="10" cy="13" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),

  // 云下载（导入设置）
  'download-cloud': (
    <>
      <path d="M4.5 13.5a4 4 0 0 1-.5-8 5 5 0 0 1 9.9-1A3.5 3.5 0 0 1 17 8a3.5 3.5 0 0 1-3 3.5" strokeLinecap="round" />
      <line x1="10" y1="11" x2="10" y2="18" strokeLinecap="round" />
      <polyline points="7 15.5 10 18.5 13 15.5" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),

  // CPU（性能设置）
  cpu: (
    <>
      <rect x="5" y="5" width="10" height="10" rx="1" />
      <path d="M7 2v3M10 2v3M13 2v3M7 15v3M10 15v3M13 15v3M2 7h3M2 10h3M2 13h3M15 7h3M15 10h3M15 13h3" strokeLinecap="round" />
    </>
  ),

  // 数据库/存储（存储设置）
  database: (
    <>
      <ellipse cx="10" cy="5" rx="7" ry="2.5" />
      <path d="M3 5v10c0 1.38 3.13 2.5 7 2.5s7-1.12 7-2.5V5" />
      <path d="M3 10c0 1.38 3.13 2.5 7 2.5s7-1.12 7-2.5" />
    </>
  ),

  // 关于（问号圆圈）
  about: (
    <>
      <circle cx="10" cy="10" r="8" />
      <path d="M8 8a2 2 0 1 1 2 2v2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="10" cy="15" r="0.8" fill="currentColor" stroke="none" />
    </>
  ),

  // 太阳（浅色主题）
  sun: (
    <>
      <circle cx="10" cy="10" r="3.5" />
      <line x1="10" y1="1.5"  x2="10" y2="3.5"  strokeLinecap="round" />
      <line x1="10" y1="16.5" x2="10" y2="18.5" strokeLinecap="round" />
      <line x1="1.5"  y1="10" x2="3.5"  y2="10" strokeLinecap="round" />
      <line x1="16.5" y1="10" x2="18.5" y2="10" strokeLinecap="round" />
      <line x1="3.93"  y1="3.93"  x2="5.34"  y2="5.34"  strokeLinecap="round" />
      <line x1="14.66" y1="14.66" x2="16.07" y2="16.07" strokeLinecap="round" />
      <line x1="3.93"  y1="16.07" x2="5.34"  y2="14.66" strokeLinecap="round" />
      <line x1="14.66" y1="5.34"  x2="16.07" y2="3.93"  strokeLinecap="round" />
    </>
  ),

  // 月亮（深色主题）
  moon: (
    <path d="M17 12.5A7.5 7.5 0 0 1 9.5 3 7.5 7.5 0 1 0 17 12.5z" strokeLinejoin="round" />
  ),

  // 扫描（重新扫描文件夹）
  scan: (
    <>
      <path d="M4 6V3.5A1.5 1.5 0 0 1 5.5 2H8M16 6V3.5A1.5 1.5 0 0 0 14.5 2H12M4 14v2.5A1.5 1.5 0 0 0 5.5 18H8M16 14v2.5A1.5 1.5 0 0 1 14.5 18H12" strokeLinecap="round" />
      <line x1="2" y1="10" x2="18" y2="10" strokeLinecap="round" />
    </>
  ),

  // 外部链接（在资源管理器中打开）
  'external-link': (
    <>
      <path d="M11 3h6v6M17 3l-8 8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 11v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" strokeLinecap="round" />
    </>
  ),

  // 刷新（顺时针，重新加载）
  'refresh-cw': (
    <>
      <polyline points="1.5 4 1.5 9 6.5 9" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="18.5 16 18.5 11 13.5 11" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16.5 7A7.5 7.5 0 0 0 4 8.5L1.5 9M18.5 11l-2.5.5A7.5 7.5 0 0 1 3.5 13" strokeLinecap="round" />
    </>
  ),

  // ════════════════════════════════════════════════════
  //  批量操作图标（v2 batch）
  // ════════════════════════════════════════════════════

  // 复选框选中
  'check-square': (
    <>
      <rect x="2.5" y="2.5" width="15" height="15" rx="2" />
      <polyline points="5 10 8.5 13.5 15 7" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),

  // 复选框空
  square: (
    <rect x="2.5" y="2.5" width="15" height="15" rx="2" />
  ),

  // ════════════════════════════════════════════════════
  //  私密相册 / 回收站图标（v3）
  // ════════════════════════════════════════════════════

  // 挂锁（锁定态）— 私密相册标识 + 锁屏大图标
  lock: (
    <>
      <rect x="4" y="9" width="12" height="9" rx="2" />
      <path d="M7 9V6.5a3 3 0 0 1 6 0V9" strokeLinecap="round" />
    </>
  ),

  // 开锁（解锁态）
  'lock-open': (
    <>
      <rect x="4" y="9" width="12" height="9" rx="2" />
      <path d="M7 9V6.5a3 3 0 0 1 6 0" strokeLinecap="round" />
    </>
  ),

  // 盾牌（安全/创建私密相册向导）
  shield: (
    <>
      <path d="M10 2L3 5v5c0 4.42 3.13 8.56 7 9.54C13.87 18.56 17 14.42 17 10V5L10 2z" strokeLinejoin="round" />
      <polyline points="7 10 9 12 13 8" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),

  // 逆时针旋转（回收站「恢复」操作）
  'rotate-ccw': (
    <>
      <path d="M5.5 2.5a8 8 0 1 0 9 1.5" strokeLinecap="round" />
      <polyline points="5.5 2.5 5.5 6.5 9.5 6.5" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),

  // X 圆（回收站「清除记录」/ 锁屏冷却状态）
  'x-circle': (
    <>
      <circle cx="10" cy="10" r="8" />
      <line x1="7" y1="7" x2="13" y2="13" strokeLinecap="round" />
      <line x1="13" y1="7" x2="7"  y2="13" strokeLinecap="round" />
    </>
  ),

  // 标签（Phase-B M-12）— 价签形状
  'tag': (
    <>
      <path d="M3 3h7l7 7-7 7L3 10V3z" strokeLinejoin="round" />
      <circle cx="7.5" cy="7.5" r="1" fill="currentColor" stroke="none" />
    </>
  ),
}

// ─────────────────────────────────────────────────────────
//  Icon 组件
// ─────────────────────────────────────────────────────────

export const Icon = memo(function Icon({
  name,
  size        = 16,
  color       = 'currentColor',
  strokeWidth = 1.5,
  className,
  style,
}: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{ flexShrink: 0, ...style }}
    >
      {PATHS[name]}
    </svg>
  )
})
