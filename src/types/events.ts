/**
 * @file src/types/events.ts
 * @description Tauri event payload types and TAURI_EVENTS constants (CQ-L1).
 */

import type { ScanProgress } from './photo'
import type { Photo } from './photo'

export interface ScanStartedPayload   { folder: string; taskId: string }
export type ScanProgressPayload       = ScanProgress
export interface ScanCompletedPayload { folder: string; totalNew: number; totalUpdated: number; durationMs: number }
export interface ScanErrorPayload     { path: string; error: string }
export interface ThumbReadyPayload    { photoId: string; size: 's' | 'm' | 'l' }
export interface ThumbBatchDonePayload { count: number; remaining: number }

/**
 * Phase-A：统一为数组格式。
 * Rust 侧两条 emit 路径均已修改为 string[] 格式。
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

/** CQ-L1: Typed constants for all Tauri event names — avoids stringly-typed event subscriptions. */
export const TAURI_EVENTS = {
  SCAN_STARTED:    'scan:started',
  SCAN_PROGRESS:   'scan:progress',
  SCAN_COMPLETED:  'scan:completed',
  SCAN_ERROR:      'scan:error',
  THUMB_READY:     'thumb:ready',
  THUMB_BATCH_DONE:'thumb:batch_done',
  LIBRARY_CHANGED: 'library:changed',
  PHOTO_UPDATED:   'photo:updated',
  ALBUM_UPDATED:   'album:updated',
} as const satisfies Record<string, keyof TauriEventMap>
