/**
 * @file src/hooks/useThumbnail.ts
 * @description 缩略图加载 Hook 集合
 *
 * 提供三个 Hook，按使用场景选择：
 *
 *   useThumbnail(photoId, size, priority)
 *     → 单张缩略图，基于 TanStack Query 缓存
 *     → 返回 { url, isLoading, isReady, isNotGenerated }
 *     → 适用于 GridItem、Filmstrip 等需要缩略图 URL 的场景
 *
 *   useThumbnailWithFallback(photoId, preferSize)
 *     → 尝试大尺寸，失败自动降级到小尺寸
 *     → 适用于大图预览模式（先显示 medium，异步加载 large）
 *
 *   usePreloadThumbnails(photoIds, size, priority)
 *     → 批量预加载，不返回 URL（纯副作用）
 *     → 由 VirtualGrid 在 overscan 区域提前预取
 *
 * 与 thumbnailLoader 的关系：
 *   - thumbnailLoader 是纯函数模块，处理队列/缓存/IPC
 *   - 本文件将其包装为 React 生命周期友好的 Hook
 *   - TanStack Query 负责去重、缓存和状态管理
 *
 * 骨架屏策略：
 *   1. isNotGenerated = true  → 渲染骨架屏动画（shimmer）
 *   2. isLoading = true       → 渲染骨架屏（IPC 进行中）
 *   3. url 存在               → <img src={url}> + 150ms fade-in
 */

