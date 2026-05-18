/**
 * @file src/components/layout/Toolbar.tsx
 * @description 顶部工具栏（v3 — 批量操作模式 + 文字版「选择」按钮）
 *
 * v3 变更（UI 改进）：
 *   「选择」按钮改为文字按钮，降低使用难度（用户能直接看到文字"选择"）。
 *   原来是图标按钮（check-square icon），改为含文字的小型按钮，
 *   风格与「导入」按钮一致但更轻量（次要操作样式）。
 *
 * v2 变更（批量操作）：
 *   - 新增「选择」按钮，点击进入 isSelectionMode
 *   - isSelectionMode=true 时：中间内容区替换为 BatchActionBar（蓝色调）
 *   - Toolbar 背景在选择模式下切换为 accent 色
 *   - 选择模式下「导入」按钮隐藏
 */

import { useRef, useEffect, useState, useCallback, memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { SearchBox } from '@/components/common/SearchBox'
import { Icon } from '@/components/common/Icon'
import { BatchActionBar } from '@/components/grid/BatchActionBar'
import {
  useLayoutStore,
  selectMode,
  selectSortBy,
  selectSortAsc,
} from '@/stores/layoutStore'
import { useUiStore, selectCurrentView } from '@/stores/uiStore'
import { useSelectionStore, selectIsSelectionMode } from '@/stores/selectionStore'
import { api } from '@/services/tauriIpc'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from '@/stores/uiStore'
import type { PhotoSortField } from '@/types/ipc'

// ─────────────────────────────────────────────────────────
//  排序配置
// ─────────────────────────────────────────────────────────

const SORT_OPTIONS: { field: PhotoSortField; label: string }[] = [
  { field: 'created_at',  label: '拍摄时间' },
  { field: 'imported_at', label: '导入时间' },
  { field: 'file_name',   label: '文件名称' },
  { field: 'file_size',   label: '文件大小' },
]

// ─────────────────────────────────────────────────────────
//  LayoutToggle
// ─────────────────────────────────────────────────────────

const LayoutToggle = memo(function LayoutToggle() {
  const mode    = useLayoutStore(selectMode)
  const setMode = useLayoutStore((s) => s.setMode)

  const btnStyle = (isActive: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: '28px', height: '28px', borderRadius: '5px',
    backgroundColor: isActive ? 'var(--la-bg-raised)' : 'transparent',
    border: 'none', color: isActive ? 'var(--la-text-primary)' : 'var(--la-text-tertiary)',
    cursor: 'default', transition: 'all 120ms ease',
    boxShadow: isActive ? 'var(--la-shadow-sm)' : 'none',
  })

  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      backgroundColor: 'var(--la-bg-overlay)',
      borderRadius: 'var(--la-radius-md)', padding: '2px', gap: '1px',
    }}>
      <button onClick={() => setMode('grid')} aria-label="网格布局" aria-pressed={mode === 'grid'}
        title="网格布局（Ctrl+1）" style={btnStyle(mode === 'grid')}
        onMouseEnter={(e) => { if (mode !== 'grid') e.currentTarget.style.color = 'var(--la-text-secondary)' }}
        onMouseLeave={(e) => { if (mode !== 'grid') e.currentTarget.style.color = 'var(--la-text-tertiary)' }}
      >
        <Icon name="grid" size={14} />
      </button>
      <button onClick={() => setMode('waterfall')} aria-label="瀑布流布局" aria-pressed={mode === 'waterfall'}
        title="瀑布流布局（Ctrl+2）" style={btnStyle(mode === 'waterfall')}
        onMouseEnter={(e) => { if (mode !== 'waterfall') e.currentTarget.style.color = 'var(--la-text-secondary)' }}
        onMouseLeave={(e) => { if (mode !== 'waterfall') e.currentTarget.style.color = 'var(--la-text-tertiary)' }}
      >
        <Icon name="waterfall" size={14} />
      </button>
    </div>
  )
})

// ─────────────────────────────────────────────────────────
//  SortDropdown
// ─────────────────────────────────────────────────────────

