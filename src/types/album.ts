/**
 * @file src/types/album.ts
 * @description 相册相关类型定义（v2 — 私密相册字段）
 *
 * v2 新增：
 *   Album / AlbumSummary 新增 isPrivate: boolean, hasPassword: boolean
 */

export interface Album {
  id: string
  name: string
  description: string | null
  coverPhotoId: string | null
  coverThumbnail: string | null
  createdAt: string
  updatedAt: string
  sortOrder: number
  photoCount: number
  /** v2 新增：是否为私密相册 */
  isPrivate: boolean
  /** v2 新增：是否设置了密码 */
  hasPassword: boolean
}

export interface AlbumSummary {
  id: string
  name: string
  coverThumbnail: string | null
  photoCount: number
  updatedAt: string
  /** v2 新增 */
  isPrivate: boolean
  hasPassword: boolean
}

export interface AlbumPhoto {
  albumId: string
  photoId: string
  addedAt: string
  sortOrder: number
}

export interface CreateAlbumParams {
  name: string
  description?: string
}

export interface UpdateAlbumParams {
  name?: string
  description?: string
  coverPhotoId?: string | null
  sortOrder?: number
}

export interface WatchedFolder {
  path: string
  addedAt: string
  lastScanAt: string | null
  photoCount: number
}

export const TAG_PRESET_COLORS = [
  '#007AFF', '#34C759', '#FF9500', '#FF3B30',
  '#AF52DE', '#FF2D55', '#5AC8FA', '#FFCC00',
] as const

export type TagColor = typeof TAG_PRESET_COLORS[number] | string
export type TagSource = 'manual' | 'auto_ai' | 'auto_exif'

export interface Tag {
  id: string; name: string; color: TagColor; createdAt: string
  sortOrder: number; usageCount: number
}

export interface PhotoTag {
  photoId: string; tagId: string; taggedAt: string; source: TagSource
}

export interface LibraryStats {
  totalPhotos: number; totalFavorites: number; totalAlbums: number
  totalSizeBytes: number; formatDistribution: Record<string, number>
  cameraDistribution: Record<string, number>
  dateRange: { earliest: string | null; latest: string | null }
  monthlyCounts: Array<{ month: string; count: number }>
}
