/**
 * @file src/types/commands.ts
 * @description Tauri IPC command signatures, AlbumUpdateParams, and error types.
 */

import type { Photo, PhotoThumb, PhotoPage, ScanProgress } from './photo'
import type { Album, AlbumSummary, WatchedFolder, LibraryStats } from './album'
import type {
  PhotoFilter,
  SearchQuery,
  ThumbSize,
  PhotoUpdateParams,
  AppSettings,
  StorageInfo,
  Tag,
  SearchSuggestions,
} from './filters'

// ── CQ-H5: Typed album update params (replaces Record<string, unknown> spread) ──

export interface AlbumUpdateParams {
  id: string
  name?: string
  description?: string
  coverPhotoId?: string | null
  sortOrder?: number
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
  search_suggestions: (args: { q: string; limit?: number }) => SearchSuggestions
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
  /** CQ-H5: typed params replace open-ended Record spread */
  albums_update:      (args: AlbumUpdateParams) => Album
  albums_delete:      (args: { id: string }) => void
  album_photos_list:  (args: { albumId: string; cursor?: string; limit?: number }) => PhotoPage
  album_photos_add:   (args: { albumId: string; photoIds: string[] }) => void
  album_photos_remove:(args: { albumId: string; photoIds: string[] }) => void
  album_photos_reorder:(args: { albumId: string; orderedPhotoIds: string[] }) => void
  /** v2 新增：创建私密相册 */
  album_create_private:(args: { name: string; password: string }) => Album
  /** v2 新增：设置/取消私密状态 */
  album_set_private:  (args: { id: string; isPrivate: boolean; password?: string }) => Album
  /** v2 新增；SEC-H3：成功返回 HMAC session token，失败/未设置密码返回 null */
  album_verify_password:(args: { id: string; password: string }) => string | null
  /** SEC-H3 新增：检查 token 是否仍有效（未过期且绑定相册匹配）*/
  album_check_token:    (args: { id: string; token: string }) => boolean

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
