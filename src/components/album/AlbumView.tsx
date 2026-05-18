/**
 * @file src/components/album/AlbumView.tsx
 * @description 相册详情视图
 *
 * 结构：
 *   ┌─ AlbumHeader ─────────────────────────────────────┐
 *   │  [封面缩略图]  相册名称（可行内编辑）               │
 *   │               X 张照片 · 创建于 YYYY年M月          │
 *   │               [编辑封面] [删除相册]                 │
 *   └───────────────────────────────────────────────────┘
 *   ┌─ PhotoGrid（albumId filter）──────────────────────┐
 *   │  与主网格完全一致的虚拟化网格                       │
 *   │  GridItem 右键菜单追加「从相册移除」选项            │
 *   └───────────────────────────────────────────────────┘
 *
 * 关键实现：
 *   - 通过 React Context 向下传递 albumId，
 *     使 GridItem 的右键菜单能感知「当前是在相册视图中」
 *   - 删除相册后自动返回「所有照片」视图
 *   - 封面图片支持点击选择（从相册内照片中选）
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  memo,
} from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/tauriIpc'
import { useUiStore, selectCurrentView } from '@/stores/uiStore'

import { useConfirmDialog } from '@/components/common/ConfirmDialog'
import { Icon } from '@/components/common/Icon'
import { PhotoGrid } from '@/components/grid/PhotoGrid'
import { toast } from '@/stores/uiStore'
import type { Album } from '@/types/album'
import { CoverPicker } from './CoverPicker'

// ─────────────────────────────────────────────────────────
//  AlbumContext — 向 PhotoGrid / GridItem 下传 albumId
//  GridItem 右键菜单通过此 context 感知当前相册，
//  追加「从相册移除」选项。
// ─────────────────────────────────────────────────────────

interface AlbumContextValue {
  albumId:          string | null
  /** 当前相册是否为私密相册（控制菜单操作权限） */
  isPrivateAlbum:   boolean
  removeFromAlbum:  (photoIds: string[]) => void
}

export const AlbumContext = createContext<AlbumContextValue>({
  albumId:         null,
  isPrivateAlbum:  false,
  removeFromAlbum: () => {},
})

export function useAlbumContext() {
  return useContext(AlbumContext)
}

// ─────────────────────────────────────────────────────────
//  AlbumHeader — 相册头部区域
// ─────────────────────────────────────────────────────────

interface AlbumHeaderProps {
  album:            Album
  onBack:           () => void
  onOpenCoverPicker: () => void
}

