/**
 * @file src/stores/selectionStore.ts
 * @description 照片多选状态管理（v2 — 选择模式 + 拖拽框选）
 *
 * v2 新增（最小必要改动，原有逻辑完全保留）：
 *   - isSelectionMode: 显式选择模式开关（控制 checkbox 显示 + BatchActionBar）
 *   - enterSelectionMode / exitSelectionMode：模式切换
 *   - isDragSelecting: 拖拽框选进行中标志（GridItem 的 onPointerEnter 检测）
 *   - beginDragSelect(id) / dragSelectOver(id) / endDragSelect()：
 *     三段式拖拽选中 API，由 GridItem 的 pointer 事件驱动
 *   - selectIsSelectionMode / selectIsDragSelecting：对应选择器
 *
 * 原有选中逻辑（select/toggle/rangeSelect/selectAll/clearSelection/moveFocus）
 * 完全不变，向后兼容。
 *
 * 支持的选中模式（对标 Apple Photos / macOS Finder）：
 *   - 单选：点击（非 Shift/Ctrl/Cmd）
 *   - 追加：Ctrl/Cmd + 点击  → toggle 单项
 *   - 范围：Shift + 点击     → rangeSelect，从 lastClickedId 到当前
 *   - 全选：Ctrl+A           → selectAll
 *   - 清空：Esc / 点击空白   → clearSelection
 *   - 键盘：↑↓ 移动选中      → moveFocus
 *   - 选择模式：工具栏「选择」按钮 / 长按 → enterSelectionMode
 *   - 拖拽框选：长按后拖动经过格子 → beginDragSelect + dragSelectOver
 */

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

// ─────────────────────────────────────────────────────────
//  Store 接口
// ─────────────────────────────────────────────────────────

interface SelectionStore {
  // ── 状态 ──

  /** 当前选中的照片 ID 集合 */
  selectedIds: Set<string>

  /**
   * 最后一次点击的照片 ID
   * Shift+Click 范围选的起点
   */
  lastClickedId: string | null

  /**
   * 键盘焦点 ID（↑↓ 移动时高亮，不一定等于选中）
   */
  focusedId: string | null

  /** v2 新增：是否处于显式选择模式（BatchActionBar 显示，checkbox 可见）*/
  isSelectionMode: boolean

  /** v2 新增：是否正在拖拽框选 */
  isDragSelecting: boolean

  // ── 只读派生 ──

  /** 是否处于多选状态（≥ 2 项被选中）*/
  readonly isMultiSelect: boolean

  // ── v2 新增：模式控制 ──

  /** 进入选择模式（不清除当前选中，由调用方决定是否先 select 当前项）*/
  enterSelectionMode: () => void

  /** 退出选择模式并清空所有选中 */
  exitSelectionMode: () => void

  // ── v2 新增：拖拽框选 ──

  /**
   * 开始拖拽框选（从某格子 pointerDown 触发）
   * 同时选中起始格子
   */
  beginDragSelect: (id: string) => void

  /**
   * 拖拽经过某格子（该格子 onPointerEnter 触发，仅在 isDragSelecting=true 时有效）
   * 将该格子追加到选中集合
   */
  dragSelectOver: (id: string) => void

  /** 结束拖拽框选（pointerUp 触发）*/
  endDragSelect: () => void

  // ── 原有写操作（不变）──

  /**
   * 单选一张（清除其他所有选中）
   * 对应：普通点击
   */
  select: (id: string) => void

  /**
   * 切换单张的选中状态（不清除其他）
   * 对应：Ctrl/Cmd + 点击
   */
  toggle: (id: string) => void

  /**
   * 范围选（Shift + 点击）
   */
  rangeSelect: (id: string, allIds: string[]) => void

  /**
   * 全选当前视图的所有照片
   */
  selectAll: (allIds: string[]) => void

  /** 清空所有选中 */
  clearSelection: () => void

  /**
   * 通过键盘方向键移动焦点（不改变选中状态）
   */
  moveFocus: (delta: number, allIds: string[], withSelect?: boolean) => void

  /** 将焦点项加入选中（Space 键确认） */
  confirmFocus: () => void

  /** 切换视图时重置（避免旧选中态残留） */
  reset: () => void
}

// ─────────────────────────────────────────────────────────
//  创建 Store
// ─────────────────────────────────────────────────────────