import {
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import { useEffect, useRef, useCallback } from 'react'
import {
  loadThumbnail,
  preloadThumbnails,
  isThumbNotReady,
  type ThumbPriority,
} from '@/services/thumbnailLoader'
import type { ThumbSize } from '@/types/ipc'

// ─────────────────────────────────────────────────────────
//  Query Key 工厂（保持与 eventBus 中 invalidateQueries 一致）
// ─────────────────────────────────────────────────────────

export const thumbQueryKey = (photoId: string, size: ThumbSize) =>
  ['thumb', photoId, size] as const

// ─────────────────────────────────────────────────────────
//  核心类型
// ─────────────────────────────────────────────────────────

export interface ThumbnailState {
  /** 可直接用于 <img src> 的 asset:// URL，未就绪时为 undefined */
  url: string | undefined

  /** true = IPC 请求进行中（显示骨架屏） */
  isLoading: boolean

  /**
   * true = 缩略图已在磁盘上生成完毕，URL 可用
   * false = 尚未生成（等待 thumb:ready 事件）或加载中
   */
  isReady: boolean

  /**
   * true = 后端确认缩略图尚未生成（ThumbNotReadyError）
   * 此时应渲染骨架屏并等待 thumb:ready 事件后自动重试
   */
  isNotGenerated: boolean

  /** 原始 TanStack Query 结果（用于高级场景） */
  query: UseQueryResult<string>
}

// ─────────────────────────────────────────────────────────
//  useThumbnail — 主 Hook
// ─────────────────────────────────────────────────────────

/**
 * 加载单张缩略图
 *
 * @param photoId   照片 UUID（空字符串时禁用查询）
 * @param size      缩略图尺寸，默认 's'（200×200）
 * @param priority  加载优先级，默认 'normal'
 *
 * @example
 * function GridItem({ photo }: { photo: PhotoThumb }) {
 *   const { url, isReady, isNotGenerated } = useThumbnail(photo.id, 's', 'high')
 *
 *   if (!isReady) return <SkeletonCell />
 *   return <img src={url} className="la-grid-img la-fade-in" />
 * }
 */
export function useThumbnail(
  photoId:  string,
  size:     ThumbSize    = 's',
  priority: ThumbPriority = 'normal',
): ThumbnailState {
  const query = useQuery<string>({
    queryKey: thumbQueryKey(photoId, size),
    queryFn:  () => loadThumbnail(photoId, size, priority),

    enabled:   Boolean(photoId),
    staleTime: Infinity,           // 本地文件路径永不过期（由 eventBus 手动 invalidate）
    gcTime:    30 * 60 * 1000,     // 30 分钟无访问后 GC

    // ThumbNotReadyError 不应被视为"错误"态（不重试，等 thumb:ready 事件）
    retry: (failureCount, error) => {
      if (isThumbNotReady(error)) return false
      return failureCount < 2
    },

    // 缩略图未生成时抛出 ThumbNotReadyError，不在控制台打印错误
    throwOnError: false,
  })

  const isNotGenerated =
    query.isError && isThumbNotReady(query.error)

  return {
    url:            query.data,
    isLoading:      query.isLoading || query.isFetching,
    isReady:        query.isSuccess && Boolean(query.data),
    isNotGenerated,
    query,
  }
}

// ─────────────────────────────────────────────────────────
//  useThumbnailWithFallback — 大图预览渐进加载
// ─────────────────────────────────────────────────────────

export interface ThumbnailWithFallbackState {
  /** 当前最佳可用 URL（medium → large → original 渐进替换） */
  url:           string | undefined
  /** 当前 URL 对应的尺寸 */
  currentSize:   ThumbSize | 'original' | null
  /** large 尺寸是否已加载完成 */
  isLargeReady:  boolean
  /** 还在等待任何尺寸的加载 */
  isLoading:     boolean
}

/**
 * 渐进式缩略图加载（大图预览模式专用）
 *
 * 策略：
 *   1. 立即返回已缓存的 medium（来自网格预加载），作为飞入动画期间的占位
 *   2. 并行请求 large（1600px），加载完成后替换（200ms fade-in）
 *
 * @param photoId     照片 UUID
 * @param initialSize 首选初始尺寸（通常 'm'，进入预览前网格已加载）
 *
 * @example
 * function PreviewImage({ photoId }: { photoId: string }) {
 *   const { url, isLargeReady } = useThumbnailWithFallback(photoId, 'm')
 *   return <img src={url} style={{ opacity: isLargeReady ? 1 : 0.9 }} />
 * }
 */
export function useThumbnailWithFallback(
  photoId:     string,
  initialSize: ThumbSize = 'm',
): ThumbnailWithFallbackState {
  // 初始尺寸（通常已缓存，立即可用）
  const medium = useThumbnail(photoId, initialSize, 'high')

  // 大尺寸（并行请求）
  const large  = useThumbnail(photoId, 'l', 'high')

  const url         = large.url ?? medium.url
  const currentSize: ThumbSize | null =
    large.isReady  ? 'l' :
    medium.isReady ? initialSize :
    null

  return {
    url,
    currentSize,
    isLargeReady: large.isReady,
    isLoading:    !medium.isReady && !large.isReady,
  }
}

// ─────────────────────────────────────────────────────────
//  usePreloadThumbnails — 批量预取（VirtualGrid overscan 用）
// ─────────────────────────────────────────────────────────

/**
 * 在 overscan 区域批量预加载缩略图（不返回 URL，纯副作用）
 *
 * 设计考量：
 *   - 仅在 photoIds 或 size 变化时触发，使用 ref 避免重复预取
 *   - 使用 'low' 优先级，不抢占视口内的 'high'/'normal' 请求
 *   - 配合 useScrollVelocity：速度 > 3000px/s 时跳过预取（快速滚动时节约资源）
 *
 * @param photoIds    要预加载的照片 ID 列表（应为稳定引用，建议 useMemo）
 * @param size        缩略图尺寸
 * @param skip        true 时跳过预取（快速滚动时传入）
 *
 * @example
 * // 在 VirtualGrid 中：
 * const overscanIds = useMemo(() =>
 *   photos.slice(overscanStart, overscanEnd).map(p => p.id),
 *   [photos, overscanStart, overscanEnd]
 * )
 * usePreloadThumbnails(overscanIds, 's', velocity.current > 3000)
 */
export function usePreloadThumbnails(
  photoIds: string[],
  size:     ThumbSize = 's',
  skip = false,
): void {
  const lastIdsRef = useRef<string>('')

  useEffect(() => {
    if (skip || photoIds.length === 0) return

    // 用逗号拼接字符串作为简单的"列表是否变化"检查
    const key = photoIds.join(',')
    if (key === lastIdsRef.current) return
    lastIdsRef.current = key

    preloadThumbnails(
      photoIds.map((id) => ({ photoId: id, size })),
      'low',
    )
  }, [photoIds, size, skip])
}

// ─────────────────────────────────────────────────────────
//  useInvalidateThumbnail — 手动失效（收藏/更新后刷新）
// ─────────────────────────────────────────────────────────

/**
 * 返回手动失效缩略图缓存的函数
 * 通常不需要调用，eventBus 会在 thumb:ready 时自动失效
 * 手动用途：用户旋转/编辑照片后立即刷新
 */
export function useInvalidateThumbnail() {
  const queryClient = useQueryClient()

  return useCallback(
    (photoId: string, size?: ThumbSize) => {
      if (size) {
        queryClient.invalidateQueries({
          queryKey: thumbQueryKey(photoId, size),
          exact: true,
        })
      } else {
        // 失效该照片所有尺寸
        queryClient.invalidateQueries({
          queryKey: ['thumb', photoId],
        })
      }
    },
    [queryClient],
  )
}