const AlbumHeader = memo(function AlbumHeader({ album, onBack, onOpenCoverPicker }: AlbumHeaderProps) {
  const queryClient    = useQueryClient()
  const confirm        = useConfirmDialog()
  const setView        = useUiStore((s) => s.setView)

  // ── 行内编辑状态 ──
  const [isEditing, setIsEditing]   = useState(false)
  const [editName,  setEditName]    = useState(album.name)
  const inputRef                    = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.select()
    }
  }, [isEditing])

  const startEdit  = () => { setEditName(album.name); setIsEditing(true) }

  const commitEdit = useCallback(() => {
    const trimmed = editName.trim()
    if (trimmed && trimmed !== album.name) {
      api.albums.update(album.id, { name: trimmed })
        .then(() => queryClient.invalidateQueries({ queryKey: ['albums'] }))
        .catch(() => toast.error('重命名失败'))
    }
    setIsEditing(false)
  }, [editName, album.id, album.name, queryClient])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter')  { e.preventDefault(); commitEdit() }
    if (e.key === 'Escape') { setIsEditing(false); setEditName(album.name) }
  }

  // ── 删除相册 ──
  const handleDelete = useCallback(async () => {
    const ok = await confirm({
      title:        '删除相册',
      message:      `「${album.name}」将被删除，照片文件不受影响`,
      confirmLabel: '删除相册',
      variant:      'danger',
    })
    if (!ok) return
    try {
      await api.albums.delete(album.id)
      queryClient.invalidateQueries({ queryKey: ['albums'] })
      setView({ type: 'all_photos' })
      toast.success('相册已删除')
    } catch {
      toast.error('删除失败')
    }
  }, [album.id, album.name, confirm, setView, queryClient])

  // 格式化创建时间
  const createdLabel = (() => {
    try {
      return new Date(album.createdAt).toLocaleDateString('zh-CN', {
        year: 'numeric', month: 'long',
      })
    } catch { return '' }
  })()

  return (
    <div style={{
      display:         'flex',
      alignItems:      'center',
      gap:             '20px',
      padding:         '20px 24px 16px',
      borderBottom:    '1px solid var(--la-border)',
      backgroundColor: 'var(--la-bg-app)',
      flexShrink:      0,
    }}>
      {/* 返回按钮 */}
      <button
        onClick={onBack}
        title="返回"
        aria-label="返回"
        style={{
          display:         'flex',
          alignItems:      'center',
          justifyContent:  'center',
          width:           '32px',
          height:          '32px',
          borderRadius:    'var(--la-radius-md)',
          backgroundColor: 'var(--la-bg-hover)',
          border:          'none',
          color:           'var(--la-text-secondary)',
          cursor:          'default',
          flexShrink:      0,
          transition:      'all 100ms ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = 'var(--la-bg-active)'
          e.currentTarget.style.color = 'var(--la-text-primary)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'var(--la-bg-hover)'
          e.currentTarget.style.color = 'var(--la-text-secondary)'
        }}
      >
        <Icon name="chevron-left" size={18} strokeWidth={2} />
      </button>

      {/* 封面缩略图 */}
      <div style={{
        width:           '60px',
        height:          '60px',
        borderRadius:    'var(--la-radius-md)',
        overflow:        'hidden',
        flexShrink:      0,
        backgroundColor: 'var(--la-bg-overlay)',
        border:          '1px solid var(--la-border)',
      }}>
        {album.coverThumbnail ? (
          <img
            src={album.coverThumbnail}
            alt={album.name}
            draggable={false}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }}
          />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, var(--la-bg-overlay) 0%, var(--la-bg-raised) 100%)' }}>
            <Icon name="book" size={22} color="var(--la-text-tertiary)" />
          </div>
        )}
      </div>

      {/* 名称 + 元信息 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* 名称（行内编辑） */}
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={commitEdit}
            maxLength={64}
            style={{
              fontSize:        'var(--la-text-xl)',
              fontWeight:      'var(--la-weight-bold)' as unknown as number,
              color:           'var(--la-text-primary)',
              backgroundColor: 'var(--la-bg-overlay)',
              border:          '1px solid var(--la-accent)',
              borderRadius:    'var(--la-radius-sm)',
              padding:         '2px 8px',
              outline:         'none',
              width:           '100%',
              userSelect:      'text',
            }}
            autoFocus
          />
        ) : (
          <h1
            onDoubleClick={startEdit}
            title="双击重命名"
            style={{
              fontSize:     'var(--la-text-xl)',
              fontWeight:   'var(--la-weight-bold)' as unknown as number,
              color:        'var(--la-text-primary)',
              margin:       0,
              lineHeight:   1.2,
              overflow:     'hidden',
              whiteSpace:   'nowrap',
              textOverflow: 'ellipsis',
              cursor:       'default',
            }}
          >
            {album.name}
          </h1>
        )}

        {/* 元信息行 */}
        <div style={{
          display:    'flex',
          alignItems: 'center',
          gap:        '8px',
          marginTop:  '4px',
        }}>
          <span style={{
            fontSize:           'var(--la-text-sm)',
            color:              'var(--la-text-secondary)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {album.photoCount.toLocaleString('zh-CN')} 张照片
          </span>
          {createdLabel && (
            <>
              <span style={{ color: 'var(--la-text-tertiary)', fontSize: '12px' }}>·</span>
              <span style={{ fontSize: 'var(--la-text-sm)', color: 'var(--la-text-tertiary)' }}>
                创建于 {createdLabel}
              </span>
            </>
          )}
        </div>
      </div>

      {/* 操作按钮组 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        {/* 重命名 */}
        <button
          onClick={startEdit}
          title="重命名相册"
          style={{
            display:         'flex',
            alignItems:      'center',
            gap:             '5px',
            padding:         '6px 12px',
            borderRadius:    'var(--la-radius-md)',
            backgroundColor: 'var(--la-bg-overlay)',
            border:          '1px solid var(--la-border)',
            color:           'var(--la-text-secondary)',
            fontSize:        'var(--la-text-sm)',
            cursor:          'default',
            transition:      'all 100ms ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--la-bg-hover)'
            e.currentTarget.style.color = 'var(--la-text-primary)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--la-bg-overlay)'
            e.currentTarget.style.color = 'var(--la-text-secondary)'
          }}
        >
          <Icon name="pencil" size={13} />
          <span>重命名</span>
        </button>

        {/* 编辑封面 */}
        <button
          onClick={onOpenCoverPicker}
          title="编辑封面"
          style={{
            display:         'flex',
            alignItems:      'center',
            gap:             '5px',
            padding:         '6px 12px',
            borderRadius:    'var(--la-radius-md)',
            backgroundColor: 'var(--la-bg-overlay)',
            border:          '1px solid var(--la-border)',
            color:           'var(--la-text-secondary)',
            fontSize:        'var(--la-text-sm)',
            cursor:          'default',
            transition:      'all 100ms ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--la-bg-hover)'
            e.currentTarget.style.color = 'var(--la-text-primary)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--la-bg-overlay)'
            e.currentTarget.style.color = 'var(--la-text-secondary)'
          }}
        >
          <Icon name="square" size={13} />
          <span>编辑封面</span>
        </button>

        {/* 删除 */}
        <button
          onClick={handleDelete}
          title="删除相册（照片不受影响）"
          style={{
            display:         'flex',
            alignItems:      'center',
            gap:             '5px',
            padding:         '6px 12px',
            borderRadius:    'var(--la-radius-md)',
            backgroundColor: 'var(--la-danger-subtle)',
            border:          '1px solid transparent',
            color:           'var(--la-danger)',
            fontSize:        'var(--la-text-sm)',
            cursor:          'default',
            transition:      'all 100ms ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--la-danger)'
            e.currentTarget.style.color = '#fff'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--la-danger-subtle)'
            e.currentTarget.style.color = 'var(--la-danger)'
          }}
        >
          <Icon name="trash" size={13} />
          <span>删除相册</span>
        </button>
      </div>
    </div>
  )
})

