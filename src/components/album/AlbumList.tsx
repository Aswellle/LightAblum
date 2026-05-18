/**
 * @file src/components/album/AlbumList.tsx
 * @description 相册概览网格页面（主内容区全页版）
 *
 * 当用户在侧边栏点击相册分区的根标题时显示此页面。
 * 以卡片网格形式展示所有相册，类似 Apple Photos 的相册首页。
 *
 * 布局：
 *   auto-fill 网格（最小 160px），卡片包含：
 *   封面图（coverThumbnail / 占位格子）+ 名称 + 照片数量
 *
 * 交互：
 *   - 点击卡片   → setView({ type: 'album', albumId })
 *   - 双击名称   → 行内重命名
 *   - 右键        → ContextMenu（重命名 / 删除）
 *   - hover 右上角 → 「…」操作按钮
 *   - 拖拽卡片   → 调整 sortOrder（HTML5 DnD）
 *   - 「新建相册」虚拟卡片 → CreateAlbumDialog
 */

import {
  useState,
  useRef,
  useCallback,
  memo,
  type KeyboardEvent,
  type MouseEvent,
  type DragEvent,
} from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '@/services/tauriIpc'
import { useUiStore } from '@/stores/uiStore'
import { Icon } from '@/components/common/Icon'
import { CreateAlbumDialog } from '@/components/album/CreateAlbumDialog'
import { useConfirmDialog } from '@/components/common/ConfirmDialog'
import { toast } from '@/stores/uiStore'
import type { AlbumSummary } from '@/types/album'
import { toAssetUrl } from '@/services/assetUrl'  // Fix: raw path → asset URL

// ─────────────────────────────────────────────────────────
//  封面占位符（无 coverThumbnail 时）
// ─────────────────────────────────────────────────────────

function AlbumCoverPlaceholder() {
  return (
    <div style={{
      width:  '100%', height: '100%',
      backgroundColor: 'var(--la-bg-overlay)',
      display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px', padding: '2px',
    }}>
      {[0,1,2,3].map((i) => (
        <div key={i} style={{ backgroundColor: 'var(--la-bg-hover)', borderRadius: '2px' }} />
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────
//  AlbumCard — 单张相册卡片
// ─────────────────────────────────────────────────────────

interface AlbumCardProps {
  album:       AlbumSummary
  onOpen:      (id: string) => void
  onRename:    (id: string, name: string) => void
  onDelete:    (id: string) => void
  onContext:   (e: MouseEvent, album: AlbumSummary) => void
  isDragOver:  boolean
  onDragStart: (e: DragEvent, id: string) => void
  onDragOver:  (e: DragEvent, id: string) => void
  onDrop:      (e: DragEvent, id: string) => void
  onDragEnd:   () => void
}

const AlbumCard = memo(function AlbumCard({
  album, onOpen, onRename, onDelete: _onDelete, onContext,
  isDragOver, onDragStart, onDragOver, onDrop, onDragEnd,
}: AlbumCardProps) {
  const [isRenaming, setIsRenaming] = useState(false)
  const [editName,   setEditName]   = useState(album.name)
  const [hovered,    setHovered]    = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const startRename = useCallback(() => {
    setEditName(album.name)
    setIsRenaming(true)
    setTimeout(() => inputRef.current?.select(), 50)
  }, [album.name])

  const commitRename = useCallback(() => {
    const trimmed = editName.trim()
    if (trimmed && trimmed !== album.name) onRename(album.id, trimmed)
    setIsRenaming(false)
  }, [editName, album, onRename])

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter')  { e.preventDefault(); commitRename() }
    if (e.key === 'Escape') { setIsRenaming(false); setEditName(album.name) }
  }, [commitRename, album.name])

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1    }}
      exit={{    opacity: 0, scale: 0.92 }}
      transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
      draggable
      onDragStart={(e) => onDragStart(e as unknown as DragEvent, album.id)}
      onDragOver={(e)  => { e.preventDefault(); onDragOver(e as unknown as DragEvent, album.id) }}
      onDrop={(e)      => onDrop(e as unknown as DragEvent, album.id)}
      onDragEnd={onDragEnd}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={(e) => { e.preventDefault(); onContext(e as unknown as MouseEvent, album) }}
      onClick={() => !isRenaming && onOpen(album.id)}
      style={{
        cursor:          'default',
        borderRadius:    'var(--la-radius-lg)',
        overflow:        'hidden',
        backgroundColor: 'var(--la-bg-raised)',
        border:          `2px solid ${isDragOver ? 'var(--la-accent)' : 'transparent'}`,
        boxShadow:       hovered ? 'var(--la-shadow-md)' : 'var(--la-shadow-sm)',
        transition:      'box-shadow 150ms ease, border-color 120ms ease',
      }}
    >
      {/* 封面图 */}
      <div style={{ position: 'relative', aspectRatio: '1', overflow: 'hidden' }}>
        {album.coverThumbnail ? (
          <img
            src={toAssetUrl(album.coverThumbnail)}
            alt={album.name}
            draggable={false}
            style={{
              width:         '100%',
              height:        '100%',
              objectFit:     'cover',
              display:       'block',
              pointerEvents: 'none',
              transform:     hovered ? 'scale(1.05)' : 'scale(1)',
              transition:    'transform 250ms ease',
            }}
          />
        ) : (
          <AlbumCoverPlaceholder />
        )}

        {/* 封面遮罩 */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundColor: 'rgba(0,0,0,0.12)',
          opacity: hovered ? 1 : 0,
          transition: 'opacity 150ms ease',
          pointerEvents: 'none',
        }} />

        {/* 操作按钮（hover 显示）*/}
        <AnimatePresence>
          {hovered && (
            <motion.button
              initial={{ opacity: 0, scale: 0.75 }}
              animate={{ opacity: 1, scale: 1    }}
              exit={{    opacity: 0, scale: 0.75 }}
              transition={{ duration: 0.12 }}
              onClick={(e) => {
                e.stopPropagation()
                onContext(e as unknown as MouseEvent, album)
              }}
              aria-label="相册选项"
              style={{
                position:        'absolute', top: '8px', right: '8px',
                width: '28px', height: '28px',
                borderRadius:    '50%',
                backgroundColor: 'rgba(0,0,0,0.52)',
                backdropFilter:  'blur(4px)',
                border:          'none',
                color:           '#fff',
                display:         'flex',
                alignItems:      'center',
                justifyContent:  'center',
                cursor:          'default',
              }}
            >
              <Icon name="dots-h" size={14} color="#fff" />
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* 文字区域 */}
      <div style={{ padding: '9px 11px 11px' }}>
        {isRenaming ? (
          <input
            ref={inputRef}
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={commitRename}
            onClick={(e) => e.stopPropagation()}
            maxLength={64}
            autoFocus
            style={{
              width:           '100%',
              fontSize:        'var(--la-text-sm)',
              fontWeight:      500,
              color:           'var(--la-text-primary)',
              backgroundColor: 'var(--la-bg-overlay)',
              border:          '1px solid var(--la-accent)',
              borderRadius:    'var(--la-radius-sm)',
              padding:         '2px 5px',
              outline:         'none',
              userSelect:      'text',
            }}
          />
        ) : (
          <p
            onDoubleClick={(e) => { e.stopPropagation(); startRename() }}
            style={{
              fontSize:     'var(--la-text-sm)',
              fontWeight:   500,
              color:        'var(--la-text-primary)',
              overflow:     'hidden',
              whiteSpace:   'nowrap',
              textOverflow: 'ellipsis',
              margin:       0,
              lineHeight:   1.3,
            }}
          >
            {album.name}
          </p>
        )}
        <p style={{
          fontSize:  'var(--la-text-xs)',
          color:     'var(--la-text-secondary)',
          margin:    '3px 0 0',
          lineHeight: 1,
        }}>
          {album.photoCount.toLocaleString('zh-CN')} 张
        </p>
      </div>
    </motion.div>
  )
})

