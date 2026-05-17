/**
 * @file src/services/thumbnailCache.ts
 * @description 缩略图缓存工具导出
 *
 * 将 thumbnailLoader 中缓存相关的接口聚合到此文件，
 * 使组件导入路径更语义化：
 *
 *   import { loadThumbnail } from '@/services/thumbnailLoader'  // 加载
 *   import { clearThumbnailCache } from '@/services/thumbnailCache' // 缓存管理
 *
 * 同时提供缓存调试工具（仅开发模式使用）。
 */

export {
  loadThumbnail,
  preloadThumbnails,
  invalidateThumbnail,
  clearThumbnailCache,
  getCacheSize,
  ThumbNotReadyError,
  isThumbNotReady,
} from './thumbnailLoader'

// ─────────────────────────────────────────────────────────
//  开发模式调试工具
// ─────────────────────────────────────────────────────────

if (import.meta.env.DEV) {
  // 将缓存调试工具挂载到 window，方便在 DevTools Console 中检查
  ;(window as unknown as Record<string, unknown>).__thumbCache = {
    size:  () => import('./thumbnailLoader').then((m) => m.getCacheSize()),
    clear: () => import('./thumbnailLoader').then((m) => m.clearThumbnailCache()),
  }
}
