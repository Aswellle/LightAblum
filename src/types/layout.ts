/**
 * @file src/types/layout.ts
 * @description 布局与视图状态相关类型定义（v2 — viewStateToFilter 修复）
 *
 * v2 变更：
 *   viewStateToFilter 修复 recently_imported 排序参数问题。
 *   原实现在 recently_imported case 中直接返回了 sortBy/sortAsc，
 *   但 usePhotoQuery 的 filter 构建逻辑是：
 *     { sortBy, sortAsc, ...base }  （v4 修复后的新顺序）
 *   base 的排序参数会正确覆盖 layoutStore 默认值。
 *
 *   同时：删除 recently_imported 中多余的 sortAsc: false
 *   （sortAsc 通过 layoutStore 的 sortAsc 或视图 base 控制即可，
 *    在 base 中只需指定 sortBy: 'imported_at' 就足够表达"最近导入"语义）
 *
 * 覆盖范围：
 *  - LayoutMode      网格 / 瀑布流
 *  - GridDensity     密度级别到列数/间距的映射
 *  - GridConfig      当前网格配置（运行时计算）
 *  - VirtualRange    虚拟化渲染窗口
 *  - SidebarSection  侧边栏导航项类型
 *  - ViewState       当前视图（所有照片/收藏/相册/搜索…）
 */

// ─────────────────────────────────────────────────────────
//  布局模式
// ─────────────────────────────────────────────────────────

/** 主内容区布局模式 */
export type LayoutMode = 'grid' | 'waterfall'

// ─────────────────────────────────────────────────────────
//  网格密度系统
//  对应 PRD M-3：4 级密度（紧凑/标准/宽松/超大）
// ─────────────────────────────────────────────────────────

/** 密度级别，1=紧凑 4=超大 */
export type DensityLevel = 1 | 2 | 3 | 4

/** 每个密度级别的参数配置 */
export interface DensityPreset {
  level: DensityLevel
  label: string
  /** 推荐列数（1280px 视口） */
  columns: number
  /** 网格间距 px */
  gap: number
  /** 单格最小尺寸 px */
  minItemSize: number
  /** 单格最大尺寸 px */
  maxItemSize: number
}

/** 密度预设查找表（按 level 索引） */
export const DENSITY_PRESETS: Record<DensityLevel, DensityPreset> = {
  1: { level: 1, label: '紧凑', columns: 8,  gap: 2, minItemSize: 80,  maxItemSize: 150 },
  2: { level: 2, label: '标准', columns: 5,  gap: 4, minItemSize: 150, maxItemSize: 240 },
  3: { level: 3, label: '宽松', columns: 4,  gap: 6, minItemSize: 200, maxItemSize: 300 },
  4: { level: 4, label: '超大', columns: 3,  gap: 8, minItemSize: 280, maxItemSize: 400 },
}

// ─────────────────────────────────────────────────────────
//  网格运行时配置
// ─────────────────────────────────────────────────────────

/**
 * 运行时计算的网格配置
 * 每次容器宽度或密度级别变化时重新计算
 */
export interface GridConfig {
  /** 当前列数（根据容器宽度和密度自适应） */
  columns: number
  /** 网格间距 px */
  gap: number
  /** 单格实际像素尺寸（正方形） */
  itemSize: number
  /** 容器宽度 px */
  containerWidth: number
}