// ─────────────────────────────────────────────────────────
//  AlbumList — 主组件
// ─────────────────────────────────────────────────────────

export function AlbumList() {
  const queryClient = useQueryClient()
  const setView     = useUiStore((s) => s.setView)
  const openCtxMenu = useUiStore((s) => s.openContextMenu)
  const confirm     = useConfirmDialog()

  const [showCreate, setShowCreate] = useState(false)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const dragSrcRef  = useRef<string | null>(null)

  // ── 查询 ──
  const { data: albums = [], isLoading } = useQuery({
    queryKey: ['albums'],
    queryFn:  api.albums.list,
    staleTime: Infinity,
  })

  // ── Mutations ──
  const renameMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.albums.update(id, { name }),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['albums'] }),
    onError:    () => toast.error('重命名失败'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.albums.delete(id),
    onSuccess:  () => { queryClient.invalidateQueries({ queryKey: ['albums'] }); toast.success('相册已删除') },
    onError:    () => toast.error('删除失败'),
  })

  const reorderMut = useMutation({
    mutationFn: ({ id, sortOrder }: { id: string; sortOrder: number }) =>
      api.albums.update(id, { sortOrder }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['albums'] }),
  })

  // ── 操作 ──
  const handleOpen   = useCallback((id: string) => setView({ type: 'album', albumId: id }), [setView])
  const handleRename = useCallback((id: string, name: string) => renameMut.mutate({ id, name }), [renameMut])
  const handleDelete = useCallback(async (id: string) => {
    const name = albums.find((a) => a.id === id)?.name ?? ''
    const ok = await confirm({
      title:        `删除相册「${name}」`,
      message:      '相册将被删除，照片文件不受影响',
      confirmLabel: '删除',
      variant:      'danger',
    })
    if (ok) deleteMut.mutate(id)
  }, [albums, confirm, deleteMut])

  const handleContext = useCallback((e: MouseEvent, album: AlbumSummary) => {
    openCtxMenu(e.clientX, e.clientY, [
      { id: 'open',   label: '打开相册', icon: 'eye',    onClick: () => handleOpen(album.id) },
      { id: 'sep1',   label: '', separator: true },
      { id: 'rename', label: '重命名',   icon: 'pencil', onClick: () => handleRename(album.id, album.name) },
      { id: 'sep2',   label: '', separator: true },
      { id: 'delete', label: '删除相册', icon: 'trash',  danger: true, onClick: () => handleDelete(album.id) },
    ])
  }, [openCtxMenu, handleOpen, handleRename, handleDelete])

  // ── 拖拽排序 ──
  const handleDragStart = useCallback((_e: DragEvent, id: string) => { dragSrcRef.current = id }, [])
  const handleDragOver  = useCallback((_e: DragEvent, id: string) => {
    if (dragSrcRef.current !== id) setDragOverId(id)
  }, [])
  const handleDrop = useCallback((_e: DragEvent, targetId: string) => {
    const srcId = dragSrcRef.current
    if (!srcId || srcId === targetId) { setDragOverId(null); return }
    const si = albums.findIndex((a) => a.id === srcId)
    const ti = albums.findIndex((a) => a.id === targetId)
    if (si !== -1 && ti !== -1) {
      reorderMut.mutate({ id: srcId,   sortOrder: ti })
      reorderMut.mutate({ id: targetId, sortOrder: si })
    }
    setDragOverId(null); dragSrcRef.current = null
  }, [albums, reorderMut])
  const handleDragEnd = useCallback(() => { setDragOverId(null); dragSrcRef.current = null }, [])

  // ── 骨架屏 ──
  if (isLoading) {
    return (
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))', gap:'16px', padding:'24px' }}>
        {[0,1,2,3,4,5].map((i) => (
          <div key={i} style={{ borderRadius:'var(--la-radius-lg)', overflow:'hidden', backgroundColor:'var(--la-bg-raised)' }}>
            <div style={{ aspectRatio:'1', backgroundImage:'linear-gradient(90deg,var(--la-bg-overlay) 0%,var(--la-bg-hover) 50%,var(--la-bg-overlay) 100%)', backgroundSize:'200% 100%', animation:'la-shimmer 1.5s linear infinite', animationDelay:`${i*0.08}s` }} />
            <div style={{ padding:'10px 12px 14px' }}>
              <div style={{ height:'13px', width:'65%', borderRadius:'4px', backgroundColor:'var(--la-bg-overlay)', marginBottom:'6px' }} />
              <div style={{ height:'10px', width:'40%', borderRadius:'4px', backgroundColor:'var(--la-bg-overlay)' }} />
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <>
      <div style={{ height:'100%', overflowY:'auto', padding:'24px' }}>
        <h1 style={{ fontSize:'var(--la-text-xl)', fontWeight:700, color:'var(--la-text-primary)', marginBottom:'20px', lineHeight:1.2 }}>
          相册
        </h1>

        <motion.div layout style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))', gap:'16px' }}>
          {/* 新建卡片 */}
          <NewAlbumCard onClick={() => setShowCreate(true)} />

          <AnimatePresence>
            {albums.map((album) => (
              <AlbumCard
                key={album.id}
                album={album}
                onOpen={handleOpen}
                onRename={handleRename}
                onDelete={handleDelete}
                onContext={handleContext}
                isDragOver={dragOverId === album.id}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onDragEnd={handleDragEnd}
              />
            ))}
          </AnimatePresence>
        </motion.div>

        {albums.length === 0 && (
          <div style={{ marginTop:'48px', display:'flex', flexDirection:'column', alignItems:'center', gap:'10px', color:'var(--la-text-tertiary)' }}>
            <Icon name="book" size={44} strokeWidth={1} />
            <p style={{ fontSize:'var(--la-text-sm)' }}>还没有相册</p>
            <p style={{ fontSize:'var(--la-text-xs)' }}>点击「新建相册」创建你的第一个相册</p>
          </div>
        )}
      </div>

      <AnimatePresence>
        {showCreate && <CreateAlbumDialog key="create" onClose={() => setShowCreate(false)} />}
      </AnimatePresence>
    </>
  )
}

// ─────────────────────────────────────────────────────────
//  NewAlbumCard — 新建相册虚拟卡片
// ─────────────────────────────────────────────────────────

function NewAlbumCard({ onClick }: { onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-label="新建相册"
      style={{
        cursor:          'default',
        borderRadius:    'var(--la-radius-lg)',
        overflow:        'hidden',
        backgroundColor: 'transparent',
        border:          `2px dashed ${hovered ? 'var(--la-accent)' : 'var(--la-border)'}`,
        transition:      'border-color 150ms ease',
        display:         'flex',
        flexDirection:   'column',
        alignItems:      'center',
        justifyContent:  'center',
        gap:             '8px',
        aspectRatio:     '1.1',
        color:           hovered ? 'var(--la-accent)' : 'var(--la-text-tertiary)',
        padding:         0,
      }}
    >
      <Icon name="plus" size={24} color={hovered ? 'var(--la-accent)' : 'var(--la-text-tertiary)'} strokeWidth={1.5} />
      <span style={{ fontSize:'var(--la-text-sm)', fontWeight:500, lineHeight:1 }}>新建相册</span>
    </button>
  )
}
