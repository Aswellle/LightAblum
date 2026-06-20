/**
 * @file src/hooks/usePhotoData.ts
 * @description 纯数据层 Hook — 只知道 PhotoFilter，不感知视图类型
 *
 * 职责：
 *   - 接收 PhotoFilter 参数
 *   - 管理 TanStack Query useInfiniteQuery
 *   - 将分页结果同步到 photoStore
 *   - 暴露 fetchMore / hasMore / isLoading
 *
 * 不做的事：
 *   - 不读取 viewState / layoutStore
 *   - 不重置 selectionStore
 *   - 不处理视图切换逻辑
 *
 * PERF-C1 修复：
 *   原实现每次 pages 变化时调用 setPhotos(data.pages.flatMap(p => p.items), total)，
 *   即将所有已加载页全量平铺后重建 groupMap。第 k 页加载时 flatMap 的结果有 k×100 条，
 *   总工作量 O(N²/2)，100K 张照片下明显卡顿。
 *   修复：用 prevPageCountRef 跟踪已同步的页数：
 *     - 第 1 页 / 缓存重置 → setPhotos（全量重建，O(N_page1)）
 *     - 第 k+1 页 → appendPhotos(newPage.items)（增量，O(pageSize)）
 */

import { useContext, useEffect, useRef, useMemo, startTransition } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { api } from '@/services/tauriIpc'
import { usePhotoStore } from '@/stores/photoStore'
import { AlbumContext } from '@/components/album/AlbumView'
import { isIpcError } from '@/types/ipc'
import type { PhotoFilter } from '@/types/ipc'

const PAGE_SIZE = 100

export interface UsePhotoDataResult {
  isLoading:      boolean
  isFetchingMore: boolean
  hasMore:        boolean
  totalCount:     number
  loadMore:       () => void
  error:          Error | null
}

export function usePhotoData(filter: PhotoFilter): UsePhotoDataResult {
  const setPhotos    = usePhotoStore((s) => s.setPhotos)
  const appendPhotos = usePhotoStore((s) => s.appendPhotos)
  const setFetching  = usePhotoStore((s) => s.setIsFetchingMore)
  // SEC-H3: re-lock private album when backend rejects the session token
  const { onTokenExpired } = useContext(AlbumContext)

  // PERF-C1: number of pages already synced to photoStore
  const prevPageCountRef = useRef(0)

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    error,
  } = useInfiniteQuery({
    queryKey: ['photos', filter] as const,
    queryFn: ({ pageParam, queryKey }) => {
      const qFilter = queryKey[1] as PhotoFilter
      return api.photos.list(qFilter, pageParam as string | undefined, PAGE_SIZE)
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined as string | undefined,
    staleTime: Infinity,
    gcTime:    10 * 60 * 1000,
  })

  // CQ-M5: single effect for all store syncs — prevents split-frame where one update
  //        lands before the other (e.g. isFetchingMore flips but photos not yet updated)
  // PERF-C1: append-only for page 2+ instead of O(N_total) flatMap on every page load
  // BP-M3: startTransition — grid re-renders are non-urgent, keeps input responsive
  useEffect(() => {
    if (!data) {
      prevPageCountRef.current = 0
      return
    }

    const currentPageCount = data.pages.length
    const total            = data.pages[0]?.total ?? 0

    startTransition(() => {
      if (currentPageCount === 1 || prevPageCountRef.current === 0) {
        // First page of a new query or after a cache reset — full rebuild
        setPhotos(data.pages[0].items, total)
      } else if (currentPageCount > prevPageCountRef.current) {
        // New pages appended — only sync the delta (O(pageSize) per page)
        const newPages = data.pages.slice(prevPageCountRef.current)
        newPages.forEach((page) => appendPhotos(page.items))
      }

      prevPageCountRef.current = currentPageCount
      setFetching(isFetchingNextPage)
    })
  }, [data, isFetchingNextPage, setPhotos, appendPhotos, setFetching])

  // SEC-H3: when the backend rejects the session token, trigger re-lock on the private album
  useEffect(() => {
    if (error && isIpcError(error) && (error as { code?: string }).code === 'TOKEN_REQUIRED') {
      onTokenExpired()
    }
  }, [error, onTokenExpired])

  const loadMore = useMemo(
    () => () => { if (hasNextPage && !isFetchingNextPage) fetchNextPage() },
    [hasNextPage, isFetchingNextPage, fetchNextPage],
  )

  return {
    isLoading,
    isFetchingMore: isFetchingNextPage,
    hasMore:        hasNextPage ?? false,
    totalCount:     data?.pages[0]?.total ?? 0,
    loadMore,
    error:          error as Error | null,
  }
}
