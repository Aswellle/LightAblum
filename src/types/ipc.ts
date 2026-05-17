/**
 * @file src/types/ipc.ts
 * @description Tauri IPC 层类型定义（v2 — 回收站/私密相册命令）
 *
 * v2 新增命令：
 *   photos_purge_data       — 仅从程序清除（不删磁盘文件）
 *   albums_list_all         — 含私密相册的完整列表
 *   album_create_private    — 创建私密相册
 *   album_set_private       — 设置/取消私密状态
 *   album_verify_password   — 验证私密相册密码
 *   storage_get_info / storage_clear_thumbnails / storage_open_data_dir
 *
 * Phase-A（library:changed 类型对齐）：
 *   LibraryChangedPayload 原定义为 { added: number; modified: number; removed: number }
 *   与实际 Rust emit payload 不符（watcher 发送 string[]，scan.rs 经本次修复后也统一为 string[]）。
 *   修正为 { added: string[]; modified: string[]; removed: string[] }，
 *   eventBus.ts 中的 `any` workaround 可随之清除。
 */

import type { Photo, PhotoThumb, PhotoPage, ScanProgress } from './photo'
import type { Album, AlbumSummary, WatchedFolder, LibraryStats } from './album'

export type PhotoSortField = 'created_at' | 'imported_at' | 'file_name' | 'file_size'

export interface PhotoFilter {
  favoritesOnly?: boolean
  folderPath?: string
  albumId?: string
  format?: string
  dateFrom?: string
  dateTo?: string
  hasGps?: boolean
  isDeleted?: boolean
  sortBy?: PhotoSortField
  sortAsc?: boolean
}

export interface SearchQuery {
  text?: string
  dateFrom?: string
  dateTo?: string
  cameraMake?: string
  cameraModel?: string
  hasGps?: boolean
  format?: string
  rating?: number
  limit?: number
  cursor?: string
  /** Phase-B（M-12）：按标签 ID 过滤（AND 语义，全部匹配）*/
  tagIds?: string[]
}

export type ThumbSize = 's' | 'm' | 'l'

export interface PhotoUpdateParams {
  isFavorite?: boolean
  rating?: number
}

export type AppTheme = 'light' | 'dark' | 'system'
export type GridDensityLevel = 1 | 2 | 3 | 4

export interface AppSettings {
  theme: AppTheme
  gridDensity: GridDensityLevel
  sortBy: PhotoSortField
  sortAsc: boolean
  watchedFolders: string[]
  sidebarWidth: number
  autoHidePreviewUI: boolean
  previewOnDoubleClick: boolean
}

export interface StorageInfo {
  thumbnailCount: number
  thumbnailSizeBytes: number
  dbSizeBytes: number
  totalSizeBytes: number
  dataDir: string
}

// ── 标签类型（Phase-B M-12）──

export type TagSource = 'manual' | 'auto_ai' | 'auto_exif'

export interface Tag {
  id:         string
  name:       string
  color:      string
  createdAt:  string
  sortOrder:  number
  usageCount: number
}

// ── IPC 事件 Payload ──
export interface ScanStartedPayload   { folder: string; taskId: string }
export type ScanProgressPayload       = ScanProgress
export interface ScanCompletedPayload { folder: string; totalNew: number; totalUpdated: number; durationMs: number }
export interface ScanErrorPayload     { path: string; error: string }
export interface ThumbReadyPayload    { photoId: string; size: ThumbSize }
export interface ThumbBatchDonePayload { count: number; remaining: number }

/**
 * Phase-A：统一为数组格式。
 * Rust 侧两条 emit 路径（scan.rs run_scan + state.rs handle_watch_events）
 * 均已修改为 string[] 格式，此处与之对齐。
 * added    — 新增文件的磁盘绝对路径列表
 * modified — 元数据更新的文件路径列表
 * removed  — 从磁盘删除或移出监听范围的文件路径列表
 */
export interface LibraryChangedPayload {
  added:    string[]
  modified: string[]
  removed:  string[]
}

export interface PhotoUpdatedPayload  { photoId: string; fields: Array<keyof Photo> }
export interface AlbumUpdatedPayload  { albumId: string; action: 'created' | 'deleted' | 'renamed' | 'photos_added' | 'photos_removed' | 'cover_changed' }

