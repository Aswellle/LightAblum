/**
 * @file src/components/layout/Sidebar.tsx
 * @description 侧边栏导航组件（v3 — 私密相册 | Phase-B — 标签筛选区块）
 *
 * v3 变更：
 *   - 设置按钮：dispatch 'app:open-settings' 事件（替换 toast.info 占位）
 *   - 私密相册：在相册列表底部固定显示「🔒 私密相册」入口
 *     点击 → 进入私密相册视图（带密码解锁界面）
 *   - 「+ 新建相册」下拉菜单增加「新建私密相册」选项
 *   - AlbumItem 私密相册显示 🔒 图标而非 📖 图标
 *   - 相册数据改用 api.albums.listAll()（含私密相册）
 *     侧边栏展示所有相册，私密相册带锁标识
 */

import {
  useState,
  useRef,
  useCallback,
  memo,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/tauriIpc'
import { useUiStore, selectCurrentView, selectIsSidebarCollapsed } from '@/stores/uiStore'
import { SIDEBAR_NAV_ITEMS, viewStateMatches, isAlbumView, isFolderView } from '@/app/routes'
import { Icon, type IconName } from '@/components/common/Icon'
import { CreateAlbumDialog } from '@/components/album/CreateAlbumDialog'
import { TagFilterPanel } from '@/components/layout/TagFilterPanel'  // Phase-B M-12
import { CreatePrivateAlbumDialog } from '@/components/album/PrivateAlbum'
import type { AlbumSummary, WatchedFolder } from '@/types/album'
import type { LibraryStats } from '@/types/album'  // Fix: sidebar nav counts
import type { ViewState } from '@/types/layout'
import { toast } from '@/stores/uiStore'

// ─────────────────────────────────────────────────────────
//  导航项图标映射
// ─────────────────────────────────────────────────────────

const NAV_ICONS: Record<string, IconName> = {
  all_photos:        'images',
  favorites:         'heart',
  recently_imported: 'clock',
  trash:             'trash',
}

// ─────────────────────────────────────────────────────────
//  NavItem — 固定导航按钮
// ─────────────────────────────────────────────────────────

interface NavItemProps {
  label:    string
  iconName: IconName
  active:   boolean
  collapsed: boolean
  onClick:  () => void
  count?:   number
}

const NavItem = memo(function NavItem({
  label, iconName, active, collapsed, onClick, count,
}: NavItemProps) {
  return (
    <button
      onClick={onClick}
      title={collapsed ? label : undefined}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      style={{
        display:         'flex',
        alignItems:      'center',
        gap:             '8px',
        padding:         collapsed ? '8px 0' : '7px 10px',
        justifyContent:  collapsed ? 'center' : 'flex-start',
        borderRadius:    'var(--la-radius-md)',
        margin:          '1px 4px',
        width:           'calc(100% - 8px)',
        cursor:          'default',
        transition:      'all 120ms ease',
        backgroundColor: active ? 'var(--la-bg-active)' : 'transparent',
        color:           active ? 'var(--la-text-primary)' : 'var(--la-text-secondary)',
        border:          'none',
        outline:         'none',
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.backgroundColor = 'var(--la-bg-hover)'
          e.currentTarget.style.color = 'var(--la-text-primary)'
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.backgroundColor = 'transparent'
          e.currentTarget.style.color = 'var(--la-text-secondary)'
        }
      }}
    >
      <Icon name={iconName} size={16} color={active ? 'var(--la-accent)' : 'currentColor'} />

      {!collapsed && (
        <>
          <span style={{
            fontSize:     'var(--la-text-sm)',
            fontWeight:   active ? 'var(--la-weight-medium)' : 'var(--la-weight-regular)',
            flex:         1,
            textAlign:    'left',
            overflow:     'hidden',
            whiteSpace:   'nowrap',
            textOverflow: 'ellipsis',
          }}>
            {label}
          </span>
          {count !== undefined && count > 0 && (
            <span style={{
              fontSize:           '11px',
              color:              'var(--la-text-tertiary)',
              backgroundColor:    'var(--la-bg-overlay)',
              borderRadius:       '10px',
              padding:            '1px 6px',
              minWidth:           '20px',
              textAlign:          'center',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {count > 999 ? '999+' : count}
            </span>
          )}
        </>
      )}
    </button>
  )
})

// ─────────────────────────────────────────────────────────
//  SectionHeader — 分组标题
// ─────────────────────────────────────────────────────────

interface SectionHeaderProps {
  label:       string
  collapsed:   boolean
  onAction?:   () => void
  actionIcon?: IconName
  actionLabel?: string
  onSecondaryAction?: () => void
  secondaryIcon?: IconName
  secondaryLabel?: string
}

function SectionHeader({
  label, collapsed, onAction, actionIcon, actionLabel,
  onSecondaryAction, secondaryIcon, secondaryLabel,
}: SectionHeaderProps) {
  if (collapsed) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '4px 14px 2px', gap: '4px' }}>
      <span style={{
        fontSize: 'var(--la-text-xs)', fontWeight: 'var(--la-weight-semibold)',
        color: 'var(--la-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', flex: 1,
      }}>
        {label}
      </span>
      {onSecondaryAction && secondaryIcon && (
        <HeaderBtn onClick={onSecondaryAction} title={secondaryLabel} icon={secondaryIcon} />
      )}
      {onAction && actionIcon && (
        <HeaderBtn onClick={onAction} title={actionLabel} icon={actionIcon} />
      )}
    </div>
  )
}

