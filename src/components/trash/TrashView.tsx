/**
 * @file src/components/trash/TrashView.tsx
 * @description 回收站视图 — 多选恢复/清除/彻底删除（Apple Photos 风格）
 *
 * 操作说明：
 *   恢复     — 将照片从回收站恢复到原视图（api.photos.restore）
 *   清除记录 — 仅从程序 DB 移除，磁盘文件保留（api.photos.purgeData）
 *   彻底删除 — 同时删除磁盘原文件（api.photos.purge）不可撤销
 *
 * 多选支持：
 *   点击「多选」进入选择模式 → 勾选照片 → 批量操作
 *   不选择时操作作用于回收站全部照片
 *
 * 使用 Icon.tsx v2 新增图标：rotate-ccw / x-circle / check-square / square
 */

import { useCallback, memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useQueryClient } from '@tanstack/react-query'
import { usePhotoStore, selectPhotos } from '@/stores/photoStore'
import {
  useSelectionStore,
  selectSelectedIds,
  selectSelectedCount,
  selectIsSelectionMode,
} from '@/stores/selectionStore'
import { useConfirmDialog } from '@/components/common/ConfirmDialog'
import { usePhotoQuery } from '@/hooks/usePhotoQuery'
import { VirtualGrid } from '@/components/grid/VirtualGrid'
import { Icon } from '@/components/common/Icon'
import { api } from '@/services/tauriIpc'
import { toast } from '@/stores/uiStore'

// ─────────────────────────────────────────────────────────
//  TrashBtn — 回收站操作按钮
// ─────────────────────────────────────────────────────────

interface TrashBtnProps {
  onClick:   () => void
  label:     string
  icon:      React.ReactNode
  danger?:   boolean
  disabled?: boolean
  active?:   boolean
  compact?:  boolean
}

function TrashBtn({ onClick, label, icon, danger, disabled, active, compact }: TrashBtnProps) {
  const base: React.CSSProperties = {
    display:         'flex',
    alignItems:      'center',
    gap:             compact ? '0' : '5px',
    height:          '30px',
    padding:         compact ? '0 8px' : '0 11px',
    borderRadius:    'var(--la-radius-md)',
    border:          `1px solid ${
      danger ? 'rgba(255,69,58,0.3)'
      : active ? 'var(--la-accent)'
      : 'var(--la-border)'
    }`,
    backgroundColor: danger
      ? 'var(--la-danger-subtle)'
      : active
      ? 'var(--la-accent-subtle)'
      : 'var(--la-bg-overlay)',
    color:           danger
      ? 'var(--la-danger)'
      : active
      ? 'var(--la-accent)'
      : 'var(--la-text-secondary)',
    fontSize:        'var(--la-text-sm)',
    cursor:          disabled ? 'not-allowed' : 'default',
    opacity:         disabled ? 0.4 : 1,
    transition:      'all 100ms ease',
    flexShrink:      0,
    whiteSpace:      'nowrap',
  }

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      style={base}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.backgroundColor = danger
            ? 'rgba(255,69,58,0.2)'
            : active
            ? 'var(--la-accent-subtle)'
            : 'var(--la-bg-hover)'
          e.currentTarget.style.color = danger
            ? 'var(--la-danger)'
            : active
            ? 'var(--la-accent)'
            : 'var(--la-text-primary)'
        }
      }}
      onMouseLeave={(e) => {
        if (!disabled) {
          e.currentTarget.style.backgroundColor = danger
            ? 'var(--la-danger-subtle)'
            : active
            ? 'var(--la-accent-subtle)'
            : 'var(--la-bg-overlay)'
          e.currentTarget.style.color = danger
            ? 'var(--la-danger)'
            : active
            ? 'var(--la-accent)'
            : 'var(--la-text-secondary)'
        }
      }}
    >
      {icon}
      {!compact && <span>{label}</span>}
    </button>
  )
}

// ─────────────────────────────────────────────────────────
//  TrashActionBar — 顶部工具栏
// ─────────────────────────────────────────────────────────

