/**
 * @file src/hooks/useKeyboard.ts
 * @description 全局键盘快捷键处理 Hook（v3 — 批量操作模式扩展）
 *
 * v3 变更：
 *   - Esc：isSelectionMode=true 时优先退出选择模式（而非仅清空选中）
 *   - Ctrl+A：isSelectionMode=true 时全选，否则进入选择模式并全选
 *   - Delete：isSelectionMode=true 时对选中项触发删除确认
 *
 * v2 变更（保留）：
 *   - F 键收藏逻辑：全部已收藏→全部取消，否则→全部收藏
 *   - 乐观更新 photoStore + invalidate QueryClient
 */

import { useEffect, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { usePreviewStore } from '@/stores/previewStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { usePhotoStore } from '@/stores/photoStore'
import { api } from '@/services/tauriIpc'
import { toast } from '@/stores/uiStore'

export function useKeyboard(allIds: string[]) {
  const queryClient = useQueryClient()

  const handler = useCallback((e: KeyboardEvent) => {
    const target  = e.target as HTMLElement
    const inInput = target.tagName === 'INPUT'    ||
                    target.tagName === 'TEXTAREA'  ||
                    target.isContentEditable

    // ── 预览模式优先 ──────────────────────────────────
    const preview = usePreviewStore.getState()

    if (preview.isOpen) {
      if (inInput) return

      switch (e.key) {
        case 'Escape':
          e.preventDefault(); preview.close(); return

        case 'ArrowRight':
          e.preventDefault(); preview.next(); return

        case 'ArrowLeft':
          e.preventDefault(); preview.prev(); return

        case 'i': case 'I':
          e.preventDefault(); preview.toggleExif(); return

        case 'f': case 'F': {
          e.preventDefault()
          const photoId = preview.currentPhotoId
          if (!photoId) return
          const photos = usePhotoStore.getState().photos
          const photo  = photos.find((p) => p.id === photoId)
          const newFav = !(photo?.isFavorite ?? false)
          api.photos.setFavorite(photoId, newFav)
            .then(() => {
              usePhotoStore.getState().updatePhoto(photoId, { isFavorite: newFav })
              queryClient.invalidateQueries({ queryKey: ['photos'] })
              toast.success(newFav ? '已添加到收藏' : '已取消收藏')
            })
            .catch(() => toast.error('操作失败'))
          return
        }
      }
      return
    }

    // ── 网格模式：输入框内仅响应 Esc ─────────────────
    if (inInput) {
      if (e.key === 'Escape') (target as HTMLInputElement).blur?.()
      return
    }

    const sel = useSelectionStore.getState()

    switch (true) {

      // Esc：选择模式下退出选择模式；否则清空选中
      case e.key === 'Escape':
        e.preventDefault()
        if (sel.isSelectionMode) {
          sel.exitSelectionMode()
        } else {
          sel.clearSelection()
        }
        break

      // Space：打开预览（焦点项或第一个选中项）
      case e.key === ' ': {
        e.preventDefault()
        // 选择模式下 Space = toggle 焦点项
        if (sel.isSelectionMode) {
          sel.confirmFocus()
          break
        }
        const focusedId = sel.focusedId ?? [...sel.selectedIds][0]
        if (!focusedId) break
        const el = document.querySelector(`[data-photo-id="${focusedId}"]`) as HTMLElement | null
        if (el) {
          usePreviewStore.getState().open(focusedId, allIds, el.getBoundingClientRect())
        }
        break
      }

      // ↑↓←→：移动焦点
      case e.key === 'ArrowDown':
      case e.key === 'ArrowRight':
        e.preventDefault()
        sel.moveFocus(+1, allIds, e.shiftKey)
        break

      case e.key === 'ArrowUp':
      case e.key === 'ArrowLeft':
        e.preventDefault()
        sel.moveFocus(-1, allIds, e.shiftKey)
        break

      // Ctrl+A：进入选择模式（若未激活）并全选
      case e.ctrlKey && e.key === 'a':
        e.preventDefault()
        if (!sel.isSelectionMode) {
          sel.enterSelectionMode()
        }
        sel.selectAll(allIds)
        break

      // Ctrl+Z：撤销
      case e.ctrlKey && e.key === 'z':
        e.preventDefault()
        api.undo.last()
          .then((res) => toast.success(res.detail))
          .catch(() => toast.info('没有可撤销的操作'))
        break

      // ── F：切换收藏 ──────────────────────────────
      case e.key === 'f' || e.key === 'F': {
        e.preventDefault()
        const ids = sel.selectedIds.size > 0
          ? [...sel.selectedIds]
          : sel.focusedId
          ? [sel.focusedId]
          : []
        if (ids.length === 0) break

        const photos   = usePhotoStore.getState().photos
        const allFaved = ids.every((id) => photos.find((p) => p.id === id)?.isFavorite === true)
        const newFav   = !allFaved

        Promise.all(ids.map((id) => api.photos.setFavorite(id, newFav)))
          .then(() => {
            const store = usePhotoStore.getState()
            ids.forEach((id) => store.updatePhoto(id, { isFavorite: newFav }))
            queryClient.invalidateQueries({ queryKey: ['photos'] })
            toast.success(
              newFav
                ? `已收藏 ${ids.length} 张照片`
                : `已取消 ${ids.length} 张照片的收藏`,
            )
          })
          .catch(() => toast.error('操作失败'))
        break
      }

      // Delete：触发删除确认
      case e.key === 'Delete': {
        e.preventDefault()
        const ids = [...sel.selectedIds]
        if (ids.length === 0) break
        document.dispatchEvent(
          new CustomEvent('grid:delete-selected', { detail: { ids } }),
        )
        break
      }
    }
  }, [allIds, queryClient])

  useEffect(() => {
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handler])
}
