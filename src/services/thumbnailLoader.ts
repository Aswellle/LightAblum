/**
 * @file src/services/thumbnailLoader.ts
 * @description 前端缩略图优先级加载调度器
 *
 * Round-5 修复（F-08）：scheduleNext O(N log N) → O(1) 三桶调度
 *
 * Bugfix（缩略图不显示）：
 *   原来用 toAssetUrl() 手动拼接 asset://localhost/<path> URL，
 *   这在 Windows WebView2 上是错误的格式。
 *   Windows WebView2 实际使用 http://asset.localhost/<path>，
 *   macOS/Linux WKWebView 才使用 asset://localhost/<path>。
 *   手动拼接的 URL 在 Windows 上全部返回 403，导致所有缩略图无法显示。
 *
 *   修复：改用 Tauri 官方 API convertFileSrc（@tauri-apps/api/core），
 *   它自动处理平台差异，无需手动拼接，一行代码解决跨平台问题。
 *   同时 tauri.conf.json 需开启 app.security.assetProtocol.enable = true。
 *
 * 三桶调度方案（F-08）：
 *   highQueue / normalQueue / lowQueue 三个独立数组替代单数组 + sort，
 *   dequeueNext() 按优先级顺序 O(1) 取桶，入队 push() 也是 O(1)。
 */

import { convertFileSrc } from '@tauri-apps/api/core'
import { api } from './tauriIpc'
import { onThumbReady } from './eventBus'
import type { ThumbSize } from '@/types/ipc'

// ─────────────────────────────────────────────────────────
//  类型
// ─────────────────────────────────────────────────────────

export type ThumbPriority = 'high' | 'normal' | 'low'

interface QueueItem {
  photoId:  string
  size:     ThumbSize
  priority: ThumbPriority
  resolve:  (url: string) => void
  reject:   (err: unknown) => void
  /** 入队时间戳（同桶内 FIFO，由 push/shift 自然保证，此字段调试用） */
  ts:       number
}

// ─────────────────────────────────────────────────────────
//  LRU 缓存
//  key: `${photoId}:${size}`  value: 可用于 <img src> 的 URL
// ─────────────────────────────────────────────────────────

const LRU_CAPACITY = 1000

class LruCache<K, V> {
  private map = new Map<K, V>()

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined
    const val = this.map.get(key)!
    this.map.delete(key)
    this.map.set(key, val)
    return val
  }

  set(key: K, val: V): void {
    if (this.map.has(key)) this.map.delete(key)
    else if (this.map.size >= LRU_CAPACITY) {
      this.map.delete(this.map.keys().next().value!)
    }
    this.map.set(key, val)
  }

  has(key: K): boolean { return this.map.has(key) }
  delete(key: K): void { this.map.delete(key) }
  clear(): void        { this.map.clear() }
  get size(): number   { return this.map.size }
}

// ─────────────────────────────────────────────────────────
//  全局状态
// ─────────────────────────────────────────────────────────

const cache   = new LruCache<string, string>()
const pending = new Map<string, Promise<string>>()

/** 三优先级桶（镜像 Rust ThumbnailPipeline 三通道设计）*/
const highQueue:   QueueItem[] = []   // 视口中心，立即渲染
const normalQueue: QueueItem[] = []   // overscan，即将可见
const lowQueue:    QueueItem[] = []   // 后台补全

let running = 0
const MAX_CONCURRENT = 6

// ─────────────────────────────────────────────────────────
//  桶操作（O(1)）
// ─────────────────────────────────────────────────────────

function bucketFor(priority: ThumbPriority): QueueItem[] {
  if (priority === 'high')   return highQueue
  if (priority === 'normal') return normalQueue
  return lowQueue
}

function dequeueNext(): QueueItem | undefined {
  if (highQueue.length   > 0) return highQueue.shift()
  if (normalQueue.length > 0) return normalQueue.shift()
  if (lowQueue.length    > 0) return lowQueue.shift()
  return undefined
}

function totalQueued(): number {
  return highQueue.length + normalQueue.length + lowQueue.length
}

// ─────────────────────────────────────────────────────────
//  工具
// ─────────────────────────────────────────────────────────

function cacheKey(photoId: string, size: ThumbSize): string {
  return `${photoId}:${size}`
}

// ─────────────────────────────────────────────────────────
//  调度器核心
// ─────────────────────────────────────────────────────────

function scheduleNext(): void {
  if (running >= MAX_CONCURRENT || totalQueued() === 0) return

  const item = dequeueNext()!
  running++

  fetchThumb(item).finally(() => {
    running--
    scheduleNext()
  })
}