const SortDropdown = memo(function SortDropdown() {
  const sortBy  = useLayoutStore(selectSortBy)
  const sortAsc = useLayoutStore(selectSortAsc)
  const setSort = useLayoutStore((s) => s.setSort)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [open])

  const currentLabel = SORT_OPTIONS.find((o) => o.field === sortBy)?.label ?? '拍摄时间'

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={() => setOpen((v) => !v)} aria-label="排序方式" aria-haspopup="listbox" aria-expanded={open}
        style={{
          display: 'flex', alignItems: 'center', gap: '5px',
          height: '32px', padding: '0 10px', borderRadius: 'var(--la-radius-md)',
          backgroundColor: open ? 'var(--la-bg-active)' : 'transparent',
          border: `1px solid ${open ? 'var(--la-border)' : 'transparent'}`,
          color: 'var(--la-text-secondary)', fontSize: 'var(--la-text-sm)',
          cursor: 'default', transition: 'all 100ms ease',
        }}
        onMouseEnter={(e) => { if (!open) { e.currentTarget.style.backgroundColor = 'var(--la-bg-hover)'; e.currentTarget.style.color = 'var(--la-text-primary)' } }}
        onMouseLeave={(e) => { if (!open) { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--la-text-secondary)' } }}
      >
        <span style={{ fontSize: '11px', opacity: 0.7 }}>{sortAsc ? '↑' : '↓'}</span>
        <span>{currentLabel}</span>
        <Icon name="chevron-down" size={12} style={{ transition: 'transform 150ms ease', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="listbox"
            initial={{ opacity: 0, y: -6, scaleY: 0.94 }} animate={{ opacity: 1, y: 0, scaleY: 1 }} exit={{ opacity: 0, y: -6, scaleY: 0.94 }}
            transition={{ duration: 0.14, ease: 'easeOut' }}
            style={{
              position: 'absolute', top: 'calc(100% + 6px)', right: 0, width: '176px',
              backgroundColor: 'var(--la-bg-raised)', border: '1px solid var(--la-border)',
              borderRadius: 'var(--la-radius-lg)', boxShadow: 'var(--la-shadow-lg)',
              overflow: 'hidden', zIndex: 'var(--la-z-dropdown)' as unknown as number,
              transformOrigin: 'top right', padding: '4px 0',
            }}
          >
            <div style={{ display: 'flex', gap: '4px', padding: '4px 8px 6px', borderBottom: '1px solid var(--la-divider)' }}>
              {(['asc', 'desc'] as const).map((dir) => {
                const isActive = (dir === 'asc') === sortAsc
                return (
                  <button key={dir} onClick={() => setSort(sortBy, dir === 'asc')}
                    style={{
                      flex: 1, height: '26px', borderRadius: 'var(--la-radius-sm)',
                      fontSize: 'var(--la-text-xs)',
                      backgroundColor: isActive ? 'var(--la-accent-subtle)' : 'var(--la-bg-overlay)',
                      color: isActive ? 'var(--la-accent)' : 'var(--la-text-secondary)',
                      border: `1px solid ${isActive ? 'var(--la-accent)' : 'transparent'}`,
                      cursor: 'default', transition: 'all 100ms ease',
                      fontWeight: isActive ? 'var(--la-weight-medium)' as unknown as number : undefined,
                    }}
                  >
                    {dir === 'asc' ? '↑ 从早到晚' : '↓ 从晚到早'}
                  </button>
                )
              })}
            </div>
            {SORT_OPTIONS.map((opt) => {
              const selected = opt.field === sortBy
              return (
                <button key={opt.field} role="option" aria-selected={selected}
                  onClick={() => { setSort(opt.field, sortAsc); setOpen(false) }}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    width: '100%', padding: '8px 12px', fontSize: 'var(--la-text-sm)',
                    color: selected ? 'var(--la-text-primary)' : 'var(--la-text-secondary)',
                    backgroundColor: 'transparent', border: 'none', cursor: 'default',
                    fontWeight: selected ? 'var(--la-weight-medium)' as unknown as number : undefined,
                    transition: 'background-color 80ms ease',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--la-bg-hover)'; e.currentTarget.style.color = 'var(--la-text-primary)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = selected ? 'var(--la-text-primary)' : 'var(--la-text-secondary)' }}
                >
                  <span>{opt.label}</span>
                  {selected && <Icon name="check" size={13} color="var(--la-accent)" strokeWidth={2} />}
                </button>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})

// ─────────────────────────────────────────────────────────
//  ImportButton
// ─────────────────────────────────────────────────────────

const ImportButton = memo(function ImportButton() {
  const queryClient = useQueryClient()
  const [loading, setLoading] = useState(false)

  const handleImport = useCallback(async () => {
    if (loading) return
    setLoading(true)
    try {
      const path = await api.folders.pick()
      if (!path) return
      await api.folders.add(path)
      queryClient.invalidateQueries({ queryKey: ['folders'] })
      toast.success('已开始扫描文件夹')
    } catch {
      toast.error('添加文件夹失败')
    } finally {
      setLoading(false)
    }
  }, [loading, queryClient])

  return (
    <button
      onClick={handleImport} disabled={loading} aria-label="添加照片文件夹" title="添加照片文件夹"
      style={{
        display: 'flex', alignItems: 'center', gap: '5px',
        height: '32px', padding: '0 12px', borderRadius: 'var(--la-radius-md)',
        backgroundColor: 'var(--la-accent)', border: 'none', color: '#fff',
        fontSize: 'var(--la-text-sm)', fontWeight: 'var(--la-weight-medium)' as unknown as number,
        cursor: loading ? 'wait' : 'default', opacity: loading ? 0.7 : 1,
        transition: 'all 100ms ease', flexShrink: 0,
      }}
      onMouseEnter={(e) => { if (!loading) e.currentTarget.style.backgroundColor = 'var(--la-accent-hover)' }}
      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--la-accent)' }}
    >
      <Icon name="import" size={14} color="#fff" />
      <span>导入</span>
    </button>
  )
})

// ─────────────────────────────────────────────────────────
//  ToolbarDivider
// ─────────────────────────────────────────────────────────

function ToolbarDivider({ inSelectionMode }: { inSelectionMode?: boolean }) {
  return (
    <div style={{
      width: '1px', height: '18px', flexShrink: 0,
      backgroundColor: inSelectionMode ? 'rgba(255,255,255,0.2)' : 'var(--la-border)',
    }} />
  )
}

// ─────────────────────────────────────────────────────────
//  Toolbar — 主组件
// ─────────────────────────────────────────────────────────

interface ToolbarProps {
  allIds?:     string[]
  totalCount?: number
}

export function Toolbar({ allIds = [], totalCount = 0 }: ToolbarProps) {
  const currentView     = useUiStore(selectCurrentView)
  const setMode         = useLayoutStore((s) => s.setMode)
  const stepDensity     = useLayoutStore((s) => s.stepDensity)
  const isSelectionMode = useSelectionStore(selectIsSelectionMode)
  const enterSelection  = useSelectionStore((s) => s.enterSelectionMode)

  const isTrashView  = currentView.type === 'trash'
  const isAlbumView  = currentView.type === 'album'
  const isSearchView = currentView.type === 'search'
  const showImport   = !isTrashView && !isSearchView && !isSelectionMode
  const showSort     = !isAlbumView && !isTrashView && !isSelectionMode
  const showSearch   = !isSelectionMode
  const showSelectBtn = !isTrashView && !isSelectionMode

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === '1') { e.preventDefault(); setMode('grid') }
      if (e.ctrlKey && e.key === '2') { e.preventDefault(); setMode('waterfall') }
    }
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      stepDensity(e.deltaY > 0 ? -1 : 1)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('wheel', onWheel)
    }
  }, [setMode, stepDensity])

  return (
    <header
      style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '0 14px', height: 'var(--la-toolbar-h)', flexShrink: 0,
        backgroundColor: isSelectionMode ? 'var(--la-accent)' : 'var(--la-bg-toolbar)',
        borderBottom: '1px solid var(--la-border)',
        transition: 'background-color 200ms ease',
      }}
    >
      {/* 搜索框（选择模式下隐藏）*/}
      <AnimatePresence initial={false}>
        {showSearch && (
          <motion.div key="search"
            initial={{ opacity: 0, width: 0 }} animate={{ opacity: 1, width: 'auto' }} exit={{ opacity: 0, width: 0 }}
            transition={{ duration: 0.18 }} style={{ overflow: 'hidden', flexShrink: 0 }}
          >
            <SearchBox />
          </motion.div>
        )}
      </AnimatePresence>

      {/* 批量操作栏 */}
      <AnimatePresence initial={false}>
        {isSelectionMode && <BatchActionBar allIds={allIds} totalCount={totalCount} />}
      </AnimatePresence>

      {!isSelectionMode && <div style={{ flex: 1 }} />}

      {/* 排序 */}
      <AnimatePresence initial={false}>
        {showSort && (
          <motion.div key="sort"
            initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }}
            transition={{ duration: 0.15 }} style={{ display: 'flex', alignItems: 'center' }}
          >
            <SortDropdown />
          </motion.div>
        )}
      </AnimatePresence>

      {/* 布局切换 */}
      <AnimatePresence initial={false}>
        {!isSelectionMode && (
          <motion.div key="layout-toggle"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <ToolbarDivider />
            <LayoutToggle />
          </motion.div>
        )}
      </AnimatePresence>

      {/* 「选择」按钮 — 文字版（v3 UI 改进：降低使用难度）*/}
      <AnimatePresence initial={false}>
        {showSelectBtn && (
          <motion.div key="select-btn"
            initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }}
            transition={{ duration: 0.15 }}
          >
            <button
              onClick={enterSelection}
              title="进入选择模式，多选照片"
              aria-label="选择照片"
              style={{
                display:         'flex',
                alignItems:      'center',
                gap:             '4px',
                height:          '30px',
                padding:         '0 10px',
                borderRadius:    'var(--la-radius-md)',
                backgroundColor: 'var(--la-bg-overlay)',
                border:          '1px solid var(--la-border)',
                color:           'var(--la-text-secondary)',
                fontSize:        'var(--la-text-sm)',
                cursor:          'default',
                transition:      'all 100ms ease',
                flexShrink:      0,
                whiteSpace:      'nowrap',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--la-bg-hover)'
                e.currentTarget.style.color = 'var(--la-text-primary)'
                e.currentTarget.style.borderColor = 'var(--la-border-strong)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--la-bg-overlay)'
                e.currentTarget.style.color = 'var(--la-text-secondary)'
                e.currentTarget.style.borderColor = 'var(--la-border)'
              }}
            >
              <Icon name="check-square" size={13} color="currentColor" strokeWidth={1.5} />
              选择
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 导入按钮 */}
      <AnimatePresence initial={false}>
        {showImport && (
          <motion.div key="import"
            initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }}
            transition={{ duration: 0.15 }}
          >
            <ImportButton />
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  )
}
