/**
 * @file src/components/grid/BatchActionBar.tsx
 * @description 批量操作工具栏（v2 — 修复新建相册并加入 + 全选 | Phase-D — 批量收藏 undo 修复 + 导出占位）
 *
 * v2 修复：
 *
 * Bug 1 — 「新建相册并加入」无反应
 *   原因：AlbumPickerPopover 点击「新建相册并加入」时，仅 dispatch 了
 *         'album:create-and-add' CustomEvent，但整个应用中没有任何组件
 *         监听此事件，导致点击后无任何响应。
 *   修复：在 BatchActionBar 内直接管理 showCreateAlbum 状态，
 *         点击「新建相册并加入」→ 关闭 Popover + 显示 CreateAlbumDialog，
 *         CreateAlbumDialog 通过 onCreated(albumId) 回调通知创建成功，
 *         回调内直接调用 api.albums.addPhotos 将选中照片加入新相册。
 *         不再依赖 CustomEvent 机制。
 *
 * Phase-D 改动：
 *
 * Bug 3 — 批量收藏无 undo 支持
 *   原因：handleFavorite 通过 Promise.all(ids.map(id => api.photos.setFavorite(id, value)))
 *         并发调用单次命令，写 N 条 undo_log，但 Ctrl+Z 每次只能弹出最后一条。
 *   修复：改用 api.photos.setFavoriteBatch(ids, value)，后端原子写一条 "favorite_batch"
 *         undo_log，支持一次 Ctrl+Z 回滚整批收藏操作。
 *
 * 新增 — 导出按钮占位（PRD M-11 v1.1 功能）
 *   按钮处于 disabled 状态，title 标注"即将支持（v1.1）"，
 *   为下一版本提供 UI 占位，避免用户找不到导出入口。
 *
 * Bug 2 — 全选/反选不生效
 *   原因：BatchActionBar 的 allIds prop 来自 Toolbar，
 *         但 Toolbar 从 AppShell 接收 allIds。
 *         旧的 AppShell（viewfix 版）调用 <Toolbar /> 时没有传 allIds/totalCount，
 *         导致 allIds 始终为 []，selectAll([]) 不选中任何照片。
 *   修复：新 AppShell（v4）正确传入 allIds={allIds} totalCount={totalCount}，
 *         此处 BatchActionBar 的 handleSelectAll 逻辑本身正确，无需改动。
 *         （本文件此修复已通过 AppShell 修复间接解决，此处文档说明）
 */

import { memo, useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useQueryClient } from '@tanstack/react-query'
import { Icon } from '@/components/common/Icon'
import type { IconName } from '@/components/common/Icon'
import { useConfirmDialog } from '@/components/common/ConfirmDialog'
import { CreateAlbumDialog } from '@/components/album/CreateAlbumDialog'
import { useAlbumContext } from '@/components/album/AlbumView'
import { toAssetUrl } from '@/services/assetUrl'  // Fix: raw path → asset URL
import {
  useSelectionStore,
  selectSelectedIds,
  selectSelectedCount,
  selectIsSelectionMode,
} from '@/stores/selectionStore'
import { usePhotoStore, selectPhotos } from '@/stores/photoStore'
import { api } from '@/services/tauriIpc'
import { toast } from '@/stores/uiStore'
import type { AlbumSummary } from '@/types/album'

// ─────────────────────────────────────────────────────────
//  AlbumPickerPopover
// ─────────────────────────────────────────────────────────

interface AlbumPickerPopoverProps {
  anchorRef:   React.RefObject<HTMLButtonElement | null>
  selectedIds: string[]
  onClose:     () => void
  /** v2 修复：新建相册并加入 → 通知父组件显示 CreateAlbumDialog */
  onCreateNew: () => void
}