/** 根据容器宽度和密度级别计算运行时 GridConfig */
export function calcGridConfig(
  containerWidth: number,
  density: DensityLevel,
): GridConfig {
  // Defensive guard: callers should always pass a valid finite positive width,
  // but in case they don't, fall back to a sensible default rather than producing NaN.
  const w = Number.isFinite(containerWidth) && containerWidth > 0 ? containerWidth : 800

  const preset = DENSITY_PRESETS[density]
  let columns = preset.columns
  const gap = preset.gap

  while (columns > 1) {
    const itemSize = Math.floor((w - gap * (columns + 1)) / columns)
    if (itemSize >= preset.minItemSize) break
    columns--
  }
  while (columns < 12) {
    const itemSize = Math.floor((w - gap * (columns + 1)) / columns)
    if (itemSize <= preset.maxItemSize) break
    columns++
  }

  const itemSize = Math.floor((w - gap * (columns + 1)) / columns)
  // Ensure itemSize is always a valid positive integer
  const safeItemSize = Number.isFinite(itemSize) && itemSize > 0 ? itemSize : preset.minItemSize
  return { columns, gap, itemSize: safeItemSize, containerWidth: w }
}

// ─────────────────────────────────────────────────────────
//  虚拟化渲染窗口
// ─────────────────────────────────────────────────────────

export interface VirtualRange {
  startRow: number
  endRow: number
  visibleStartRow: number
  visibleEndRow: number
  offsetTop: number
  offsetBottom: number
}

export interface WaterfallItem {
  photoId: string
  column: number
  top: number
  width: number
  height: number
}

// ─────────────────────────────────────────────────────────
//  侧边栏导航
// ─────────────────────────────────────────────────────────

export type SidebarItemType =
  | 'all_photos'
  | 'favorites'
  | 'recently_imported'
  | 'album'
  | 'folder'
  | 'settings'

export interface SidebarItem {
  type: SidebarItemType
  id: string
  label: string
  icon: string
  count?: number
}

// ─────────────────────────────────────────────────────────
//  视图状态（当前显示什么）
// ─────────────────────────────────────────────────────────

export type ViewType =
  | 'all_photos'
  | 'favorites'
  | 'recently_imported'
  | 'album'
  | 'folder'
  | 'search'
  | 'trash'

export type ViewState =
  | { type: 'all_photos' }
  | { type: 'favorites' }
  | { type: 'recently_imported' }
  | { type: 'album';  albumId: string }
  | { type: 'folder'; folderPath: string }
  | { type: 'search'; query: string }
  | { type: 'trash' }

/**
 * 从 ViewState 推导出对应的 PhotoFilter 字段
 *
 * v2 修复：
 *   返回的 filter 对象仅包含"视图特有"的约束字段。
 *   排序字段（sortBy/sortAsc）在视图有特殊需求时才在此设置，
 *   并由 usePhotoQuery 以 `{ sortBy, sortAsc, ...base }` 方式合并，
 *   确保视图特定排序（如 recently_imported 的 imported_at）
 *   覆盖 layoutStore 的全局默认排序。
 *
 *   recently_imported 的 sortAsc 不在此设置（false 是默认值），
 *   由 layoutStore.sortAsc（默认 false）提供即可，避免重复指定。
 */
export function viewStateToFilter(view: ViewState): import('./ipc').PhotoFilter {
  switch (view.type) {
    case 'all_photos':
      return { isDeleted: false }

    case 'favorites':
      return { favoritesOnly: true, isDeleted: false }

    case 'recently_imported':
      // sortBy: 'imported_at' 覆盖 layoutStore 的 created_at 默认值
      // sortAsc 使用 layoutStore 的值（默认 false = 最新在前）
      return { sortBy: 'imported_at', isDeleted: false }

    case 'album':
      return { albumId: view.albumId, isDeleted: false }

    case 'folder':
      return { folderPath: view.folderPath, isDeleted: false }

    case 'search':
      // 搜索视图的过滤由 useSearchQuery 单独处理
      return { isDeleted: false }

    case 'trash':
      return { isDeleted: true }

    default:
      return { isDeleted: false }
  }
}

// ─────────────────────────────────────────────────────────
//  预览相关
// ─────────────────────────────────────────────────────────

/** 大图预览的飞入飞出动画起始/终止矩形 */
export interface SourceRect {
  x: number
  y: number
  width: number
  height: number
}

/** 大图切换方向 */
export type PreviewDirection = 'next' | 'prev'
