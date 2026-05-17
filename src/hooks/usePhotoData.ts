/**
 * @file src/hooks/usePhotoData.ts
 * @description 纯数据层 Hook — 只知道 PhotoFilter，不感知视图类型
 *
 * 职责：
 *   - 接收 PhotoFilter 参数
 *   - 管理 TanStack Query useInfiniteQuery
 *   - 将分页结果同步到 photoStore（始终用 setPhotos 全量同步，避免竞态）
 *   - 暴露 fetchMore / hasMore / isLoading
 *
 * 不做的事：
 *   - 不读取 viewState / layoutStore
 *   - 不重置 selectionStore
 *   - 不处理视图切换逻辑
 */

import { useEffect, useMemo } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { api } from '@/services/tauriIpc'
import { usePhotoStore } from '@/stores/photoStore'
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
  const setPhotos   = usePhotoStore((s) => s.setPhotos)
  const setFetching = usePhotoStore((s) => s.setIsFetchingMore)

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

  // 同步到 photoStore — 始终用 setPhotos 全量同步（竞态修复保留）
  useEffect(() => {
    if (!data) return
    const allPhotos = data.pages.flatMap((p) => p.items)
    const total     = data.pages[0]?.total ?? 0
    setPhotos(allPhotos, total)
  }, [data, setPhotos])

  // isFetchingMore 状态同步
  useEffect(() => {
    setFetching(isFetchingNextPage)
  }, [isFetchingNextPage, setFetching])

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