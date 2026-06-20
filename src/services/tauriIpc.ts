/**
 * @file src/services/tauriIpc.ts
 * @description Tauri IPC 封装层（v2 — 回收站操作 + 私密相册 API）
 *
 * v2 新增：
 *   api.photos.purgeData()         — 仅从程序清除（不删磁盘文件）
 *   api.albums.listAll()           — 含私密相册的完整列表
 *   api.albums.createPrivate()     — 创建私密相册
 *   api.albums.setPrivate()        — 设置/取消私密状态
 *   api.albums.verifyPassword()    — 验证私密相册密码
 */

import { invoke } from '@tauri-apps/api/core'
import { open as openFileDialog } from '@tauri-apps/plugin-dialog'
import type {
  IpcCommands,
  AlbumUpdateParams,
  PhotoFilter,
  SearchQuery,
  ThumbSize,
  AppSettings,
  PhotoUpdateParams,
} from '@/types/ipc'
import { isIpcError } from '@/types/ipc'
import { toast } from '@/stores/uiStore'
import { locale } from '@/locales'

const DEV = import.meta.env.DEV

// SEC-H1: commands whose args contain a password/PIN — redact before logging
const SENSITIVE_IPC_COMMANDS = new Set<string>([
  'album_create_private',
  'album_set_private',
  'album_verify_password',
])

export async function ipc<K extends keyof IpcCommands>(
  command: K,
  args?: Parameters<IpcCommands[K]>[0],
  options: IpcCallOptions = {},
): Promise<Awaited<ReturnType<IpcCommands[K]>>> {
  const { silent = false, errorMessage } = options

  if (DEV) {
    const loggableArgs =
      args != null && SENSITIVE_IPC_COMMANDS.has(command)
        ? { ...(args as Record<string, unknown>), password: '[REDACTED]' }
        : args
    console.debug(`[IPC →] ${command}`, loggableArgs ?? '(no args)')
  }

  try {
    const result = await invoke<Awaited<ReturnType<IpcCommands[K]>>>(
      command,
      args as Record<string, unknown>,
    )
    if (DEV) console.debug(`[IPC ←] ${command}`, result)
    return result
  } catch (raw) {
    const err = parseIpcError(raw, command)
    if (DEV) console.error(`[IPC ✗] ${command}`, err)
    if (!silent) {
      const msg = errorMessage ?? buildUserMessage(err)
      toast.error(msg)
    }
    throw err
  }
}

export interface IpcCallOptions {
  silent?: boolean
  errorMessage?: string
}

function parseIpcError(raw: unknown, command: string): import('@/types/ipc').IpcError {
  if (isIpcError(raw)) return raw
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      if (isIpcError(parsed)) return parsed
      return { code: 'UNKNOWN', message: raw }
    } catch {
      return { code: 'UNKNOWN', message: raw }
    }
  }
  return { code: 'UNKNOWN', message: `IPC command '${command}' failed`, detail: String(raw) }
}

function buildUserMessage(err: import('@/types/ipc').IpcError): string {
  // CQ-M4: single cast on the map avoids the double-as pattern
  const errorsMap = locale.errors as Record<string, string | undefined>
  return errorsMap[err.code] ?? err.message ?? locale.errors.UNKNOWN
}