function HeaderBtn({ onClick, title, icon }: { onClick: () => void; title?: string; icon: IconName }) {
  return (
    <button
      onClick={onClick} title={title} aria-label={title}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '18px', height: '18px', borderRadius: 'var(--la-radius-sm)', backgroundColor: 'transparent', border: 'none', color: 'var(--la-text-tertiary)', cursor: 'default', transition: 'all 100ms ease' }}
      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--la-bg-hover)'; e.currentTarget.style.color = 'var(--la-text-secondary)' }}
      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--la-text-tertiary)' }}
    >
      <Icon name={icon} size={12} strokeWidth={2} />
    </button>
  )
}

// ─────────────────────────────────────────────────────────
//  AlbumItem — 单个相册行（v3：私密相册显示锁图标）
// ─────────────────────────────────────────────────────────

interface AlbumItemProps {
  album:     AlbumSummary
  active:    boolean
  onClick:   () => void
  onRename:  (id: string, name: string) => void
  onDelete:  (id: string) => void
  onContext: (e: MouseEvent, album: AlbumSummary) => void
}

const AlbumItem = memo(function AlbumItem({
  album, active, onClick, onRename, onDelete: _onDelete, onContext,
}: AlbumItemProps) {
  const [isRenaming, setIsRenaming] = useState(false)
  const [editName, setEditName]     = useState(album.name)
  const inputRef                    = useRef<HTMLInputElement>(null)

  const commitRename = useCallback(() => {
    const trimmed = editName.trim()
    if (trimmed && trimmed !== album.name) onRename(album.id, trimmed)
    setIsRenaming(false)
  }, [editName, album.id, album.name, onRename])

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter')  { e.preventDefault(); commitRename() }
    if (e.key === 'Escape') { setIsRenaming(false); setEditName(album.name) }
  }, [commitRename, album.name])

  // 监听重命名事件
  useState(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ id: string }>).detail
      if (detail.id === album.id) {
        setEditName(album.name)
        setIsRenaming(true)
        setTimeout(() => inputRef.current?.focus(), 50)
      }
    }
    document.addEventListener('album:start-rename', handler)
    return () => document.removeEventListener('album:start-rename', handler)
  })

  return (
    <div
      onContextMenu={(e) => onContext(e, album)}
      onClick={() => !isRenaming && onClick()}
      style={{
        display:         'flex',
        alignItems:      'center',
        gap:             '7px',
        padding:         '6px 10px 6px 12px',
        margin:          '1px 4px',
        borderRadius:    'var(--la-radius-md)',
        cursor:          'default',
        transition:      'all 100ms ease',
        backgroundColor: active ? 'var(--la-bg-active)' : 'transparent',
        color:           active ? 'var(--la-text-primary)' : 'var(--la-text-secondary)',
      }}
      onMouseEnter={(e) => {
        if (!active) { e.currentTarget.style.backgroundColor = 'var(--la-bg-hover)'; e.currentTarget.style.color = 'var(--la-text-primary)' }
      }}
      onMouseLeave={(e) => {
        if (!active) { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--la-text-secondary)' }
      }}
    >
      {/* v3：私密相册显示锁图标，普通相册显示 book */}
      {album.isPrivate ? (
        <Icon name="lock" size={13} color={active ? 'var(--la-accent)' : 'var(--la-text-tertiary)'} style={{ flexShrink: 0 }} />
      ) : (
        <Icon name="book" size={14} color={active ? 'var(--la-accent)' : 'currentColor'} style={{ flexShrink: 0 }} />
      )}

      {isRenaming ? (
        <input
          ref={inputRef}
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={commitRename}
          onClick={(e) => e.stopPropagation()}
          maxLength={64}
          style={{ flex: 1, fontSize: 'var(--la-text-sm)', color: 'var(--la-text-primary)', backgroundColor: 'var(--la-bg-overlay)', border: '1px solid var(--la-accent)', borderRadius: '4px', padding: '1px 5px', outline: 'none', userSelect: 'text', minWidth: 0 }}
          autoFocus
        />
      ) : (
        <span style={{ flex: 1, fontSize: 'var(--la-text-sm)', fontWeight: active ? 'var(--la-weight-medium)' : 'var(--la-weight-regular)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', minWidth: 0 }}>
          {album.name}
        </span>
      )}

      {/* Fix: hide count for private albums */}
      {!isRenaming && !album.isPrivate && album.photoCount > 0 && (
        <span style={{ fontSize: '11px', color: 'var(--la-text-tertiary)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
          {album.photoCount > 999 ? '999+' : album.photoCount}
        </span>
      )}
    </div>
  )
})

