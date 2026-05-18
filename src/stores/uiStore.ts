/**
 * @file src/stores/uiStore.ts
 * @description 全局 UI 状态管理
 *
 * 管理所有「横切关注点」的 UI 状态，包括：
 *   - 侧边栏：宽度、折叠态、正在拖拽调整宽度
 *   - 当前视图（ViewState）：所有照片 / 收藏 / 相册 / 文件夹 / 搜索
 *   - 扫描进度：用于状态栏进度条和 Toast
 *   - Toast 通知队列
 *   - 右键上下文菜单
 *   - 主题（深色 / 浅色 / 跟随系统）
 *   - 搜索框展开态
 *
 * 不在此 store 的内容：
 *   - 照片数据 → photoStore
 *   - 选中态   → selectionStore
 *   - 预览态   → previewStore
 *   - 布局偏好 → layoutStore
 */

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { ViewState } from '@/types/layout'
import type { ScanProgress } from '@/types/photo'
import type { AppTheme } from '@/types/ipc'

// ─────────────────────────────────────────────────────────
//  Toast 类型
// ─────────────────────────────────────────────────────────

export type ToastVariant = 'info' | 'success' | 'warning' | 'error'

export interface ToastItem {
  id:        string
  message:   string
  variant:   ToastVariant
  /** 自动消失时长 ms，0 = 不自动消失 */
  duration:  number
  /** 可选的操作按钮 */
  action?: {
    label:   string
    onClick: () => void
  }
}

// ─────────────────────────────────────────────────────────
//  右键菜单类型
// ─────────────────────────────────────────────────────────

export interface ContextMenuItem {
  id:       string
  label:    string
  icon?:    string
  disabled?: boolean
  danger?:  boolean
  /** 分隔线（此项存在时忽略 label/icon） */
  separator?: boolean
  onClick?: () => void
  children?: ContextMenuItem[]  // 子菜单
}

export interface ContextMenuState {
  isOpen:  boolean
  x:       number
  y:       number
  items:   ContextMenuItem[]
  /** 触发右键的照片 ID（若有） */
  photoId?: string | null
}

// ─────────────────────────────────────────────────────────
//  Store 接口
// ─────────────────────────────────────────────────────────

interface UiStore {
  // ── 侧边栏 ──

  /** 侧边栏宽度 px（160~320），折叠时 = sidebar-w-icon（48） */
  sidebarWidth: number

  /** 是否处于折叠（图标模式）状态 */
  isSidebarCollapsed: boolean

  /** 是否正在拖拽调整侧边栏宽度 */
  isSidebarResizing: boolean

  // ── 当前视图 ──

  /** 当前显示的视图状态（联合类型，携带具体参数） */
  currentView: ViewState

  // ── 扫描进度 ──

  /** 当前扫描进度，null = 无扫描任务 */
  scanProgress: ScanProgress | null

  /** 扫描是否进行中 */
  isScanning: boolean

  // ── Toast 队列 ──

  toasts: ToastItem[]

  // ── 右键菜单 ──

  contextMenu: ContextMenuState

  // ── 主题 ──

  /** 用户选择的主题（跟随系统时实际应用由 useTheme hook 决定） */
  theme: AppTheme

  /** 实际渲染的主题（resolved，用于 class 注入） */
  resolvedTheme: 'light' | 'dark'

  // ── 搜索框 ──

  /** 搜索框是否处于展开/聚焦状态 */
  isSearchOpen: boolean

  /** 当前搜索关键词（实时输入值） */
  searchQuery: string

  // ── 写操作：侧边栏 ──

  setSidebarWidth: (width: number) => void
  toggleSidebar: () => void
  setIsSidebarResizing: (v: boolean) => void

  /** 当前私密相册是否已解锁（供 StatusBar 决定是否显示计数） */
  isPrivateAlbumUnlocked: boolean
  setPrivateAlbumUnlocked: (v: boolean) => void

  // ── 写操作：视图 ──

  setView: (view: ViewState) => void

  // ── 写操作：扫描 ──

  setScanProgress: (progress: ScanProgress | null) => void
  setIsScanning: (v: boolean) => void

  // ── 写操作：Toast ──

  /**
   * 添加一条 Toast，返回其 id
   * 若 duration > 0，自动在 duration ms 后调用 removeToast
   */
  addToast: (toast: Omit<ToastItem, 'id'>) => string

  removeToast: (id: string) => void

  clearToasts: () => void

  // ── 写操作：右键菜单 ──

  openContextMenu: (
    x: number,
    y: number,
    items: ContextMenuItem[],
    photoId?: string,
  ) => void

  closeContextMenu: () => void

  // ── 写操作：主题 ──

  setTheme: (theme: AppTheme) => void
  setResolvedTheme: (theme: 'light' | 'dark') => void

  // ── 写操作：搜索 ──

  setSearchOpen: (v: boolean) => void
  setSearchQuery: (q: string) => void
}

// ─────────────────────────────────────────────────────────
//  Toast ID 生成器
// ─────────────────────────────────────────────────────────

let toastCounter = 0
const genToastId = () => `toast-${Date.now()}-${++toastCounter}`

// ─────────────────────────────────────────────────────────
//  常量
// ─────────────────────────────────────────────────────────

