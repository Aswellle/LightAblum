/**
 * @file src/hooks/useVirtualGrid.ts
 * @description 虚拟网格引擎核心 Hook
 *
 * 设计目标：
 *   - 10 万张照片下滚动帧率 ≥ 55fps（PRD G-2）
 *   - 仅渲染视口 ± 2 行的 DOM 节点（overscan）
 *   - 上下两个 padding div 占位，保持滚动条精确
 *   - 支持「日期分组标题行」混入（高度与照片行不同）
 *   - requestAnimationFrame 节流，避免每次 scroll 事件都触发 setState
 *
 * 核心数据结构：
 *   VirtualRow — 一行的描述信息
 *     type: 'group-header' | 'photo-row'
 *     items: 该行的照片 ID 列表（photo-row）或分组信息（group-header）
 *     height: 行高 px
 *     top: 距顶部的累计偏移 px
 *
 * 布局计算流程：
 *   photos（扁平列表）
 *     → buildRows()：按月分组，插入 header 行，切分 photo 行
 *     → rowMeta[]：每行的 top/height（一次性计算，只在 photos/config 变化时重算）
 *     → onScroll → rAF → calcVisibleRange()：二分查找可见行范围
 *     → setVisibleRows()：仅更新可见切片，不重建全量数组
 *
 * 输出给 VirtualGrid 组件的数据：
 *   containerRef   — 绑定到滚动容器
 *   totalHeight    — 总高度（撑起滚动条）
 *   offsetTop      — 可见区域上方占位高度
 *   offsetBottom   — 可见区域下方占位高度
 *   visibleRows    — 当前需渲染的行（含 overscan）
 *   allPhotoIds    — 扁平化照片 ID 列表（供快捷键导航）
 */

import {
  useRef,
  useState,
  useEffect,
  useMemo,
  useCallback,
} from 'react'
import type { PhotoThumb, PhotoGroup } from '@/types/photo'
import type { GridConfig } from '@/types/layout'

// ─────────────────────────────────────────────────────────
//  行类型定义
// ─────────────────────────────────────────────────────────

export interface GroupHeaderRow {
  type:          'group-header'
  key:           string           // 分组 key，如 '2025-03'
  label:         string           // 显示标签，如 '2025年3月'
  count:         number           // 组内照片总数
  /** Fix: 本组所有照片 ID（供 DateGroup 「全选本组」正确选中本组照片） */
  groupPhotoIds: string[]
  height:        number           // 行高 px（固定 40px）
  top:           number           // 距容器顶部 px
}

export interface PhotoRow {
  type:    'photo-row'
  key:     string           // 唯一 key，如 'row-2025-03-0'
  photos:  PhotoThumb[]     // 该行最多 columns 张
  height:  number           // 行高 = itemSize + gap
  top:     number           // 距容器顶部 px
}

export type VirtualRow = GroupHeaderRow | PhotoRow

// ─────────────────────────────────────────────────────────
//  常量
// ─────────────────────────────────────────────────────────

const GROUP_HEADER_HEIGHT = 44   // px，分组标题行高度
const OVERSCAN_ROWS       = 3    // 视口外额外渲染行数（上下各）

// ─────────────────────────────────────────────────────────
//  buildRows — 将分组数据转为行数组（含顶部偏移预计算）
// ─────────────────────────────────────────────────────────

function buildRows(
  groups:   PhotoGroup[],
  config:   GridConfig,
): VirtualRow[] {
  const rows: VirtualRow[] = []
  const { columns, itemSize, gap } = config
  const photoRowHeight = itemSize + gap

  let top = 0

  for (const group of groups) {
    // 分组标题行
    const headerRow: GroupHeaderRow = {
      type:          'group-header',
      key:           `header-${group.key}`,
      label:         group.label,
      count:         group.photos.length,
      groupPhotoIds: group.photos.map((p) => p.id),  // Fix: for DateGroup select
      height:        GROUP_HEADER_HEIGHT,
      top,
    }
    rows.push(headerRow)
    top += GROUP_HEADER_HEIGHT

    // 照片行（每行最多 columns 张）
    for (let i = 0; i < group.photos.length; i += columns) {
      const slice = group.photos.slice(i, i + columns)
      const photoRow: PhotoRow = {
        type:   'photo-row',
        key:    `row-${group.key}-${i}`,
        photos: slice,
        height: photoRowHeight,
        top,
      }
      rows.push(photoRow)
      top += photoRowHeight + gap   // 行间距也算在这里
    }
  }

  return rows
}

// ─────────────────────────────────────────────────────────
//  calcVisibleRange — 二分查找可见行范围
// ─────────────────────────────────────────────────────────