// ─────────────────────────────────────────────────────────
//  FolderItem — 单个文件夹行
// ─────────────────────────────────────────────────────────

interface FolderItemProps {
  folder:    WatchedFolder
  active:    boolean
  onClick:   () => void
  onRemove:  (path: string) => void
  onContext: (e: MouseEvent, folder: WatchedFolder) => void
}

const FolderItem = memo(function FolderItem({
  folder, active, onClick, onRemove: _onRemove, onContext,
}: FolderItemProps) {
  const displayName = folder.path.split(/[/\\]/).filter(Boolean).pop() ?? folder.path
  return (
    <div
      onContextMenu={(e) => onContext(e, folder)}
      onClick={onClick}
      title={folder.path}
      style={{
        display: 'flex', alignItems: 'center', gap: '7px',
        padding: '6px 10px 6px 12px', margin: '1px 4px', borderRadius: 'var(--la-radius-md)',
        cursor: 'default', transition: 'all 100ms ease',
        backgroundColor: active ? 'var(--la-bg-active)' : 'transparent',
        color: active ? 'var(--la-text-primary)' : 'var(--la-text-secondary)',
      }}
      onMouseEnter={(e) => {
        if (!active) { e.currentTarget.style.backgroundColor = 'var(--la-bg-hover)'; e.currentTarget.style.color = 'var(--la-text-primary)' }
      }}
      onMouseLeave={(e) => {
        if (!active) { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--la-text-secondary)' }
      }}
    >
      <Icon name="folder" size={14} color={active ? 'var(--la-accent)' : 'currentColor'} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, fontSize: 'var(--la-text-sm)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', minWidth: 0 }}>
        {displayName}
      </span>
      {folder.photoCount > 0 && (
        <span style={{ fontSize: '11px', color: 'var(--la-text-tertiary)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
          {folder.photoCount > 999 ? '999+' : folder.photoCount}
        </span>
      )}
    </div>
  )
})

// ─────────────────────────────────────────────────────────
//  Divider
// ─────────────────────────────────────────────────────────

function Divider() {
  return (
    <div style={{ height: '1px', backgroundColor: 'var(--la-divider)', margin: '6px 10px' }} />
  )
}

// ─────────────────────────────────────────────────────────
//  Sidebar — 主组件（v3）
// ─────────────────────────────────────────────────────────

