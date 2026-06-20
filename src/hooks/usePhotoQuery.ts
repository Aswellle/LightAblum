/**
 * @file src/hooks/usePhotoQuery.ts
 * @description 协调层 Hook — 视图感知、状态协调，委托数据获取给 usePhotoData
 *
 * 职责：
 *   - 从 layoutStore 读取 viewState
 *   - 调用 viewStateToFilter() 构建 PhotoFilter
 *   - 视图切换时清空 photoStore 和 selectionStore
 *   - 将协调后的 filter 传给 usePhotoData
 *
 * 不做的事：
 *   - 不直接调用 api.*
 *   - 不管理 TanStack Query 状态
 *   - 不写入 photoStore（由 usePhotoData 负责）
 */

import { useContext, useEffect, useMemo, useRef } from 'react'
import { useUiStore, selectCurrentView } from '@/stores/uiStore'
import { useLayoutStore, selectSortBy, selectSortAsc } from '@/stores/layoutStore'
import { usePhotoStore } from '@/stores/photoStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { viewStateToFilter } from '@/types/layout'
import { usePhotoData, type UsePhotoDataResult } from './usePhotoData'
import { AlbumContext } from '@/components/album/AlbumView'
import type { PhotoFilter } from '@/types/ipc'

export type { UsePhotoDataResult as UsePhotoQueryResult }

export function usePhotoQuery(): UsePhotoDataResult {
  const currentView    = useUiStore(selectCurrentView)
  const sortBy         = useLayoutStore(selectSortBy)
  const sortAsc        = useLayoutStore(selectSortAsc)
  const setPhotos      = usePhotoStore((s) => s.setPhotos)
  const resetSelection = useSelectionStore((s) => s.reset)
  // SEC-H3: read session token from AlbumContext (set by PrivateAlbumView on unlock)
  const { sessionToken } = useContext(AlbumContext)

  // 判断是否为 tag 搜索视图（由 useTagPhotoQuery 负责写入 photoStore）
  const isTagSearch =
    currentView.type === 'search' &&
    'query' in currentView &&
    typeof currentView.query === 'string' &&
    currentView.query.startsWith('#')

  // 构建 filter：视图特定字段（base）优先级高于 layoutStore 默认排序
  // SEC-H3: include sessionToken so backend can authorize private album access
  const filter = useMemo((): PhotoFilter => {
    if (isTagSearch) return { isDeleted: false }
    const base = viewStateToFilter(currentView)
    return {
      sortBy,
      sortAsc,
      ...base,
      ...(sessionToken != null ? { sessionToken } : {}),
    }
  }, [currentView, sortBy, sortAsc, isTagSearch, sessionToken])

  // 视图切换时清空状态（防止旧数据残留）
  const prevFilterRef = useRef<string>('')
  useEffect(() => {
    if (isTagSearch) return
    const curr = JSON.stringify(filter)
    if (prevFilterRef.current !== curr) {
      prevFilterRef.current = curr
      setPhotos([], 0)
      resetSelection()
    }
  }, [isTagSearch, filter, setPhotos, resetSelection])

  return usePhotoData(filter)
}