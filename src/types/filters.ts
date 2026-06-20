/**
 * @file src/types/filters.ts
 * @description Photo query/filter types, settings, and tag types.
 */

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

  /**
   * SEC-H3: HMAC session token — required when `albumId` refers to a private album.
   * Issued by `album_verify_password` on success; must be forwarded on every
   * `photos_list` call for that album. Backend rejects missing/expired tokens with
   * `TOKEN_REQUIRED`.
   */
  sessionToken?: string
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

export interface TagSuggestion { id: string; name: string; color: string }
export interface SearchSuggestions { fileNames: string[]; cameras: string[]; folders: string[]; tags: TagSuggestion[] }
