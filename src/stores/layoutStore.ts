/**
 * @file src/stores/layoutStore.ts
 * @description 布局偏好状态管理
 *
 * v2 变更（Technical Debt T-04）：
 *   新增 sortBy / sortAsc 排序字段，并与 AppSettings 双向同步：
 *     - 启动时 init() 从 settings_get 恢复
 *     - 变更时 debounce 500ms 写回 settings_update
 *
 * 管理范围：
 *   - 布局模式（grid / waterfall）
 *   - 网格密度级别（1~4）+ GridConfig 运行时缓存
 *   - 排序字段 + 排序方向
 *   - 容器宽度（ResizeObserver 驱动）
 */

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { LayoutMode, DensityLevel, GridConfig } from '@/types/layout'
import type { PhotoSortField } from '@/types/ipc'
import { calcGridConfig, DENSITY_PRESETS } from '@/types/layout'

// ─────────────────────────────────────────────────────────
//  Store 接口
// ─────────────────────────────────────────────────────────

interface LayoutStore {
  // ── 状态 ──

  mode:           LayoutMode
  density:        DensityLevel
  gridConfig:     GridConfig | null
  containerWidth: number

  /** 照片排序字段，默认按拍摄时间 */
  sortBy:  PhotoSortField
  /** true = 升序（旧→新），false = 降序（新→旧，默认）*/
  sortAsc: boolean

  // ── 写操作 ──

  setMode:           (mode: LayoutMode) => void
  setDensity:        (level: DensityLevel) => void
  stepDensity:       (delta: number) => void
  setContainerWidth: (width: number) => void

  /**
   * 同时更新排序字段和排序方向
   * 变更后 debounce 500ms 持久化到 AppSettings
   */
  setSort: (sortBy: PhotoSortField, sortAsc: boolean) => void

  /**
   * 仅切换升降序（排序字段不变）
   */
  toggleSortDir: () => void

  /**
   * 应用启动时从 AppSettings 初始化（由 useTheme 或独立 init hook 调用）
   */
  init: (opts: {
    mode:    LayoutMode
    density: DensityLevel
    sortBy:  PhotoSortField
    sortAsc: boolean
  }) => void
}

// ─────────────────────────────────────────────────────────
//  创建 Store
// ─────────────────────────────────────────────────────────

export const useLayoutStore = create<LayoutStore>()(
  subscribeWithSelector((set, get) => ({
    mode:           'grid',
    density:        2,
    gridConfig:     null,
    containerWidth: 0,
    sortBy:         'created_at',
    sortAsc:        false,        // 默认倒序：最新照片在前

    // ── 布局模式 ──
    setMode: (mode) => set({ mode }),

    // ── 密度 ──
    setDensity: (density) => {
      const { containerWidth } = get()
      set({
        density,
        gridConfig: Number.isFinite(containerWidth) && containerWidth > 0
          ? calcGridConfig(containerWidth, density)
          : null,
      })
    },

    stepDensity: (delta) => {
      const { density } = get()
      const next = Math.max(1, Math.min(4, density + delta)) as DensityLevel
      if (next === density) return
      get().setDensity(next)
    },

    // ── 容器宽度 ──
    setContainerWidth: (containerWidth) => {
      const { density } = get()
      set({
        containerWidth,
        gridConfig: Number.isFinite(containerWidth) && containerWidth > 0
          ? calcGridConfig(containerWidth, density)
          : null,
      })
    },

    // ── 排序 ──
    setSort: (sortBy, sortAsc) => {
      set({ sortBy, sortAsc })
      // 防抖持久化
      scheduleSortPersist(sortBy, sortAsc)
    },

    toggleSortDir: () => {
      const { sortBy, sortAsc } = get()
      get().setSort(sortBy, !sortAsc)
    },

    // ── 初始化 ──
    init: ({ mode, density, sortBy, sortAsc }) => {
      const { containerWidth } = get()
      set({
        mode,
        density,
        sortBy,
        sortAsc,
        gridConfig: Number.isFinite(containerWidth) && containerWidth > 0
          ? calcGridConfig(containerWidth, density)
          : null,
      })
    },
  })),
)

// ─────────────────────────────────────────────────────────
//  排序持久化（防抖 500ms，避免频繁写盘）
// ─────────────────────────────────────────────────────────

let persistTimer: ReturnType<typeof setTimeout> | null = null

function scheduleSortPersist(sortBy: PhotoSortField, sortAsc: boolean) {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(async () => {
    try {
      // 动态导入避免循环依赖
      const { api } = await import('@/services/tauriIpc')
      await api.settings.update({ sortBy, sortAsc })
    } catch {
      // 持久化失败不影响当前会话体验，静默忽略
    }
  }, 500)
}

// ─────────────────────────────────────────────────────────
//  选择器
// ─────────────────────────────────────────────────────────

export const selectMode          = (s: LayoutStore) => s.mode
export const selectDensity       = (s: LayoutStore) => s.density
export const selectGridConfig    = (s: LayoutStore) => s.gridConfig
export const selectIsGrid        = (s: LayoutStore) => s.mode === 'grid'
export const selectIsWaterfall   = (s: LayoutStore) => s.mode === 'waterfall'
export const selectSortBy        = (s: LayoutStore) => s.sortBy
export const selectSortAsc       = (s: LayoutStore) => s.sortAsc

/** 当前密度的文字标签 */
export const selectDensityLabel  = (s: LayoutStore) =>
  DENSITY_PRESETS[s.density].label

/** 排序状态组合（减少 Toolbar 多次订阅） */