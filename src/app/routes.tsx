/**
 * @file src/app/routes.tsx
 * @description 视图路由配置
 *
 * LightAlbum 是纯本地桌面应用，不使用 URL 路由（react-router 等）。
 * 视图切换由 Zustand uiStore.currentView（ViewState 联合类型）驱动。
 *
 * 此文件提供：
 *   1. SIDEBAR_NAV_ITEMS  — 侧边栏固定导航项配置（图标/标签/视图映射）
 *   2. viewStateToLabel   — 将 ViewState 转为标题栏/工具栏标题
 *   3. viewStateMatches   — 判断当前视图是否匹配某个导航项（高亮用）
 */

import type { ViewState } from '@/types/layout'
import { locale } from '@/locales'

// ─────────────────────────────────────────────────────────
//  侧边栏固定导航项
// ─────────────────────────────────────────────────────────

export interface NavItemConfig {
  /** 对应的 ViewState 类型（固定视图） */
  viewType: ViewState['type']
  label:    string
  /** Lucide React 图标组件名 */
  icon:     string
  /** 键盘快捷键提示（Tooltip 中显示） */
  shortcut?: string
}

/**
 * 侧边栏固定导航项列表
 * 顺序即为侧边栏中的显示顺序
 */
export const SIDEBAR_NAV_ITEMS: NavItemConfig[] = [
  {
    viewType: 'all_photos',
    label:    locale.nav.allPhotos,
    icon:     'Images',
    shortcut: undefined,
  },
  {
    viewType: 'favorites',
    label:    locale.nav.favorites,
    icon:     'Heart',
  },
  {
    viewType: 'recently_imported',
    label:    locale.nav.recentImports,
    icon:     'Clock',
  },
  {
    viewType: 'trash',
    label:    locale.nav.trash,
    icon:     'Trash2',
  },
]

// ─────────────────────────────────────────────────────────
//  视图标题映射
// ─────────────────────────────────────────────────────────

/**
 * 将 ViewState 转为工具栏/标题栏显示的标题文字
 * albumName / folderName 从外部传入（避免在此文件中订阅 store）
 */
export function viewStateToLabel(
  view: ViewState,
  options?: { albumName?: string; folderName?: string },
): string {
  switch (view.type) {
    case 'all_photos':
      return locale.nav.allPhotos
    case 'favorites':
      return locale.nav.favorites
    case 'recently_imported':
      return locale.nav.recentImports
    case 'album':
      return options?.albumName ?? '相册'
    case 'folder':
      return options?.folderName ?? view.folderPath.split(/[/\\]/).pop() ?? '文件夹'
    case 'search': {
      // Fix: '#tagName' 查询 → 显示「标签：tagName」，普通搜索 → 显示「搜索：...」
      const q = view.query
      if (q.startsWith('#')) return `标签：${q.slice(1)}`
      return `搜索："${q}"`
    }
    case 'trash':
      return locale.nav.trash
    default:
      return 'LightAlbum'
  }
}

// ─────────────────────────────────────────────────────────
//  视图匹配（用于侧边栏高亮判断）
// ─────────────────────────────────────────────────────────

/**
 * 判断当前 ViewState 是否与导航项匹配（用于活跃高亮）
 *
 * @example
 * const isActive = viewStateMatches(currentView, { viewType: 'favorites' })
 */
export function viewStateMatches(
  current: ViewState,
  navItem: Pick<NavItemConfig, 'viewType'>,
): boolean {
  return current.type === navItem.viewType
}

/**
 * 判断当前视图是否为某个相册
 */
export function isAlbumView(
  current: ViewState,
  albumId: string,
): boolean {
  return current.type === 'album' && current.albumId === albumId
}

/**
 * 判断当前视图是否为某个文件夹
 */
export function isFolderView(
  current: ViewState,
  folderPath: string,
): boolean {
  return current.type === 'folder' && current.folderPath === folderPath
}