export function Sidebar() {
  const currentView   = useUiStore(selectCurrentView)
  const isCollapsed   = useUiStore(selectIsSidebarCollapsed)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const setView       = useUiStore((s) => s.setView)
  const openCtxMenu   = useUiStore((s) => s.openContextMenu)
  const queryClient   = useQueryClient()

  const [showCreateAlbum, setShowCreateAlbum]               = useState(false)
  const [showCreatePrivateAlbum, setShowCreatePrivateAlbum] = useState(false)

  // v3：使用 listAll 以包含私密相册（侧边栏全量显示）
  const { data: albums = [] } = useQuery({
    queryKey: ['albums'],
    queryFn:  api.albums.listAll,
    staleTime: Infinity,
  })

  // Fix: library stats for sidebar nav item counts
  const { data: stats } = useQuery<LibraryStats>({
    queryKey: ['stats'],
    queryFn:  api.search.stats,
    staleTime: 60 * 1000,
  })

  const { data: folders = [] } = useQuery({
    queryKey: ['folders'],
    queryFn:  api.folders.list,
    staleTime: Infinity,
  })

  // ── 相册 Mutations ──
  const renameAlbum = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.albums.update({ id, name }),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['albums'] }),
    onError:    () => toast.error('重命名失败'),
  })

  const deleteAlbum = useMutation({
    mutationFn: (id: string) => api.albums.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['albums'] })
      if (currentView.type === 'album') setView({ type: 'all_photos' })
      toast.success('相册已删除')
    },
    onError: () => toast.error('删除失败'),
  })

  // ── 文件夹 Mutations ──
  const removeFolder = useMutation({
    mutationFn: (path: string) => api.folders.remove(path),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folders'] })
      queryClient.invalidateQueries({ queryKey: ['photos'] })
      toast.success('已从库中移除文件夹')
    },
    onError: () => toast.error('移除失败'),
  })

  // ── 右键菜单 ──
  const handleAlbumContext = useCallback((e: MouseEvent, album: AlbumSummary) => {
    e.preventDefault()
    openCtxMenu(e.clientX, e.clientY, [
      {
        id: 'rename', label: '重命名', icon: 'pencil',
        onClick: () => document.dispatchEvent(new CustomEvent('album:start-rename', { detail: { id: album.id } })),
      },
      { id: 'sep1', label: '', separator: true },
      { id: 'delete', label: '删除相册', icon: 'trash', danger: true, onClick: () => deleteAlbum.mutate(album.id) },
    ], undefined)
  }, [openCtxMenu, deleteAlbum])

  const handleFolderContext = useCallback((e: MouseEvent, folder: WatchedFolder) => {
    e.preventDefault()
    openCtxMenu(e.clientX, e.clientY, [
      { id: 'remove', label: '从库中移除', icon: 'trash', danger: true, onClick: () => removeFolder.mutate(folder.path) },
    ], undefined)
  }, [openCtxMenu, removeFolder])

  const handleAddFolder = useCallback(async () => {
    const path = await api.folders.pick()
    if (!path) return
    try {
      await api.folders.add(path)
      queryClient.invalidateQueries({ queryKey: ['folders'] })
      toast.success('已开始扫描文件夹')
    } catch { /* error toast handled by ipc */ }
  }, [queryClient])

  // v3：设置按钮 dispatch 事件
  const handleOpenSettings = useCallback(() => {
    document.dispatchEvent(new CustomEvent('app:open-settings'))
  }, [])

  // 分离普通相册和私密相册
  const regularAlbums = albums.filter((a) => !a.isPrivate)
  const privateAlbums = albums.filter((a) => a.isPrivate)

  return (
    <>
      <nav style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

        {/* 折叠/展开按钮 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: isCollapsed ? 'center' : 'flex-end', padding: isCollapsed ? '8px 0' : '6px 8px 4px', flexShrink: 0 }}>
          <button
            onClick={toggleSidebar}
            title={isCollapsed ? '展开侧边栏' : '折叠侧边栏'}
            aria-label={isCollapsed ? '展开侧边栏' : '折叠侧边栏'}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', borderRadius: 'var(--la-radius-md)', backgroundColor: 'transparent', border: 'none', color: 'var(--la-text-tertiary)', cursor: 'default', transition: 'all 100ms ease' }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--la-bg-hover)'; e.currentTarget.style.color = 'var(--la-text-secondary)' }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--la-text-tertiary)' }}
          >
            <Icon name={isCollapsed ? 'chevron-right' : 'chevron-left'} size={14} strokeWidth={2} />
          </button>
        </div>

        {/* 固定导航项 */}
        <div style={{ flexShrink: 0 }}>
          {SIDEBAR_NAV_ITEMS.map((item) => {
            // Fix: real-time counts for all_photos and favorites
            const navCount =
              item.viewType === 'all_photos' ? stats?.totalPhotos
              : item.viewType === 'favorites' ? stats?.totalFavorites
              : undefined
            return (
              <NavItem
                key={item.viewType}
                label={item.label}
                iconName={NAV_ICONS[item.viewType] ?? 'images'}
                active={viewStateMatches(currentView, item)}
                collapsed={isCollapsed}
                onClick={() => setView({ type: item.viewType } as ViewState)}
                count={navCount}
              />
            )
          })}
        </div>

        {/* 展开态：相册 + 文件夹 + 设置 */}
        <AnimatePresence initial={false}>
          {!isCollapsed && (
            <motion.div
              key="expanded-content"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}
            >
              {/* ─── 相册分组 ─── */}
              <Divider />
              <SectionHeader
                label="相册"
                collapsed={false}
                onAction={() => setShowCreateAlbum(true)}
                actionIcon="plus"
                actionLabel="新建相册"
                onSecondaryAction={() => setShowCreatePrivateAlbum(true)}
                secondaryIcon="lock"
                secondaryLabel="新建私密相册"
              />

              {regularAlbums.length === 0 && privateAlbums.length === 0 ? (
                <p style={{ padding: '6px 14px', fontSize: 'var(--la-text-xs)', color: 'var(--la-text-tertiary)', fontStyle: 'italic' }}>
                  暂无相册
                </p>
              ) : (
                regularAlbums.map((album) => (
                  <AlbumItem
                    key={album.id}
                    album={album}
                    active={isAlbumView(currentView, album.id)}
                    onClick={() => setView({ type: 'album', albumId: album.id })}
                    onRename={(id, name) => renameAlbum.mutate({ id, name })}
                    onDelete={(id) => deleteAlbum.mutate(id)}
                    onContext={handleAlbumContext}
                  />
                ))
              )}

              {/* v3：私密相册独立区块（固定在相册列表底部）*/}
              {privateAlbums.length > 0 && (
                <>
                  {regularAlbums.length > 0 && (
                    <div style={{ height: '1px', backgroundColor: 'var(--la-divider)', margin: '4px 14px' }} />
                  )}
                  {privateAlbums.map((album) => (
                    <AlbumItem
                      key={album.id}
                      album={album}
                      active={isAlbumView(currentView, album.id)}
                      onClick={() => setView({ type: 'album', albumId: album.id })}
                      onRename={(id, name) => renameAlbum.mutate({ id, name })}
                      onDelete={(id) => deleteAlbum.mutate(id)}
                      onContext={handleAlbumContext}
                    />
                  ))}
                </>
              )}

              {/* ─── 文件夹分组 ─── */}
              <Divider />
              <SectionHeader label="文件夹" collapsed={false} onAction={handleAddFolder} actionIcon="import" actionLabel="添加文件夹" />

              {folders.length === 0 ? (
                <button
                  onClick={handleAddFolder}
                  style={{
                    margin: '2px 4px', padding: '7px 10px', borderRadius: 'var(--la-radius-md)',
                    backgroundColor: 'transparent', border: '1px dashed var(--la-border)',
                    color: 'var(--la-text-tertiary)', fontSize: 'var(--la-text-xs)', cursor: 'default',
                    width: 'calc(100% - 8px)', transition: 'all 100ms ease',
                    display: 'flex', alignItems: 'center', gap: '6px',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--la-accent)'; e.currentTarget.style.color = 'var(--la-accent)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--la-border)'; e.currentTarget.style.color = 'var(--la-text-tertiary)' }}
                >
                  <Icon name="plus" size={13} strokeWidth={2} />
                  <span>添加照片文件夹</span>
                </button>
              ) : (
                folders.map((folder) => (
                  <FolderItem
                    key={folder.path}
                    folder={folder}
                    active={isFolderView(currentView, folder.path)}
                    onClick={() => setView({ type: 'folder', folderPath: folder.path })}
                    onRemove={(path) => removeFolder.mutate(path)}
                    onContext={handleFolderContext}
                  />
                ))
              )}

              {/* ─── 标签筛选（Phase-B M-12）─── */}
              <Divider />
              <TagFilterPanel collapsed={false} />

              <div style={{ flex: 1 }} />

              {/* ─── 设置按钮（底部固定）v3：触发事件 ─── */}
              <Divider />
              <NavItem
                label="设置"
                iconName="settings"
                active={false}
                collapsed={false}
                onClick={handleOpenSettings}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* 折叠态底部：设置图标 */}
        {isCollapsed && (
          <div style={{ marginTop: 'auto' }}>
            <Divider />
            <NavItem label="设置" iconName="settings" active={false} collapsed={true} onClick={handleOpenSettings} />
          </div>
        )}
      </nav>

      {/* 新建相册弹窗 */}
      <AnimatePresence>
        {showCreateAlbum && (
          <CreateAlbumDialog key="create-album" onClose={() => setShowCreateAlbum(false)} />
        )}
      </AnimatePresence>

      {/* v3：新建私密相册弹窗 */}
      <AnimatePresence>
        {showCreatePrivateAlbum && (
          <CreatePrivateAlbumDialog
            key="create-private-album"
            onClose={() => setShowCreatePrivateAlbum(false)}
            onCreated={(albumId) => {
              queryClient.invalidateQueries({ queryKey: ['albums'] })
              setView({ type: 'album', albumId })
            }}
          />
        )}
      </AnimatePresence>
    </>
  )
}