// ─────────────────────────────────────────────────────────
//  AlbumEmptyContent — 相册为空时的提示
// ─────────────────────────────────────────────────────────

function AlbumEmptyContent() {
  return (
    <div style={{
      display:        'flex',
      flexDirection:  'column',
      alignItems:     'center',
      justifyContent: 'center',
      height:         '100%',
      gap:            '12px',
      color:          'var(--la-text-tertiary)',
      userSelect:     'none',
    }}>
      <Icon name="images" size={40} color="var(--la-text-tertiary)" />
      <p style={{ fontSize: 'var(--la-text-sm)', color: 'var(--la-text-secondary)' }}>
        相册里还没有照片
      </p>
      <p style={{ fontSize: 'var(--la-text-xs)', color: 'var(--la-text-tertiary)', textAlign: 'center', maxWidth: '240px', lineHeight: 'var(--la-leading-relaxed)' }}>
        在照片网格中右键照片，选择「添加到相册」
      </p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────
//  AlbumView — 主组件
// ─────────────────────────────────────────────────────────

export function AlbumView() {
  const currentView    = useUiStore(selectCurrentView)
  const setView        = useUiStore((s) => s.setView)
  const queryClient    = useQueryClient()

  // 从 ViewState 取 albumId
  const albumId = currentView.type === 'album' ? currentView.albumId : null

  // ── 加载相册详情 ──
  const { data: album, isLoading } = useQuery({
    queryKey:  ['album', albumId],
    queryFn:   () => api.albums.get(albumId!),
    staleTime: Infinity,
    enabled:   Boolean(albumId),
  })

  // ── 从相册移除照片 ──
  const removeFromAlbumMutation = useMutation({
    mutationFn: (photoIds: string[]) =>
      api.albums.removePhotos(albumId!, photoIds),
    onSuccess: (_, photoIds) => {
      queryClient.invalidateQueries({ queryKey: ['photos', { albumId }] })
      queryClient.invalidateQueries({ queryKey: ['album', albumId] })
      queryClient.invalidateQueries({ queryKey: ['albums'] })
      toast.success(`已从相册移除 ${photoIds.length} 张照片`)
    },
    onError: () => toast.error('移除失败'),
  })

  const handleRemoveFromAlbum = useCallback((photoIds: string[]) => {
    removeFromAlbumMutation.mutate(photoIds)
  }, [removeFromAlbumMutation])

  const handleBack = useCallback(() => {
    setView({ type: 'all_photos' })
  }, [setView])

  // ── 封面选择器 ──
  const [isCoverPickerOpen, setIsCoverPickerOpen] = useState(false)

  // ── 无相册 ID ──
  if (!albumId) {
    return (
      <div style={{
        height:         '100%',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        color:          'var(--la-text-tertiary)',
        fontSize:       'var(--la-text-sm)',
      }}>
        请选择相册
      </div>
    )
  }

  // ── 加载中 ──
  if (isLoading || !album) {
    return (
      <div style={{ height: '100%', overflow: 'hidden' }}>
        {/* 头部骨架 */}
        <div style={{
          display:         'flex',
          alignItems:      'center',
          gap:             '20px',
          padding:         '20px 24px 16px',
          borderBottom:    '1px solid var(--la-border)',
          flexShrink:      0,
        }}>
          <div style={{ width: '32px', height: '32px', borderRadius: 'var(--la-radius-md)', backgroundColor: 'var(--la-bg-overlay)' }} />
          <div style={{ width: '60px', height: '60px', borderRadius: 'var(--la-radius-md)', backgroundColor: 'var(--la-bg-overlay)' }} />
          <div>
            <div style={{ width: '180px', height: '22px', borderRadius: '4px', backgroundColor: 'var(--la-bg-overlay)', marginBottom: '8px', backgroundImage: 'linear-gradient(90deg,var(--la-bg-overlay) 0%,var(--la-bg-hover) 50%,var(--la-bg-overlay) 100%)', backgroundSize: '200% 100%', animation: 'la-shimmer 1.5s linear infinite' }} />
            <div style={{ width: '120px', height: '14px', borderRadius: '4px', backgroundColor: 'var(--la-bg-overlay)', backgroundImage: 'linear-gradient(90deg,var(--la-bg-overlay) 0%,var(--la-bg-hover) 50%,var(--la-bg-overlay) 100%)', backgroundSize: '200% 100%', animation: 'la-shimmer 1.5s linear infinite' }} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
    <AlbumContext.Provider value={{
      albumId,
      isPrivateAlbum: album?.isPrivate ?? false,
      removeFromAlbum: handleRemoveFromAlbum,
    }}>
      <div style={{
        height:        '100%',
        display:       'flex',
        flexDirection: 'column',
        overflow:      'hidden',
      }}>
        {/* 相册头部 */}
        <AlbumHeader
          album={album}
          onBack={handleBack}
          onOpenCoverPicker={() => setIsCoverPickerOpen(true)}
        />

        {/* 照片网格（相册内容，空态单独处理）*/}
        <div style={{ flex: 1, minHeight: 0 }}>
          {album.photoCount === 0 ? (
            <AlbumEmptyContent />
          ) : (
            <PhotoGrid />
          )}
        </div>
      </div>
    </AlbumContext.Provider>

    {/* 封面选择器 */}
    {isCoverPickerOpen && (
      <CoverPicker
        albumId={album.id}
        currentCoverId={album.coverPhotoId}
        onClose={() => setIsCoverPickerOpen(false)}
      />
    )}
    </>
  )
}