const AlbumPickerPopover = memo(function AlbumPickerPopover({
  anchorRef, selectedIds, onClose, onCreateNew,
}: AlbumPickerPopoverProps) {
  const [albums, setAlbums]         = useState<AlbumSummary[]>([])
  const [filterText, setFilterText] = useState('')
  const [loading, setLoading]       = useState(true)
  const popoverRef                  = useRef<HTMLDivElement>(null)
  const queryClient                 = useQueryClient()

  useEffect(() => {
    queryClient
      // Fix: listAll includes private albums in the picker
      .ensureQueryData<AlbumSummary[]>({ queryKey: ['albums-all'], queryFn: api.albums.listAll, staleTime: 5 * 60 * 1000 })
      .then((data) => { setAlbums(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [queryClient])

  useEffect(() => {
    const handler = (e: PointerEvent) => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        anchorRef.current  && !anchorRef.current.contains(e.target as Node)
      ) { onClose() }
    }
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [onClose, anchorRef])

  const filtered = albums.filter((a) => a.name.toLowerCase().includes(filterText.toLowerCase()))

  const handleAdd = useCallback(async (album: AlbumSummary) => {
    onClose()
    try {
      await api.albums.addPhotos(album.id, selectedIds)
      toast.success(`已将 ${selectedIds.length} 张照片加入「${album.name}」`)
      queryClient.invalidateQueries({ queryKey: ['albums'] })
    } catch {
      toast.error('加入相册失败')
    }
  }, [selectedIds, onClose, queryClient])

  const [pos, setPos] = useState({ top: 0, left: 0 })
  useEffect(() => {
    if (!anchorRef.current) return
    const rect = anchorRef.current.getBoundingClientRect()
    setPos({ top: rect.bottom + 6, left: rect.left })
  }, [anchorRef])

  return (
    <motion.div
      ref={popoverRef}
      initial={{ opacity: 0, y: -8, scaleY: 0.94 }}
      animate={{ opacity: 1, y: 0,  scaleY: 1    }}
      exit={{    opacity: 0, y: -8, scaleY: 0.94 }}
      transition={{ duration: 0.14, ease: 'easeOut' }}
      style={{
        position: 'fixed', top: pos.top, left: pos.left,
        width: 240, maxHeight: 320,
        backgroundColor: 'var(--la-bg-raised)',
        border: '1px solid var(--la-border)',
        borderRadius: 'var(--la-radius-lg)',
        boxShadow: 'var(--la-shadow-lg)', overflow: 'hidden',
        zIndex: 'var(--la-z-dropdown)' as unknown as number,
        display: 'flex', flexDirection: 'column',
        transformOrigin: 'top left',
      }}
    >
      <div style={{ padding: '8px', borderBottom: '1px solid var(--la-divider)' }}>
        <input
          autoFocus value={filterText} onChange={(e) => setFilterText(e.target.value)}
          placeholder="搜索相册…"
          style={{
            width: '100%', height: '28px', padding: '0 8px',
            fontSize: 'var(--la-text-sm)', backgroundColor: 'var(--la-bg-overlay)',
            border: '1px solid var(--la-border)', borderRadius: 'var(--la-radius-sm)',
            color: 'var(--la-text-primary)', outline: 'none',
          }}
        />
      </div>

      <div style={{ overflowY: 'auto', flex: 1 }}>
        {loading ? (
          <div style={{ padding: '16px', textAlign: 'center', color: 'var(--la-text-tertiary)', fontSize: 'var(--la-text-xs)' }}>加载中…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '16px', textAlign: 'center', color: 'var(--la-text-tertiary)', fontSize: 'var(--la-text-xs)' }}>
            {filterText ? '无匹配相册' : '暂无相册，请点击下方新建'}
          </div>
        ) : (
          filtered.map((album) => (
            <button key={album.id} onClick={() => handleAdd(album)}
              style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                width: '100%', padding: '8px 12px', backgroundColor: 'transparent',
                border: 'none', color: 'var(--la-text-primary)',
                fontSize: 'var(--la-text-sm)', cursor: 'default', textAlign: 'left',
                transition: 'background-color 80ms ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--la-bg-hover)' }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
            >
              <div style={{ width: 32, height: 32, borderRadius: 'var(--la-radius-sm)', overflow: 'hidden', flexShrink: 0, backgroundColor: 'var(--la-bg-overlay)' }}>
                {album.coverThumbnail ? (
                  <img src={toAssetUrl(album.coverThumbnail)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={album.isPrivate ? 'lock' : 'book'} size={14} color="var(--la-text-tertiary)" />
                  </div>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  {album.isPrivate && <Icon name="lock" size={10} color="var(--la-text-tertiary)" strokeWidth={2} />}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{album.name}</span>
                </div>
                <div style={{ fontSize: 'var(--la-text-xs)', color: 'var(--la-text-tertiary)', marginTop: 2 }}>{album.photoCount} 张</div>
              </div>
            </button>
          ))
        )}
      </div>

      {/* v2 修复：点击后调用 onCreateNew，由 BatchActionBar 显示 CreateAlbumDialog */}
      <div style={{ borderTop: '1px solid var(--la-divider)', padding: '4px' }}>
        <button
          onClick={() => { onClose(); onCreateNew() }}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            width: '100%', padding: '7px 12px', backgroundColor: 'transparent',
            border: 'none', color: 'var(--la-accent)', fontSize: 'var(--la-text-sm)',
            cursor: 'default', borderRadius: 'var(--la-radius-sm)',
            transition: 'background-color 80ms ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--la-bg-hover)' }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
        >
          <Icon name="plus" size={14} color="var(--la-accent)" />
          新建相册并加入
        </button>
      </div>
    </motion.div>
  )
})

// ─────────────────────────────────────────────────────────
//  BatchActionButton
// ─────────────────────────────────────────────────────────

interface BatchActionButtonProps {
  onClick: () => void; label: string; icon: IconName
  danger?: boolean; disabled?: boolean; btnRef?: React.Ref<HTMLButtonElement>; active?: boolean
}

const BatchActionButton = memo(function BatchActionButton({
  onClick, label, icon, danger, disabled, btnRef, active,
}: BatchActionButtonProps) {
  const baseColor = danger ? 'var(--la-danger)' : active ? 'var(--la-accent)' : 'rgba(255,255,255,0.9)'
  return (
    <button
      ref={btnRef as React.RefObject<HTMLButtonElement>}
      onClick={onClick} disabled={disabled} title={label} aria-label={label}
      style={{
        display: 'flex', alignItems: 'center', gap: '5px',
        height: '30px', padding: '0 11px', borderRadius: 'var(--la-radius-md)',
        backgroundColor: active ? 'rgba(255,255,255,0.2)' : danger ? 'rgba(255,59,48,0.15)' : 'rgba(255,255,255,0.12)',
        border: 'none', color: baseColor, fontSize: 'var(--la-text-sm)',
        cursor: disabled ? 'not-allowed' : 'default', opacity: disabled ? 0.45 : 1,
        transition: 'all 100ms ease', flexShrink: 0, whiteSpace: 'nowrap',
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.backgroundColor = danger ? 'rgba(255,59,48,0.28)' : 'rgba(255,255,255,0.22)' }}
      onMouseLeave={(e) => { if (!disabled) e.currentTarget.style.backgroundColor = active ? 'rgba(255,255,255,0.2)' : danger ? 'rgba(255,59,48,0.15)' : 'rgba(255,255,255,0.12)' }}
    >
      <Icon name={icon} size={13} color={baseColor} />
      <span>{label}</span>
    </button>
  )
})

// ─────────────────────────────────────────────────────────
//  BatchActionBar — 主组件
// ─────────────────────────────────────────────────────────

interface BatchActionBarProps {
  allIds:     string[]
  totalCount: number
}

export const BatchActionBar = memo(function BatchActionBar({ allIds, totalCount }: BatchActionBarProps) {
  const isSelectionMode   = useSelectionStore(selectIsSelectionMode)
  const selectedIds       = useSelectionStore(selectSelectedIds)
  const selectedCount     = useSelectionStore(selectSelectedCount)
  const selectAll         = useSelectionStore((s) => s.selectAll)
  const clearSelection    = useSelectionStore((s) => s.clearSelection)
  const exitSelectionMode = useSelectionStore((s) => s.exitSelectionMode)

  const photos       = usePhotoStore(selectPhotos)
  const updatePhoto  = usePhotoStore((s) => s.updatePhoto)
  const removePhotos = usePhotoStore((s) => s.removePhotos)

  const queryClient    = useQueryClient()
  const confirm        = useConfirmDialog()
  // Fix: disable batch ops in private album (isPrivateAlbum from AlbumContext)
  const { isPrivateAlbum } = useAlbumContext()

  const albumBtnRef                 = useRef<HTMLButtonElement>(null)
  const [showAlbumPicker, setShowAlbumPicker]   = useState(false)
  // v2 修复：用状态管理「新建相册并加入」对话框
  const [showCreateAlbum, setShowCreateAlbum]   = useState(false)

  const selectedArr  = [...selectedIds]
  const allFavorited = selectedArr.length > 0 &&
    selectedArr.every((id) => photos.find((p) => p.id === id)?.isFavorite === true)
  const isAllSelected = selectedCount === allIds.length && allIds.length > 0

  const handleFavorite = useCallback(async (value: boolean) => {
    if (selectedArr.length === 0) return
    // Phase-D：乐观更新 store（即时响应 UI）
    const prev = selectedArr.map((id) => ({ id, isFavorite: photos.find((p) => p.id === id)?.isFavorite ?? false }))
    selectedArr.forEach((id) => updatePhoto(id, { isFavorite: value }))
    try {
      // Phase-D：改用 setFavoriteBatch —— 后端原子写一条 "favorite_batch" undo_log，
      // 支持 Ctrl+Z 一次性回滚整批操作（原 Promise.all 写 N 条，每次只能撤销一条）
      await api.photos.setFavoriteBatch(selectedArr, value)
      toast.success(
        value ? `已收藏 ${selectedArr.length} 张照片` : `已取消 ${selectedArr.length} 张照片的收藏`,
        {
          label:   '撤销',
          onClick: async () => {
            await api.undo.last()
            queryClient.resetQueries({ queryKey: ['photos'] })
          },
        },
      )
      queryClient.resetQueries({ queryKey: ['photos'] })
      // Fix: refresh sidebar stats after batch favorite toggle
      queryClient.invalidateQueries({ queryKey: ['stats'] })
    } catch {
      // 回滚乐观更新
      prev.forEach(({ id, isFavorite }) => updatePhoto(id, { isFavorite }))
      toast.error('操作失败，请重试')
    }
  }, [selectedArr, photos, updatePhoto, queryClient])

  const handleDelete = useCallback(async () => {
    if (selectedArr.length === 0) return
    const ok = await confirm({
      title: `删除 ${selectedArr.length} 张照片`, message: '照片将移入回收站，可在回收站中恢复',
      confirmLabel: '删除', variant: 'danger', detail: `已选中 ${selectedArr.length} 张 / 共 ${totalCount} 张`,
    })
    if (!ok) return
    try {
      await api.photos.delete(selectedArr)
      removePhotos(selectedArr)
      exitSelectionMode()
      queryClient.invalidateQueries({ queryKey: ['photos'] })
      toast.success(`已移入回收站`, {
        label: '撤销',
        onClick: async () => {
          await api.photos.restore(selectedArr)
          queryClient.resetQueries({ queryKey: ['photos'] })
          toast.success(`已恢复 ${selectedArr.length} 张照片`)
        },
      })
    } catch { toast.error('删除失败，请重试') }
  }, [selectedArr, totalCount, exitSelectionMode, removePhotos, queryClient, confirm])

  const handleSelectAll = useCallback(() => {
    if (isAllSelected) { clearSelection() } else { selectAll(allIds) }
  }, [isAllSelected, clearSelection, selectAll, allIds])

  // v2 修复：CreateAlbumDialog 创建成功后的回调 → 将选中照片加入新相册
  const handleAlbumCreated = useCallback(async (albumId: string) => {
    if (selectedArr.length === 0) return
    try {
      await api.albums.addPhotos(albumId, selectedArr)
      queryClient.invalidateQueries({ queryKey: ['albums'] })
      toast.success(`已将 ${selectedArr.length} 张照片加入新相册`)
    } catch {
      toast.error('加入相册失败')
    }
  }, [selectedArr, queryClient])

  if (!isSelectionMode) return null

  return (
    <>
      <motion.div
        key="batch-action-bar"
        initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, backgroundColor: 'transparent' }}
      >
        <BatchActionButton
          onClick={handleSelectAll}
          label={isAllSelected ? '取消全选' : `全选（${allIds.length}）`}
          icon={isAllSelected ? 'check-square' : 'square'}
          active={isAllSelected}
        />

        <div style={{ width: 1, height: 18, backgroundColor: 'rgba(255,255,255,0.2)', flexShrink: 0 }} />

        {!isPrivateAlbum && (allFavorited ? (
          <BatchActionButton onClick={() => handleFavorite(false)} label="取消收藏" icon="heart" disabled={selectedCount === 0} />
        ) : (
          <BatchActionButton onClick={() => handleFavorite(true)} label="收藏" icon="heart-fill" disabled={selectedCount === 0} />
        ))}

{!isPrivateAlbum &&         <BatchActionButton
          btnRef={albumBtnRef}
          onClick={() => setShowAlbumPicker((v) => !v)}
          label="加入相册" icon="book"
          disabled={selectedCount === 0} active={showAlbumPicker}
        />}

        <div style={{ width: 1, height: 18, backgroundColor: 'rgba(255,255,255,0.2)', flexShrink: 0 }} />

        <BatchActionButton
          onClick={handleDelete}
          label={selectedCount > 0 ? `删除 ${selectedCount} 张` : '删除'}
          icon="trash" danger disabled={selectedCount === 0}
        />

        {/* Phase-D：导出按钮占位（PRD M-11 v1.1）— 暂时 disabled，预留 UI 位置 */}
        <BatchActionButton
          onClick={() => { /* v1.1 TODO: export */ }}
          label="导出"
          icon="import"
          disabled
        />

        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 'var(--la-text-sm)', color: 'rgba(255,255,255,0.75)', flexShrink: 0, userSelect: 'none' }}>
          {selectedCount > 0 ? `已选 ${selectedCount} 张 / 共 ${totalCount} 张` : `共 ${totalCount} 张`}
        </span>

        <div style={{ width: 1, height: 18, backgroundColor: 'rgba(255,255,255,0.2)', flexShrink: 0 }} />

        <button
          onClick={exitSelectionMode} title="退出选择模式（Esc）" aria-label="退出选择模式"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 28, height: 28, borderRadius: 'var(--la-radius-md)',
            backgroundColor: 'rgba(255,255,255,0.12)', border: 'none',
            color: 'rgba(255,255,255,0.8)', cursor: 'default', transition: 'all 100ms ease', flexShrink: 0,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.22)' }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.12)' }}
        >
          <Icon name="x" size={14} color="rgba(255,255,255,0.8)" />
        </button>
      </motion.div>

      {/* 相册选择 Popover */}
      <AnimatePresence>
        {showAlbumPicker && (
          <AlbumPickerPopover
            key="album-picker"
            anchorRef={albumBtnRef}
            selectedIds={selectedArr}
            onClose={() => setShowAlbumPicker(false)}
            onCreateNew={() => setShowCreateAlbum(true)}   // v2 修复
          />
        )}
      </AnimatePresence>

      {/* v2 修复：新建相册并加入 — 直接渲染 CreateAlbumDialog，通过 onCreated 回调处理 */}
      <AnimatePresence>
        {showCreateAlbum && (
          <CreateAlbumDialog
            key="create-album-for-batch"
            onClose={() => setShowCreateAlbum(false)}
            onCreated={handleAlbumCreated}
          />
        )}
      </AnimatePresence>
    </>
  )
})