const TrashActionBar = memo(function TrashActionBar() {
  const photos          = usePhotoStore(selectPhotos)
  const allIds          = photos.map((p) => p.id)
  const selectedIds     = useSelectionStore(selectSelectedIds)
  const selectedCount   = useSelectionStore(selectSelectedCount)
  const isSelectionMode = useSelectionStore(selectIsSelectionMode)
  const selectAll       = useSelectionStore((s) => s.selectAll)
  const clearSelection  = useSelectionStore((s) => s.clearSelection)
  const enterSelection  = useSelectionStore((s) => s.enterSelectionMode)
  const exitSelection   = useSelectionStore((s) => s.exitSelectionMode)
  const removePhotos    = usePhotoStore((s) => s.removePhotos)
  const confirm         = useConfirmDialog()
  const queryClient     = useQueryClient()

  const selectedArr   = [...selectedIds]
  const isAllSelected = selectedCount === allIds.length && allIds.length > 0
  const totalCount    = allIds.length
  const hasPhotos     = totalCount > 0
  const hasSelection  = selectedCount > 0

  // 操作目标描述
  const targetDesc = hasSelection
    ? `${selectedCount} 张`
    : `全部 ${totalCount} 张`

  // ── 操作目标 IDs（有选择用选择，否则用全部）
  const getTargetIds = useCallback(() =>
    hasSelection ? selectedArr : allIds
  , [hasSelection, selectedArr, allIds])

  // ── 恢复 ──
  const handleRestore = useCallback(async () => {
    const ids = getTargetIds()
    if (!ids.length) return
    const ok = await confirm({
      title:        `恢复 ${ids.length} 张照片`,
      message:      hasSelection
        ? `将已选中的 ${ids.length} 张照片恢复到原始位置`
        : '将回收站中所有照片恢复到原始位置',
      confirmLabel: '恢复',
      variant:      'default',
    })
    if (!ok) return
    try {
      await api.photos.restore(ids)
      removePhotos(ids)
      exitSelection()
      queryClient.resetQueries({ queryKey: ['photos'] })
      toast.success(`已恢复 ${ids.length} 张照片`)
    } catch { toast.error('恢复失败，请重试') }
  }, [getTargetIds, hasSelection, confirm, removePhotos, exitSelection, queryClient])

  // ── 清除记录（不删磁盘文件）──
  const handlePurgeData = useCallback(async () => {
    const ids = getTargetIds()
    if (!ids.length) return
    const ok = await confirm({
      title:        `从程序中清除 ${ids.length} 张照片`,
      message:      '照片文件将保留在磁盘上，但会从 LightAlbum 数据库中移除。\n如需重新管理，可重新导入所在文件夹。',
      confirmLabel: '清除记录',
      variant:      'danger',
      detail:       '此操作不可撤销，但磁盘原文件不受影响',
    })
    if (!ok) return
    try {
      await api.photos.purgeData(ids)
      removePhotos(ids)
      exitSelection()
      queryClient.resetQueries({ queryKey: ['photos'] })
      toast.success(`已从程序中清除 ${ids.length} 张照片（磁盘文件保留）`)
    } catch { toast.error('清除失败，请重试') }
  }, [getTargetIds, confirm, removePhotos, exitSelection, queryClient])

  // ── 彻底删除（同时删除磁盘文件）──
  const handlePurge = useCallback(async () => {
    const ids = getTargetIds()
    if (!ids.length) return
    const ok = await confirm({
      title:        `永久删除 ${ids.length} 张照片`,
      message:      '照片文件将从磁盘中永久删除，此操作无法撤销。',
      confirmLabel: '永久删除',
      variant:      'danger',
      detail:       '⚠️ 原始文件将被永久删除，无法通过任何方式恢复',
    })
    if (!ok) return
    try {
      await api.photos.purge(ids)
      removePhotos(ids)
      exitSelection()
      queryClient.resetQueries({ queryKey: ['photos'] })
      toast.success(`已永久删除 ${ids.length} 张照片`)
    } catch { toast.error('删除失败，请重试') }
  }, [getTargetIds, confirm, removePhotos, exitSelection, queryClient])

  return (
    <div style={{
      display:         'flex',
      alignItems:      'center',
      gap:             '8px',
      padding:         '0 16px',
      height:          'var(--la-toolbar-h)',
      backgroundColor: 'var(--la-bg-toolbar)',
      borderBottom:    '1px solid var(--la-border)',
      flexShrink:      0,
    }}>
      {/* 标题区 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Icon name="trash" size={16} color="var(--la-text-secondary)" />
        <span style={{
          fontSize:   'var(--la-text-sm)',
          fontWeight: 'var(--la-weight-semibold)',
          color:      'var(--la-text-primary)',
        }}>
          回收站
        </span>
        <AnimatePresence>
          {totalCount > 0 && (
            <motion.span
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              style={{
                fontSize:        '11px',
                color:           'var(--la-text-tertiary)',
                backgroundColor: 'var(--la-bg-overlay)',
                borderRadius:    'var(--la-radius-full)',
                padding:         '1px 8px',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {totalCount}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <div style={{ flex: 1 }} />

      {/* 操作区 */}
      <AnimatePresence initial={false}>
        {hasPhotos && (
          <motion.div
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            {/* 多选按钮 */}
            <TrashBtn
              onClick={() => isSelectionMode ? exitSelection() : enterSelection()}
              label={isSelectionMode ? '退出选择' : '多选'}
              icon={<Icon name={isSelectionMode ? 'x' : 'check-square'} size={13} color="currentColor" />}
              active={isSelectionMode}
            />

            {/* 全选（选择模式下）*/}
            <AnimatePresence>
              {isSelectionMode && (
                <motion.div
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: 'auto' }}
                  exit={{ opacity: 0, width: 0 }}
                  style={{ overflow: 'hidden' }}
                >
                  <TrashBtn
                    onClick={() => isAllSelected ? clearSelection() : selectAll(allIds)}
                    label={isAllSelected ? '取消全选' : '全选'}
                    icon={<Icon name={isAllSelected ? 'check-square' : 'square'} size={13} color="currentColor" />}
                    active={isAllSelected}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {/* 分隔线 */}
            <div style={{ width: 1, height: 18, backgroundColor: 'var(--la-border)', flexShrink: 0 }} />

            {/* 恢复 */}
            <TrashBtn
              onClick={handleRestore}
              label={`恢复${hasSelection ? ` ${selectedCount} 张` : '全部'}`}
              icon={<Icon name="rotate-ccw" size={13} color="currentColor" />}
              disabled={!hasPhotos}
            />

            {/* 清除记录 */}
            <TrashBtn
              onClick={handlePurgeData}
              label={`清除${hasSelection ? ` ${selectedCount} 张` : '全部'}记录`}
              icon={<Icon name="x-circle" size={13} color="currentColor" />}
              disabled={!hasPhotos}
            />

            {/* 彻底删除 */}
            <TrashBtn
              onClick={handlePurge}
              label={`永久删除${hasSelection ? ` ${selectedCount} 张` : '全部'}`}
              icon={<Icon name="trash" size={13} color="currentColor" />}
              danger
              disabled={!hasPhotos}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})

// ─────────────────────────────────────────────────────────
//  TrashEmptyState — 空态
// ─────────────────────────────────────────────────────────

function TrashEmptyState() {
  return (
    <div style={{
      height:         '100%',
      display:        'flex',
      flexDirection:  'column',
      alignItems:     'center',
      justifyContent: 'center',
      gap:            '16px',
      userSelect:     'none',
      padding:        '40px',
    }}>
      {/* 圆形图标底板 */}
      <div style={{
        width:           '80px',
        height:          '80px',
        borderRadius:    '50%',
        backgroundColor: 'var(--la-bg-overlay)',
        display:         'flex',
        alignItems:      'center',
        justifyContent:  'center',
      }}>
        <Icon name="trash" size={34} color="var(--la-text-tertiary)" strokeWidth={1.2} />
      </div>

      <div style={{ textAlign: 'center' }}>
        <p style={{
          fontSize:   'var(--la-text-base)',
          fontWeight: 'var(--la-weight-medium)',
          color:      'var(--la-text-secondary)',
          margin:     '0 0 6px',
        }}>
          回收站已清空
        </p>
        <p style={{
          fontSize: 'var(--la-text-sm)',
          color:    'var(--la-text-tertiary)',
          margin:   0,
        }}>
          删除的照片会暂存在这里
        </p>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────
//  TrashView — 主组件
// ─────────────────────────────────────────────────────────

export function TrashView() {
  const { isLoading, loadMore, hasMore } = usePhotoQuery()
  const photos = usePhotoStore(selectPhotos)
  const isEmpty = !isLoading && photos.length === 0

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <TrashActionBar />
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {isEmpty ? (
          <TrashEmptyState />
        ) : (
          <VirtualGrid isLoading={isLoading} onLoadMore={loadMore} hasMore={hasMore} />
        )}
      </div>
    </div>
  )
}
