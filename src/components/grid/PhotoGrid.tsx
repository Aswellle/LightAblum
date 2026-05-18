/**
 * @file src/components/grid/PhotoGrid.tsx
 * @description 照片网格视图容器（v2/Fix: 接入标签搜索视图 useTagPhotoQuery）
 *
 * v2 新增（最小必要改动）：
 *   注册全局 window.addEventListener('pointerup', endDragSelect)。
 *
 *   原因：拖拽框选时用户可能在格子外部松开鼠标，此时
 *   GridItem 的 onPointerUp 不会触发（因为鼠标不在格子上），
 *   isDragSelecting 永远不会被清除，导致后续任何 hover 都会追加选中。
 *   全局监听确保任意位置松开鼠标都能结束拖拽。
 *
 * v1 内容（完全保留，不变）：
 *   1. 调用 usePhotoQuery 获取当前视图的分页数据
 *   2. 注册全局键盘快捷键（useKeyboard）
 *   3. 监听删除/添加到相册的 CustomEvent（由 GridItem / useKeyboard 发出）
 *   4. 根据 layoutStore.mode 路由到 VirtualGrid 或 WaterfallGrid
 */

import { useEffect, useCallback } from 'react'
import { usePhotoQuery } from '@/hooks/usePhotoQuery'
import { useTagPhotoQuery } from '@/hooks/useTagPhotoQuery'  // Fix: tag search
import { useKeyboard } from '@/hooks/useKeyboard'
import { useLayoutStore, selectMode } from '@/stores/layoutStore'

import { usePhotoStore, selectPhotos } from '@/stores/photoStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { useConfirmDialog } from '@/components/common/ConfirmDialog'
import { api } from '@/services/tauriIpc'
import { toast } from '@/stores/uiStore'
import { VirtualGrid } from './VirtualGrid'
import { WaterfallGrid } from './WaterfallGrid'
import { useQueryClient } from '@tanstack/react-query'

export function PhotoGrid() {
  const mode           = useLayoutStore(selectMode)
  const photos         = usePhotoStore(selectPhotos)
  const allIds         = photos.map((p) => p.id)
  const clearSelection = useSelectionStore((s) => s.clearSelection)
  const endDragSelect  = useSelectionStore((s) => s.endDragSelect)   // v2 新增
  const removePhotos   = usePhotoStore((s) => s.removePhotos)
  const confirm        = useConfirmDialog()
  const queryClient    = useQueryClient()

  // ── 数据查询（同步到 photoStore）──
  // Fix: 标签视图使用专用查询 hook，普通视图走 usePhotoQuery
  const tagQuery = useTagPhotoQuery()
  const baseQuery = usePhotoQuery()
  const isLoading = tagQuery.isTagSearch ? tagQuery.isLoading : baseQuery.isLoading
  const loadMore  = tagQuery.isTagSearch ? (() => {}) : baseQuery.loadMore
  const hasMore   = tagQuery.isTagSearch ? false : baseQuery.hasMore

  // ── 键盘快捷键 ──
  useKeyboard(allIds)

  // ── 视图切换时清空选中 ──
  useEffect(() => {
    clearSelection()
  }, [clearSelection])

  // ── v2 新增：全局 pointerup → 结束拖拽框选 ──
  //
  // 原因：用户在格子外部松开鼠标时，GridItem.onPointerUp 不触发，
  // isDragSelecting 无法被清除，后续任何 hover 都会追加选中。
  // 全局监听确保任意位置松开鼠标都能正确结束拖拽。
  useEffect(() => {
    const handlePointerUp = () => endDragSelect()
    window.addEventListener('pointerup', handlePointerUp)
    return () => window.removeEventListener('pointerup', handlePointerUp)
  }, [endDragSelect])

  // ── 监听删除事件（由 GridItem 右键 / Delete 键触发）──
  const handleDeleteSelected = useCallback(async (e: Event) => {
    const ids = (e as CustomEvent<{ ids: string[] }>).detail.ids
    if (ids.length === 0) return

    const ok = await confirm({
      title:        `删除 ${ids.length} 张照片`,
      message:      '照片将移入回收站，可在回收站中恢复',
      confirmLabel: '删除',
      variant:      'danger',
      detail:       ids.length > 1 ? `已选中 ${ids.length} 张` : undefined,
    })
    if (!ok) return

    try {
      await api.photos.delete(ids)
      removePhotos(ids)
      clearSelection()
      queryClient.invalidateQueries({ queryKey: ['photos'] })
      toast.success(`已移入回收站`, {
        label:   '撤销',
        onClick: async () => {
          await api.photos.restore(ids)
          queryClient.invalidateQueries({ queryKey: ['photos'] })
          toast.success('已恢复')
        },
      })
    } catch {
      toast.error('删除失败')
    }
  }, [confirm, removePhotos, clearSelection, queryClient])

  useEffect(() => {
    document.addEventListener('grid:delete-selected', handleDeleteSelected)
    return () => document.removeEventListener('grid:delete-selected', handleDeleteSelected)
  }, [handleDeleteSelected])

  // ── 布局路由 ──
  if (mode === 'waterfall') {
    return <WaterfallGrid />
  }

  return (
    <VirtualGrid
      isLoading={isLoading}
      onLoadMore={loadMore}
      hasMore={hasMore}
    />
  )
}