const SIDEBAR_DEFAULT_WIDTH  = 220
const SIDEBAR_MIN_WIDTH      = 160
const SIDEBAR_MAX_WIDTH      = 320
const SIDEBAR_ICON_WIDTH     = 48
const TOAST_MAX_COUNT        = 5   // 最多同时显示 5 条

// ─────────────────────────────────────────────────────────
//  创建 Store
// ─────────────────────────────────────────────────────────

export const useUiStore = create<UiStore>()(
  subscribeWithSelector((set, get) => ({
    // ── 初始值 ──
    sidebarWidth:       SIDEBAR_DEFAULT_WIDTH,
    isSidebarCollapsed:      false,
    isSidebarResizing:       false,
    isPrivateAlbumUnlocked:  false,

    currentView: { type: 'all_photos' },

    scanProgress: null,
    isScanning:   false,

    toasts: [],

    contextMenu: {
      isOpen:  false,
      x:       0,
      y:       0,
      items:   [],
      photoId: null,
    },

    theme:         'system',
    resolvedTheme: 'dark',

    isSearchOpen: false,
    searchQuery:  '',

    // ── 侧边栏 ──
    setSidebarWidth: (width) => {
      const clamped = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, width))
      set({ sidebarWidth: clamped })
    },

    toggleSidebar: () =>
      set((s) => {
        const collapsed = !s.isSidebarCollapsed
        return {
          isSidebarCollapsed: collapsed,
          sidebarWidth: collapsed ? SIDEBAR_ICON_WIDTH : SIDEBAR_DEFAULT_WIDTH,
        }
      }),

    setIsSidebarResizing: (isSidebarResizing) => set({ isSidebarResizing }),
    setPrivateAlbumUnlocked: (isPrivateAlbumUnlocked) => set({ isPrivateAlbumUnlocked }),

    // ── 视图 ──
    setView: (currentView) => {
      set({ currentView })
    },

    // ── 扫描 ──
    setScanProgress: (scanProgress) => {
      set({
        scanProgress,
        isScanning: scanProgress !== null && scanProgress.phase !== 'completed',
      })
    },

    setIsScanning: (isScanning) => set({ isScanning }),

    // ── Toast ──
    addToast: (toastInput) => {
      const id = genToastId()
      const toast: ToastItem = { id, ...toastInput, duration: toastInput.duration ?? 3000 }

      set((s) => {
        // 超出最大数量时移除最早的
        const existing = s.toasts.slice(-(TOAST_MAX_COUNT - 1))
        return { toasts: [...existing, toast] }
      })

      // 自动消失
      if (toast.duration > 0) {
        setTimeout(() => {
          get().removeToast(id)
        }, toast.duration)
      }

      return id
    },

    removeToast: (id) =>
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

    clearToasts: () => set({ toasts: [] }),

    // ── 右键菜单 ──
    openContextMenu: (x, y, items, photoId) =>
      set({ contextMenu: { isOpen: true, x, y, items, photoId: photoId ?? null } }),

    closeContextMenu: () =>
      set((s) => ({
        contextMenu: { ...s.contextMenu, isOpen: false },
      })),

    // ── 主题 ──
    setTheme: (theme) => set({ theme }),
    setResolvedTheme: (resolvedTheme) => set({ resolvedTheme }),

    // ── 搜索 ──
    setSearchOpen: (isSearchOpen) => set({ isSearchOpen }),
    setSearchQuery: (searchQuery) => set({ searchQuery }),
  })),
)

// ─────────────────────────────────────────────────────────
//  选择器
// ─────────────────────────────────────────────────────────

export const selectCurrentView      = (s: UiStore) => s.currentView
export const selectSidebarWidth     = (s: UiStore) => s.sidebarWidth
export const selectIsSidebarCollapsed     = (s: UiStore) => s.isSidebarCollapsed
export const selectIsPrivateAlbumUnlocked = (s: UiStore) => s.isPrivateAlbumUnlocked
export const selectIsSidebarResizing  = (s: UiStore) => s.isSidebarResizing
export const selectScanProgress     = (s: UiStore) => s.scanProgress
export const selectIsScanning       = (s: UiStore) => s.isScanning
export const selectToasts           = (s: UiStore) => s.toasts
export const selectContextMenu      = (s: UiStore) => s.contextMenu
export const selectTheme            = (s: UiStore) => s.theme
export const selectResolvedTheme    = (s: UiStore) => s.resolvedTheme
export const selectIsSearchOpen     = (s: UiStore) => s.isSearchOpen
export const selectSearchQuery      = (s: UiStore) => s.searchQuery

// ─────────────────────────────────────────────────────────
//  便捷 Toast 工厂（供业务代码直接调用）
// ─────────────────────────────────────────────────────────

export const toast = {
  info:    (message: string, action?: ToastItem['action']) =>
    useUiStore.getState().addToast({ message, variant: 'info',    duration: 3000, action }),
  success: (message: string, action?: ToastItem['action']) =>
    useUiStore.getState().addToast({ message, variant: 'success', duration: 3000, action }),
  warning: (message: string, action?: ToastItem['action']) =>
    useUiStore.getState().addToast({ message, variant: 'warning', duration: 5000, action }),
  error:   (message: string, action?: ToastItem['action']) =>
    useUiStore.getState().addToast({ message, variant: 'error',   duration: 0,    action }),
}