function calcVisibleRange(
  rows:         VirtualRow[],
  scrollTop:    number,
  clientHeight: number,
): { startIdx: number; endIdx: number } {
  if (rows.length === 0) return { startIdx: 0, endIdx: 0 }

  const viewBottom = scrollTop + clientHeight

  // 二分查找第一个可见行（bottom > scrollTop）
  let lo = 0, hi = rows.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    const row = rows[mid]
    if (row.top + row.height <= scrollTop) lo = mid + 1
    else hi = mid
  }
  const firstVisible = lo

  // 线性扫描到最后一个可见行（top < viewBottom）
  let lastVisible = firstVisible
  while (lastVisible < rows.length - 1 && rows[lastVisible + 1].top < viewBottom) {
    lastVisible++
  }

  return {
    startIdx: Math.max(0, firstVisible - OVERSCAN_ROWS),
    endIdx:   Math.min(rows.length - 1, lastVisible + OVERSCAN_ROWS),
  }
}

// ─────────────────────────────────────────────────────────
//  Hook Options & Return
// ─────────────────────────────────────────────────────────

export interface UseVirtualGridOptions {
  groups:    PhotoGroup[]
  config:    GridConfig | null
}

export interface UseVirtualGridResult {
  containerRef:  React.RefObject<HTMLDivElement | null>
  totalHeight:   number
  offsetTop:     number
  offsetBottom:  number
  visibleRows:   VirtualRow[]
  /** 扁平化的全部照片 ID（供键盘导航 / 全选使用） */
  allPhotoIds:   string[]
  /** 当前视口正中心的照片 ID（缩略图优先级用） */
  centerPhotoId: string | null
}

// ─────────────────────────────────────────────────────────
//  useVirtualGrid — 主 Hook
// ─────────────────────────────────────────────────────────

export function useVirtualGrid({
  groups,
  config,
}: UseVirtualGridOptions): UseVirtualGridResult {
  const containerRef = useRef<HTMLDivElement>(null)
  const rafRef       = useRef<number | null>(null)
  const scrollTopRef = useRef(0)

  // ── 预计算所有行（仅当 groups / config 变化时重算）──
  const allRows = useMemo(() => {
    if (!config || groups.length === 0) return []
    return buildRows(groups, config)
  }, [groups, config])

  // ── 总高度 ──
  const totalHeight = useMemo(() => {
    if (allRows.length === 0) return 0
    const last = allRows[allRows.length - 1]
    return last.top + last.height
  }, [allRows])

  // ── 扁平化照片 ID ──
  const allPhotoIds = useMemo(() => {
    const ids: string[] = []
    for (const row of allRows) {
      if (row.type === 'photo-row') {
        for (const p of row.photos) ids.push(p.id)
      }
    }
    return ids
  }, [allRows])

  // ── 可见行切片 ──
  const [range, setRange] = useState({ startIdx: 0, endIdx: 0 })

  const recompute = useCallback(() => {
    rafRef.current = null
    const el = containerRef.current
    if (!el) return
    const { scrollTop, clientHeight } = el
    scrollTopRef.current = scrollTop
    const next = calcVisibleRange(allRows, scrollTop, clientHeight)
    setRange((prev) =>
      prev.startIdx === next.startIdx && prev.endIdx === next.endIdx
        ? prev   // 引用稳定，避免无意义 re-render
        : next,
    )
  }, [allRows])

  // rAF 节流：每帧最多触发一次 recompute
  const scheduleRecompute = useCallback(() => {
    if (rafRef.current !== null) return
    rafRef.current = requestAnimationFrame(recompute)
  }, [recompute])

  // ── 绑定滚动事件 ──
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.addEventListener('scroll', scheduleRecompute, { passive: true })
    recompute()   // 初次计算
    return () => {
      el.removeEventListener('scroll', scheduleRecompute)
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [scheduleRecompute, recompute])

  // ── 当 allRows 变化时（视图切换 / 数据追加）强制重算 ──
  useEffect(() => {
    recompute()
  }, [allRows, recompute])

  // ── 切片 ──
  const visibleRows = useMemo(
    () => allRows.slice(range.startIdx, range.endIdx + 1),
    [allRows, range],
  )

  // ── 占位高度 ──
  const offsetTop = useMemo(
    () => (allRows[range.startIdx]?.top ?? 0),
    [allRows, range.startIdx],
  )
  const offsetBottom = useMemo(() => {
    if (allRows.length === 0) return 0
    const lastVisible = allRows[range.endIdx]
    if (!lastVisible) return 0
    return Math.max(0, totalHeight - lastVisible.top - lastVisible.height)
  }, [allRows, range.endIdx, totalHeight])

  // ── 视口中心照片（缩略图优先级用）──
  const centerPhotoId = useMemo(() => {
    const el = containerRef.current
    const clientH = el?.clientHeight ?? 0
    const centerY = scrollTopRef.current + clientH / 2

    for (const row of visibleRows) {
      if (row.type !== 'photo-row') continue
      if (row.top <= centerY && centerY < row.top + row.height) {
        return row.photos[Math.floor(row.photos.length / 2)]?.id ?? null
      }
    }
    return null
  }, [visibleRows])

  return {
    containerRef,
    totalHeight,
    offsetTop,
    offsetBottom,
    visibleRows,
    allPhotoIds,
    centerPhotoId,
  }
}