export const api = {

  folders: {
    pick: async (): Promise<string | null> => {
      const selected = await openFileDialog({ directory: true, multiple: false, title: '选择照片文件夹' })
      return typeof selected === 'string' ? selected : null
    },
    add:        (path: string) => ipc('import_scan', { path }),
    scanStatus: () => ipc('import_scan_status'),
    list:       () => ipc('folders_list'),
    remove:     (path: string, deletePhotos = false) => ipc('folders_remove', { path, deletePhotos }),
  },

  photos: {
    list: (filter: PhotoFilter = {}, cursor?: string, limit = 100) =>
      ipc('photos_list', { filter, cursor, limit }),
    get:         (id: string) => ipc('photos_get', { id }),
    getBatch:    (ids: string[]) => ipc('photos_get_batch', { ids }),
    update:      (id: string, params: PhotoUpdateParams) => ipc('photos_update', { id, params }),
    setFavorite: (id: string, value: boolean) => ipc('photos_favorite', { id, value }),
    delete:      (ids: string[]) => ipc('photos_delete', { ids }),
    restore:     (ids: string[]) => ipc('photos_restore', { ids }),
    /** 永久删除（同时删除磁盘原文件）*/
    purge:       (ids: string[]) => ipc('photos_purge', { ids }),
    /** v2 新增：仅从程序清除（不删磁盘文件）*/
    purgeData:   (ids: string[]) => ipc('photos_purge_data', { ids }),
    /** Phase-D：批量切换收藏，原子 undo_log，支持 Ctrl+Z 一次性回滚整批 */
    setFavoriteBatch: (ids: string[], value: boolean) =>
      ipc('photos_favorite_batch', { ids, value }),
  },

  search: {
    query:       (query: SearchQuery) => ipc('search_photos', { query }),
    suggestions: (q: string, limit = 10) => ipc('search_suggestions', { q, limit }),
    stats:       () => ipc('search_stats'),
  },

  thumbnails: {
    getPath: (photoId: string, size: ThumbSize) =>
      ipc('thumbnail_get_path', { photoId, size }, { silent: true }),
    request: (photoIds: string[], size: ThumbSize, priority: 'high' | 'normal' = 'normal') =>
      ipc('thumbnail_request', { photoIds, size, priority }, { silent: true }),
  },

  albums: {
    /** 侧边栏列表（排除私密相册）*/
    list:    () => ipc('albums_list'),
    /** 含私密相册的完整列表（管理/私密相册入口用）*/
    listAll: () => ipc('albums_list_all'),
    get:     (id: string) => ipc('albums_get', { id }),
    create:  (name: string, description?: string) => ipc('albums_create', { name, description }),
    update:  (params: AlbumUpdateParams) =>
      ipc('albums_update', params),
    delete:       (id: string) => ipc('albums_delete', { id }),
    photos:       (albumId: string, cursor?: string, limit = 100) => ipc('album_photos_list', { albumId, cursor, limit }),
    addPhotos:    (albumId: string, photoIds: string[]) => ipc('album_photos_add', { albumId, photoIds }),
    removePhotos: (albumId: string, photoIds: string[]) => ipc('album_photos_remove', { albumId, photoIds }),
    reorder:      (albumId: string, orderedPhotoIds: string[]) => ipc('album_photos_reorder', { albumId, orderedPhotoIds }),

    /** v2 新增：创建私密相册（传明文密码，后端 bcrypt）*/
    createPrivate:   (name: string, password: string) => ipc('album_create_private', { name, password }),
    /** v2 新增：设置/取消私密状态 */
    setPrivate:      (id: string, isPrivate: boolean, password?: string) =>
      ipc('album_set_private', { id, isPrivate, password }),
    /** v2 新增；SEC-H3：成功返回 HMAC token，失败返回 null */
    verifyPassword:  (id: string, password: string) =>
      ipc('album_verify_password', { id, password }, { silent: true }),
    /** SEC-H3 新增：检查已有 token 是否仍有效 */
    checkToken:      (id: string, token: string) =>
      ipc('album_check_token', { id, token }, { silent: true }),
  },

  /** Phase-B M-12：标签系统 */
  tags: {
    list:           ()                                    => ipc('tags_list'),
    create:         (name: string, color: string)         => ipc('tags_create', { name, color }),
    delete:         (id: string)                          => ipc('tags_delete', { id }),
    getForPhoto:    (photoId: string)                     => ipc('photo_tags_get', { photoId }),
    addToPhoto:     (photoId: string, tagIds: string[])   => ipc('photo_tags_add', { photoId, tagIds }),
    removeFromPhoto:(photoId: string, tagIds: string[])   => ipc('photo_tags_remove', { photoId, tagIds }),
  },

  settings: {
    get:    () => ipc('settings_get'),
    update: (settings: Partial<AppSettings>) => ipc('settings_update', { settings }),
  },

  storage: {
    getInfo:          () => ipc('storage_get_info'),
    clearThumbnails:  () => ipc('storage_clear_thumbnails'),
    openDataDir:      () => ipc('storage_open_data_dir'),
  },

  undo: {
    last: () => ipc('undo_last', undefined, { errorMessage: '没有可撤销的操作' }),
  },
}