async function fetchThumb(item: QueueItem): Promise<void> {
  const key = cacheKey(item.photoId, item.size)

  try {
    // 二次检查缓存（入队期间可能已被其他请求填充）
    const cached = cache.get(key)
    if (cached) {
      item.resolve(cached)
      return
    }

    // 调用 IPC 获取缩略图磁盘绝对路径
    const filePath = await api.thumbnails.getPath(item.photoId, item.size)

    if (!filePath) {
      // 缩略图尚未生成，返回 ThumbNotReadyError，组件显示骨架屏
      item.reject(new ThumbNotReadyError(item.photoId))
      return
    }

    // Bugfix：用 convertFileSrc 替代手动拼接 asset://localhost/ URL
    //   convertFileSrc 自动处理平台差异：
    //   - Windows (WebView2): http://asset.localhost/C:/path/to/file.webp
    //   - macOS/Linux (WKWebView): asset://localhost/path/to/file.webp
    //   手动拼接 asset://localhost/ 在 Windows 上全部 403，导致缩略图不显示。
    const url = convertFileSrc(filePath)

    cache.set(key, url)
    pending.delete(key)
    item.resolve(url)
  } catch (err) {
    pending.delete(key)
    item.reject(err)
  }
}

// ─────────────────────────────────────────────────────────
//  公开 API
// ─────────────────────────────────────────────────────────

/**
 * 加载缩略图 URL（优先级调度 + LRU 缓存）
 *
 * @param photoId  照片 UUID
 * @param size     缩略图尺寸 's' | 'm' | 'l'
 * @param priority 加载优先级
 * @returns        可直接赋给 <img src> 的 URL
 * @throws         ThumbNotReadyError 缩略图尚未生成（显示骨架屏）
 */
export function loadThumbnail(
  photoId:  string,
  size:     ThumbSize = 's',
  priority: ThumbPriority = 'normal',
): Promise<string> {
  const key = cacheKey(photoId, size)

  // 命中 LRU 缓存 → 立即返回
  const cached = cache.get(key)
  if (cached) return Promise.resolve(cached)

  // 已有进行中的请求 → 复用同一 Promise
  const inFlight = pending.get(key)
  if (inFlight) return inFlight

  // 入队（O(1) push 到对应桶）
  const promise = new Promise<string>((resolve, reject) => {
    bucketFor(priority).push({ photoId, size, priority, resolve, reject, ts: Date.now() })
    scheduleNext()
  })

  pending.set(key, promise)
  return promise
}

/**
 * 批量预加载（进入视口前预取，降低滚动时白屏概率）
 */
export function preloadThumbnails(
  items: Array<{ photoId: string; size: ThumbSize }>,
  priority: ThumbPriority = 'low',
): void {
  for (const { photoId, size } of items) {
    const key = cacheKey(photoId, size)
    if (!cache.has(key) && !pending.has(key)) {
      loadThumbnail(photoId, size, priority).catch(() => {
        // 预加载失败静默忽略
      })
    }
  }
}

/**
 * 主动清除缓存条目（thumb:ready 事件后调用）
 * 让下次 loadThumbnail 重新获取最新路径
 */
export function invalidateThumbnail(photoId: string, size: ThumbSize): void {
  const key = cacheKey(photoId, size)
  cache.delete(key)
  pending.delete(key)
}

/** 清空所有缓存和队列 */
export function clearThumbnailCache(): void {
  cache.clear()
  pending.clear()
  highQueue.length   = 0
  normalQueue.length = 0
  lowQueue.length    = 0
}

/** 当前缓存条目数（调试用） */
export function getCacheSize(): number {
  return cache.size
}

// ─────────────────────────────────────────────────────────
//  自定义错误类型
// ─────────────────────────────────────────────────────────

/** 缩略图尚未生成（组件收到此错误应渲染骨架屏并等待 thumb:ready） */
export class ThumbNotReadyError extends Error {
  constructor(public photoId: string) {
    super(`Thumbnail not ready: ${photoId}`)
    this.name = 'ThumbNotReadyError'
  }
}

export function isThumbNotReady(err: unknown): err is ThumbNotReadyError {
  return err instanceof ThumbNotReadyError
}

// ─────────────────────────────────────────────────────────
//  thumb:ready 事件集成
//  当缩略图生成完毕，自动清除缓存让下次请求拿到最新路径
// ─────────────────────────────────────────────────────────

onThumbReady((photoId, size) => {
  invalidateThumbnail(photoId, size as ThumbSize)
})
