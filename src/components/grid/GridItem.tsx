/**
 * @file src/components/grid/GridItem.tsx
 * @description 照片网格单元格（v4 — 选择模式多选行为修复）
 *
 * v4 修复（最小必要改动）：
 *
 * 1. 选择模式下单击选中照片（而非进入预览）
 *    根因：handleClick 没有读取 isSelectionMode，始终执行预览逻辑。
 *    修复：isSelectionMode=true 时，单击 → toggle()，
 *          Shift+单击 → rangeSelect()，不触发预览。
 *
 * 2. 长按拖动鼠标经过图片自动批量选中
 *    实现：三段式拖拽框选
 *      onPointerDown (左键 + 已在选择模式) → beginDragSelect(id)
 *      onPointerEnter (isDragSelecting=true) → dragSelectOver(id)
 *      onPointerUp / onPointerCancel → endDragSelect()
 *    非选择模式时：长按 500ms → enterSelectionMode + select + beginDragSelect
 *
 * 保留 v3 改动（私密相册缓存刷新 + 白色圆形红心底板）。
 * 保留 v1/v2 改动（F-10 CSS hover + F-09 相册懒加载）。
 */

import { memo, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { useThumbnail } from '@/hooks/useThumbnail'
import { usePreviewStore } from '@/stores/previewStore'
import {
  useSelectionStore,
  selectIsSelected,
  selectIsFocused,
  selectIsSelectionMode,
  selectIsDragSelecting,
} from '@/stores/selectionStore'
import { useUiStore } from '@/stores/uiStore'
import { usePhotoStore, selectPhotos } from '@/stores/photoStore'
import { useAlbumContext } from '@/components/album/AlbumView'
import { Icon } from '@/components/common/Icon'
import { api } from '@/services/tauriIpc'
import { toast } from '@/stores/uiStore'
import type { PhotoThumb } from '@/types/photo'
import type { AlbumSummary } from '@/types/album'
import type { Tag } from '@/types/ipc'
import { useTagEditor } from '@/components/common/TagEditor'  // Phase-B M-12

// ─────────────────────────────────────────────────────────
//  骨架屏
// ─────────────────────────────────────────────────────────

// ── 选择模式拖拽标志（模块级，所有 GridItem 实例共享）──────────────
//
// 修复：多选模式下单击无法选中
//   根因：handlePointerDown 在选择模式下立即调用 beginDragSelect(id)，
//   将照片加入 selectedIds，随后 handleClick 的 toggle(id) 又将其移出，
//   单击净效果为零，照片看起来没有被选中。
//
// 修复方案：
//   selModePointerHeld = true 表示"左键已按下且尚未释放，可能开始拖拽"。
//   仅在 handlePointerEnter 检测到指针移入 **其他** 格子时才调用
//   beginDragSelect（真正开始拖拽）。纯单击则由 handleClick 的 toggle 处理。
//   dragEverStarted = true 表示本次按压-释放周期中确实发生了跨格拖拽，
//   click 事件中据此跳过 toggle（避免取消拖选的最后一格）。
let selModePointerHeld = false
let dragEverStarted    = false

function SkeletonCell({ size }: { size: number }) {
  return (
    <div style={{
      width:           size,
      height:          size,
      backgroundColor: 'var(--la-bg-overlay)',
      backgroundImage: 'linear-gradient(90deg, var(--la-bg-overlay) 0%, var(--la-bg-hover) 50%, var(--la-bg-overlay) 100%)',
      backgroundSize:  '200% 100%',
      animation:       'la-shimmer 1.5s linear infinite',
    }} />
  )
}

// ─────────────────────────────────────────────────────────
//  CheckboxOverlay — 选择模式下的圆形 checkbox
// ─────────────────────────────────────────────────────────

function CheckboxOverlay({ isSelected }: { isSelected: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.7 }}
      animate={{ opacity: 1, scale: 1   }}
      exit={{    opacity: 0, scale: 0.7 }}
      transition={{ duration: 0.12, ease: [0.34, 1.56, 0.64, 1] }}
      style={{
        position:        'absolute',
        top:             6, left: 6,
        width:           22, height: 22,
        borderRadius:    '50%',
        backgroundColor: isSelected ? 'var(--la-accent)' : 'rgba(0,0,0,0.35)',
        border:          `2px solid ${isSelected ? 'var(--la-accent)' : 'rgba(255,255,255,0.75)'}`,
        display:         'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow:       '0 1px 4px rgba(0,0,0,0.35)',
        transition:      'background-color 120ms ease, border-color 120ms ease',
        zIndex:          2,
        pointerEvents:   'none',
      }}
    >
      {isSelected && <Icon name="check" size={12} color="#fff" strokeWidth={3} />}
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────
//  GridItem
// ─────────────────────────────────────────────────────────

interface GridItemProps {
  photo:  PhotoThumb
  size:   number
  allIds: string[]
}

export const GridItem = memo(function GridItem({ photo, size, allIds }: GridItemProps) {
  const divRef         = useRef<HTMLDivElement>(null)
  const clickTimeRef   = useRef(0)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isLongPressed  = useRef(false)

  const queryClient = useQueryClient()

  // ── Store 订阅 ──
  const isSelected      = useSelectionStore(selectIsSelected(photo.id))
  const isFocused       = useSelectionStore(selectIsFocused(photo.id))
  const isSelectionMode = useSelectionStore(selectIsSelectionMode)   // v4 新增
  const isDragSelecting = useSelectionStore(selectIsDragSelecting)   // v4 新增

  const select          = useSelectionStore((s) => s.select)
  const toggle          = useSelectionStore((s) => s.toggle)
  const rangeSelect     = useSelectionStore((s) => s.rangeSelect)
  const enterSelection  = useSelectionStore((s) => s.enterSelectionMode)  // v4 新增
  const beginDragSelect = useSelectionStore((s) => s.beginDragSelect)     // v4 新增
  const dragSelectOver  = useSelectionStore((s) => s.dragSelectOver)      // v4 新增
  const endDragSelect   = useSelectionStore((s) => s.endDragSelect)       // v4 新增

  const updatePhoto = usePhotoStore((s) => s.updatePhoto)  // Fix: for immediate UI update on favorite
  const openPreview = usePreviewStore((s) => s.open)
  const openCtxMenu = useUiStore((s) => s.openContextMenu)
  const photoIds    = usePhotoStore(selectPhotos).map((p) => p.id)

  const { albumId, isPrivateAlbum, removeFromAlbum } = useAlbumContext()
  const openTagEditor = useTagEditor()  // Phase-B M-12

  const { url: thumbUrl } = useThumbnail(photo.id, 's', 'normal')

  // Fix: 加载照片标签，用于网格角标展示（TDZ 修复：移除 enabled:!!thumbUrl 跨 hook 依赖）
  const { data: photoTags = [] } = useQuery<Tag[]>({
    queryKey: ['photo-tags', photo.id],
    queryFn:  () => api.tags.getForPhoto(photo.id),
    staleTime: 60_000,
    // 无条件启用：小查询，避免 enabled:!!thumbUrl 跨 hook 引用产生 TDZ 崩溃
    enabled:  true,
  })

  // ── 清除长按计时器 ──
  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  // ── v4+：PointerDown — 长按检测 + 拖拽框选准备 ──
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return   // 仅左键

    isLongPressed.current = false

    if (isSelectionMode) {
      // 修复：不在此处调用 beginDragSelect。
      // 仅设置标志，等待 pointerEnter 移入其他格子时才真正开始拖拽框选。
      // 若用户直接松开（纯单击），由 handleClick 的 toggle 完成选中/取消。
      selModePointerHeld = true
      dragEverStarted    = false
      return
    }

    // 非选择模式：500ms 长按 → 进入选择模式 + 开始拖拽框选
    longPressTimer.current = setTimeout(() => {
      isLongPressed.current = true
      enterSelection()
      select(photo.id)
      beginDragSelect(photo.id)
      if ('vibrate' in navigator) navigator.vibrate(10)
    }, 500)
  }, [isSelectionMode, photo.id, enterSelection, select, beginDragSelect])

  // ── v4+：PointerUp — 结束拖拽框选，清除标志 ──
  const handlePointerUp = useCallback(() => {
    selModePointerHeld = false
    cancelLongPress()
    endDragSelect()
  }, [cancelLongPress, endDragSelect])

  // ── v4+：PointerEnter — 开始或继续拖拽框选 ──
  const handlePointerEnter = useCallback(() => {
    if (isDragSelecting) {
      // 拖拽已在进行中：追加本格
      dragSelectOver(photo.id)
      return
    }
    if (selModePointerHeld) {
      // 指针按住并移入其他格子：真正开始拖拽
      selModePointerHeld = false
      dragEverStarted    = true
      beginDragSelect(photo.id)
    }
  }, [isDragSelecting, photo.id, dragSelectOver])

  // ── v4 Fix 1：Click — 选择模式下单击=选中，正常模式=预览 ──
  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()

    // 长按已触发：忽略随后的 click 事件
    if (isLongPressed.current) {
      isLongPressed.current = false
      return
    }

    cancelLongPress()

    // 选择模式下：单击 → toggle / Shift+单击 → rangeSelect（不进入预览）
    if (isSelectionMode) {
      if (dragEverStarted) {
        // 本次交互发生了跨格拖拽：拖拽已更新了选中集合，不再 toggle
        // （避免松开鼠标时把最后经过的格子反向取消选中）
        dragEverStarted = false
        return
      }
      if (e.shiftKey) {
        rangeSelect(photo.id, allIds)
      } else {
        toggle(photo.id)
      }
      return
    }

    // 正常模式：双击 → 预览，修饰键 → 选中
    const now = Date.now()
    const isDoubleClick = now - clickTimeRef.current < 300
    clickTimeRef.current = now

    if (isDoubleClick) {
      const rect = divRef.current?.getBoundingClientRect()
      if (rect) openPreview(photo.id, photoIds, rect)
      return
    }

    if (e.shiftKey) {
      rangeSelect(photo.id, allIds)
    } else if (e.ctrlKey || e.metaKey) {
      toggle(photo.id)
    } else {
      select(photo.id)
      const rect = divRef.current?.getBoundingClientRect()
      if (rect) openPreview(photo.id, photoIds, rect)
    }
  }, [
    photo.id, photoIds, allIds, isSelectionMode,
    select, toggle, rangeSelect, openPreview, cancelLongPress,
  ])

  // ── 右键菜单（F-09 + v3 私密相册缓存修复）──
  const handleContextMenu = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    cancelLongPress()
    endDragSelect()

    const selStore      = useSelectionStore.getState()
    const isMultiSelect = selStore.selectedIds.size > 1 && selStore.selectedIds.has(photo.id)
    if (!selStore.selectedIds.has(photo.id)) select(photo.id)

    const selectedIds = isMultiSelect ? [...selStore.selectedIds] : [photo.id]

    // 使用 listAll 获取含私密相册的完整列表（v3）
    let albums: AlbumSummary[] = []
    try {
      albums = await queryClient.ensureQueryData<AlbumSummary[]>({
        queryKey:  ['albums-all'],
        queryFn:   api.albums.listAll,
        staleTime: 5 * 60 * 1000,
      })
    } catch { /* 获取失败不阻断菜单 */ }

    const albumSubmenu = albums.map((album) => ({
      id:    `add-${album.id}`,
      label: album.name,
      icon:  (album.isPrivate ? 'lock' : 'book') as const,
      onClick: () => {
        api.albums.addPhotos(album.id, selectedIds)
          .then(() => {
            toast.success(
              album.isPrivate
                ? `已添加到私密相册「${album.name}」`
                : `已添加到「${album.name}」`
            )
            // Fix: 添加成功后刷新相关缓存，确保切换到相册时立即看到新照片
            // 1. 刷新 photos 查询缓存（覆盖所有 filter 组合，包括该相册的 filter）
            queryClient.invalidateQueries({ queryKey: ['photos'] })
            // 2. 刷新相册详情（封面/照片数量更新）
            queryClient.invalidateQueries({ queryKey: ['album', album.id] })
            // 3. 刷新相册列表（sidebar photoCount 更新）
            queryClient.invalidateQueries({ queryKey: ['albums'] })
            // 4. Fix: 刷新 sidebar stats（总数更新）
            queryClient.invalidateQueries({ queryKey: ['stats'] })
            // 3. 私密相册额外重置（强制重新分页加载，确保私密过滤立即生效）
            if (album.isPrivate) {
              queryClient.resetQueries({ queryKey: ['photos'] })
            }
          })
          .catch(() => toast.error('添加失败'))
      },
    }))

    const items = isMultiSelect
      ? [
          // 私密相册内禁止添加到其他相册
          ...(!isPrivateAlbum ? [{
            id: 'add-to-album', label: `添加 ${selectedIds.length} 张到相册`, icon: 'book' as const,
            children: albumSubmenu.length > 0
              ? albumSubmenu
              : [{ id: 'no-album', label: '暂无相册', disabled: true, icon: 'book' as const }],
          }] : []),
          ...(albumId ? [{
            id: 'remove-from-album',
            label: isPrivateAlbum
              ? `移出私密相册 ${selectedIds.length} 张`
              : `从相册移除 ${selectedIds.length} 张`,
            icon: isPrivateAlbum ? 'lock' as const : 'x' as const, danger: true,
            onClick: () => removeFromAlbum(selectedIds),
          }] : []),
          { id: 'sep1', label: '', separator: true },
          // 私密相册内禁止收藏
          ...(!isPrivateAlbum ? [{
            id: 'favorite', label: '批量收藏', icon: 'heart' as const,
            onClick: () => {
              // Fix: optimistic update for all selected + invalidate for favorites view
              selectedIds.forEach((id) => usePhotoStore.getState().updatePhoto(id, { isFavorite: true }))
              Promise.all(selectedIds.map((id) => api.photos.setFavorite(id, true)))
                .then(() => {
                  queryClient.invalidateQueries({ queryKey: ['photos'] })
                  // Fix: refresh sidebar counts after batch favorite
                  queryClient.invalidateQueries({ queryKey: ['stats'] })
                })
                .catch(() => {
                  // Rollback
                  selectedIds.forEach((id) => usePhotoStore.getState().updatePhoto(id, { isFavorite: false }))
                  toast.error('操作失败')
                })
            },
          }] : []),
          { id: 'sep2', label: '', separator: true },
          {
            id: 'delete', label: `删除 ${selectedIds.length} 张`, icon: 'trash' as const, danger: true,
            onClick: () => document.dispatchEvent(
              new CustomEvent('grid:delete-selected', { detail: { ids: selectedIds } }),
            ),
          },
        ]
      : [
          {
            id: 'open', label: '在大图中查看', icon: 'eye' as const,
            onClick: () => {
              const rect = divRef.current?.getBoundingClientRect()
              if (rect) openPreview(photo.id, photoIds, rect)
            },
          },
          // 私密相册内禁止添加到其他相册
          ...(!isPrivateAlbum ? [{
            id: 'add-to-album', label: '添加到相册', icon: 'book' as const,
            children: albumSubmenu.length > 0
              ? albumSubmenu
              : [{ id: 'no-album', label: '暂无相册（新建后可用）', disabled: true, icon: 'book' as const }],
          }] : []),
          ...(albumId ? [{
            id: 'remove-from-album',
            label: isPrivateAlbum ? '移出私密相册' : '从相册移除',
            icon: isPrivateAlbum ? 'lock' as const : 'x' as const, danger: true,
            onClick: () => removeFromAlbum([photo.id]),
          }] : []),
          // Phase-B M-12：标签管理（私密相册内禁用）
          ...(!isPrivateAlbum ? [{
            id: 'manage-tags', label: '管理标签', icon: 'tag' as const,
            onClick: () => openTagEditor(photo.id),
          }] : []),
          { id: 'sep1', label: '', separator: true },
          // 私密相册内禁止收藏
          ...(!isPrivateAlbum ? [{
            id:      'favorite',
            label:   photo.isFavorite ? '取消收藏' : '收藏',
            icon:    (photo.isFavorite ? 'heart-fill' : 'heart') as const,
            onClick: () => {
              const newFav = !photo.isFavorite
              // Fix: update photoStore immediately (heart badge) + invalidate cache (favorites view)
              usePhotoStore.getState().updatePhoto(photo.id, { isFavorite: newFav })
              api.photos.setFavorite(photo.id, newFav)
                .then(() => {
                  queryClient.invalidateQueries({ queryKey: ['photos'] })
                  // Fix: refresh sidebar counts after favorite toggle
                  queryClient.invalidateQueries({ queryKey: ['stats'] })
                })
                .catch(() => {
                  // Rollback optimistic update on failure
                  usePhotoStore.getState().updatePhoto(photo.id, { isFavorite: photo.isFavorite })
                  toast.error('操作失败')
                })
            },
          }] : []),
          { id: 'sep2', label: '', separator: true },
          {
            id: 'delete', label: '删除', icon: 'trash' as const, danger: true,
            onClick: () => document.dispatchEvent(
              new CustomEvent('grid:delete-selected', { detail: { ids: [photo.id] } }),
            ),
          },
        ]

    openCtxMenu(e.clientX, e.clientY, items, photo.id)
  }, [
    photo.id, photo.isFavorite, photoIds, allIds, albumId, isPrivateAlbum,
    select, openPreview, openCtxMenu, removeFromAlbum, queryClient,
    cancelLongPress, endDragSelect, openTagEditor, updatePhoto,
  ])

  const borderRadius = size < 130 ? 0 : 4

  return (
    <div
      ref={divRef}
      data-photo-id={photo.id}
      className="la-grid-item"
      onClick={handleClick}
      onPointerDown={handlePointerDown}     // v4 新增
      onPointerUp={handlePointerUp}         // v4 新增
      onPointerEnter={handlePointerEnter}   // v4 新增（拖拽经过时选中）
      onPointerLeave={cancelLongPress}      // v4 新增（离开时取消长按计时）
      onPointerCancel={handlePointerUp}     // v4 新增
      onContextMenu={handleContextMenu}
      style={{
        width:        size,
        height:       size,
        position:     'relative',
        overflow:     'hidden',
        borderRadius,
        flexShrink:   0,
        cursor:       'default',
        outline:      isSelected
          ? '2px solid var(--la-accent)'
          : isFocused
          ? '2px solid var(--la-accent-subtle)'
          : 'none',
        outlineOffset: '-2px',
        // 选择模式下未选中项轻微暗化，增强选中感知
        opacity:    isSelectionMode && !isSelected ? 0.82 : 1,
        transition: 'opacity 150ms ease',
        // 拖拽框选时禁用文字选中
        userSelect: isDragSelecting ? 'none' : undefined,
      }}
    >
      {thumbUrl ? (
        <motion.img
          src={thumbUrl}
          alt={photo.fileName}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.15 }}
          className="la-thumb"
          style={{
            width: '100%', height: '100%',
            objectFit: 'cover', objectPosition: 'center',
            display: 'block', pointerEvents: 'none', userSelect: 'none',
          }}
          draggable={false}
        />
      ) : (
        <SkeletonCell size={size} />
      )}

      {/* 选择模式：显示圆形 checkbox（v4 新增）*/}
      <AnimatePresence>
        {isSelectionMode && (
          <CheckboxOverlay key="checkbox" isSelected={isSelected} />
        )}
      </AnimatePresence>

      {/* 正常模式：选中标记（选择模式下由 checkbox 覆盖）*/}
      {!isSelectionMode && isSelected && (
        <motion.div
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1  }}
          transition={{ duration: 0.1, ease: [0.34, 1.56, 0.64, 1] }}
          style={{
            position: 'absolute', top: 6, left: 6,
            width: 20, height: 20, borderRadius: '50%',
            backgroundColor: 'var(--la-accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
          }}
        >
          <Icon name="check" size={11} color="#fff" strokeWidth={2.5} />
        </motion.div>
      )}

      {/* 收藏心形 — 白色半透明圆形底板（22×22px）+ #FF2D55 红心（13px）*/}
      {photo.isFavorite && (
        <div style={{
          position:        'absolute',
          top:             5, right: 5,
          width:           '22px',
          height:          '22px',
          borderRadius:    '50%',
          backgroundColor: 'rgba(255,255,255,0.92)',
          display:         'flex',
          alignItems:      'center',
          justifyContent:  'center',
          boxShadow:       '0 1px 3px rgba(0,0,0,0.25), 0 0 0 0.5px rgba(0,0,0,0.08)',
          flexShrink:      0,
        }}>
          <span style={{ color: '#FF2D55', lineHeight: 0 }}>
            <Icon name="heart-fill" size={13} color="currentColor" />
          </span>
        </div>
      )}

      {/* Fix: 标签角标 — 底部左侧，最多显示 2 个色点（Apple Photos 风格）*/}
      {photoTags.length > 0 && !isSelectionMode && (
        <div style={{
          position:   'absolute',
          bottom:     4,
          left:       4,
          display:    'flex',
          gap:        '3px',
          alignItems: 'center',
          pointerEvents: 'none',
        }}>
          {photoTags.slice(0, 3).map((tag) => (
            <div
              key={tag.id}
              title={tag.name}
              style={{
                width:           '7px',
                height:          '7px',
                borderRadius:    '50%',
                backgroundColor: tag.color,
                boxShadow:       '0 0 0 1.5px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.4)',
                flexShrink:      0,
              }}
            />
          ))}
          {photoTags.length > 3 && (
            <div style={{
              fontSize:        '9px',
              color:           'rgba(255,255,255,0.85)',
              lineHeight:      1,
              textShadow:      '0 1px 2px rgba(0,0,0,0.6)',
              fontWeight:      600,
            }}>+{photoTags.length - 3}</div>
          )}
        </div>
      )}

      {/* hover 渐变遮罩（CSS，GPU 合成）*/}
      <div className="la-grid-item-overlay" />
    </div>
  )
})