export interface TauriEventMap {
  'scan:started':    ScanStartedPayload
  'scan:progress':   ScanProgressPayload
  'scan:completed':  ScanCompletedPayload
  'scan:error':      ScanErrorPayload
  'thumb:ready':     ThumbReadyPayload
  'thumb:batch_done': ThumbBatchDonePayload
  'library:changed': LibraryChangedPayload
  'photo:updated':   PhotoUpdatedPayload
  'album:updated':   AlbumUpdatedPayload
}

export interface IpcCommands {
  // ── 扫描 ──
  import_scan:        (args: { path: string }) => ScanProgress
  import_scan_status: () => { isScanning: boolean; progress: ScanProgress | null }
  folders_list:       () => WatchedFolder[]
  folders_remove:     (args: { path: string; deletePhotos?: boolean }) => void

  // ── 照片查询 ──
  photos_list:        (args: { filter: PhotoFilter; cursor?: string; limit?: number }) => PhotoPage
  photos_get:         (args: { id: string }) => Photo
  photos_get_batch:   (args: { ids: string[] }) => PhotoThumb[]

  // ── 照片修改 ──
  photos_update:      (args: { id: string; params: PhotoUpdateParams }) => Photo
  photos_delete:      (args: { ids: string[] }) => void
  photos_restore:     (args: { ids: string[] }) => void
  /** 永久删除（同时删除磁盘原文件）*/
  photos_purge:       (args: { ids: string[] }) => void
  /** v2 新增：仅从程序清除（不删磁盘文件）*/
  photos_purge_data:  (args: { ids: string[] }) => void
  photos_favorite:    (args: { id: string; value: boolean }) => void
  /** Phase-D：批量切换收藏，原子写一条 undo_log，支持 Ctrl+Z 回滚整批操作 */
  photos_favorite_batch: (args: { ids: string[]; value: boolean }) => void

  // ── 搜索 ──
  search_photos:      (args: { query: SearchQuery }) => PhotoPage
  search_suggestions: (args: { q: string; limit?: number }) => { fileNames: string[]; cameras: string[]; folders: string[] }
  search_stats:       () => LibraryStats

  // ── 缩略图 ──
  thumbnail_get_path: (args: { photoId: string; size: ThumbSize }) => string | null
  thumbnail_request:  (args: { photoIds: string[]; size: ThumbSize; priority?: 'high' | 'normal' }) => void

  // ── 相册 ──
  albums_list:        () => AlbumSummary[]
  /** v2 新增：含私密相册的完整列表 */
  albums_list_all:    () => AlbumSummary[]
  albums_get:         (args: { id: string }) => Album
  albums_create:      (args: { name: string; description?: string }) => Album
  albums_update:      (args: { id: string; name?: string; description?: string; coverPhotoId?: string | null; sortOrder?: number }) => Album
  albums_delete:      (args: { id: string }) => void
  album_photos_list:  (args: { albumId: string; cursor?: string; limit?: number }) => PhotoPage
  album_photos_add:   (args: { albumId: string; photoIds: string[] }) => void
  album_photos_remove:(args: { albumId: string; photoIds: string[] }) => void
  album_photos_reorder:(args: { albumId: string; orderedPhotoIds: string[] }) => void
  /** v2 新增：创建私密相册 */
  album_create_private:(args: { name: string; password: string }) => Album
  /** v2 新增：设置/取消私密状态 */
  album_set_private:  (args: { id: string; isPrivate: boolean; password?: string }) => Album
  /** v2 新增：验证密码 */
  album_verify_password:(args: { id: string; password: string }) => boolean

  // ── 设置 ──
  settings_get:       () => AppSettings
  settings_update:    (args: { settings: Partial<AppSettings> }) => AppSettings
  storage_get_info:   () => StorageInfo
  storage_clear_thumbnails: () => number
  storage_open_data_dir: () => void

  // ── 标签（Phase-B M-12）──
  tags_list:          () => Tag[]
  tags_create:        (args: { name: string; color: string }) => Tag
  tags_delete:        (args: { id: string }) => void
  photo_tags_get:     (args: { photoId: string }) => Tag[]
  photo_tags_add:     (args: { photoId: string; tagIds: string[] }) => void
  photo_tags_remove:  (args: { photoId: string; tagIds: string[] }) => void

  // ── 撤销 ──
  undo_last: () => { undoId: number; action: string; reversed: boolean; detail: string }
}

export interface IpcError { code: string; detail?: string; message: string }
export function isIpcError(e: unknown): e is IpcError {
  return typeof e === 'object' && e !== null && 'code' in e
}

export interface SearchSuggestions { fileNames: string[]; cameras: string[]; folders: string[] }