export const useSelectionStore = create<SelectionStore>()(
  subscribeWithSelector((set, get) => ({
    selectedIds:     new Set<string>(),
    lastClickedId:   null,
    focusedId:       null,
    isSelectionMode: false,   // v2 新增
    isDragSelecting: false,   // v2 新增

    get isMultiSelect() {
      return get().selectedIds.size >= 2
    },

    // ── v2 新增：模式控制 ──

    enterSelectionMode: () =>
      set({ isSelectionMode: true }),

    exitSelectionMode: () =>
      set({
        isSelectionMode: false,
        isDragSelecting: false,
        selectedIds:     new Set(),
        lastClickedId:   null,
        focusedId:       null,
      }),

    // ── v2 新增：拖拽框选 ──

    beginDragSelect: (id) =>
      set((s) => ({
        isDragSelecting: true,
        selectedIds:     new Set([...s.selectedIds, id]),
        lastClickedId:   id,
        focusedId:       id,
      })),

    dragSelectOver: (id) =>
      set((s) => {
        if (!s.isDragSelecting) return {}
        if (s.selectedIds.has(id)) return {}
        const next = new Set(s.selectedIds)
        next.add(id)
        return { selectedIds: next }
      }),

    endDragSelect: () =>
      set({ isDragSelecting: false }),

    // ── 原有选中逻辑（完全不变）──

    select: (id) =>
      set({
        selectedIds:   new Set([id]),
        lastClickedId: id,
        focusedId:     id,
      }),

    toggle: (id) =>
      set((s) => {
        const next = new Set(s.selectedIds)
        if (next.has(id)) {
          next.delete(id)
        } else {
          next.add(id)
        }
        return {
          selectedIds:   next,
          lastClickedId: id,
          focusedId:     id,
        }
      }),

    rangeSelect: (id, allIds) =>
      set((s) => {
        const anchor = s.lastClickedId
        if (!anchor || anchor === id) {
          return {
            selectedIds:   new Set([id]),
            lastClickedId: id,
            focusedId:     id,
          }
        }

        const fromIdx = allIds.indexOf(anchor)
        const toIdx   = allIds.indexOf(id)

        if (fromIdx === -1 || toIdx === -1) {
          return {
            selectedIds:   new Set([id]),
            lastClickedId: id,
            focusedId:     id,
          }
        }

        const [start, end] = fromIdx <= toIdx
          ? [fromIdx, toIdx]
          : [toIdx, fromIdx]

        const rangeIds = allIds.slice(start, end + 1)

        const next = new Set(s.selectedIds)
        for (const rid of rangeIds) next.add(rid)

        return {
          selectedIds:   next,
          lastClickedId: anchor,
          focusedId:     id,
        }
      }),

    selectAll: (allIds) =>
      set({
        selectedIds:   new Set(allIds),
        lastClickedId: allIds[0] ?? null,
        focusedId:     allIds[0] ?? null,
      }),

    clearSelection: () =>
      set({
        selectedIds:   new Set(),
        lastClickedId: null,
        focusedId:     null,
      }),

    moveFocus: (delta, allIds, withSelect = false) =>
      set((s) => {
        const current = s.focusedId ?? s.lastClickedId
        const idx     = current ? allIds.indexOf(current) : -1
        const nextIdx = Math.max(0, Math.min(allIds.length - 1, idx + delta))
        const nextId  = allIds[nextIdx]
        if (!nextId) return {}

        if (withSelect) {
          const next = new Set(s.selectedIds)
          next.add(nextId)
          return {
            selectedIds:   next,
            focusedId:     nextId,
            lastClickedId: s.lastClickedId ?? nextId,
          }
        }

        return { focusedId: nextId }
      }),

    confirmFocus: () =>
      set((s) => {
        const { focusedId } = s
        if (!focusedId) return {}
        const next = new Set(s.selectedIds)
        if (next.has(focusedId)) {
          next.delete(focusedId)
        } else {
          next.add(focusedId)
        }
        return { selectedIds: next, lastClickedId: focusedId }
      }),

    reset: () =>
      set({
        selectedIds:     new Set(),
        lastClickedId:   null,
        focusedId:       null,
        isSelectionMode: false,   // v2 新增
        isDragSelecting: false,   // v2 新增
      }),
  })),
)

// ─────────────────────────────────────────────────────────
//  选择器
// ─────────────────────────────────────────────────────────

export const selectSelectedIds     = (s: SelectionStore) => s.selectedIds
export const selectSelectedCount   = (s: SelectionStore) => s.selectedIds.size
export const selectFocusedId       = (s: SelectionStore) => s.focusedId
export const selectLastClickedId   = (s: SelectionStore) => s.lastClickedId
export const selectIsSelectionMode = (s: SelectionStore) => s.isSelectionMode  // v2 新增
export const selectIsDragSelecting = (s: SelectionStore) => s.isDragSelecting  // v2 新增

/** 检查单张照片是否被选中（配合 React.memo 避免整个列表重渲染） */
export const selectIsSelected = (id: string) => (s: SelectionStore) =>
  s.selectedIds.has(id)

/** 检查单张照片是否获得键盘焦点 */
export const selectIsFocused = (id: string) => (s: SelectionStore) =>
  s.focusedId === id
