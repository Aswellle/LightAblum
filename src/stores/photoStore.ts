/**
 * @file src/stores/photoStore.ts
 * @description 照片数据状态管理
 *
 * Round-3 修复（F-04）：appendPhotos 从 O(N_total) 降至 O(N_page)
 *
 * 问题根因：
 *   原 appendPhotos 将 newPhotos 追加到 s.photos 后，对整个合并数组调用
 *   groupPhotosByMonth()，该函数遍历全部照片并重建 Map + 排序。
 *   第 k 页加载时 photos 数组已有 k×100 条，groupPhotosByMonth 耗时 O(k×100)，
 *   100K 照片共 1000 页，总计算量 O(N²/2) ≈ 50M 次操作，产生明显主线程卡顿。
 *
 * 修复方案：
 *   在 store 内部维护 groupMap: Map<string, PhotoGroup>（按 YYYY-MM 键索引）。
 *   appendPhotos 时只遍历 newPhotos（O(pageSize)）：
 *     - 命中已有月份 key → 仅将新照片 push 进该 group
 *     - 发现新月份 key  → 新建 group，标记 keysChanged = true
 *   仅当 keysChanged 时才对 groupMap.keys() 做一次排序（O(M log M)，M = 月份数，最多数十）。
 *   否则直接对受影响的 group 做引用更新，O(1) 重建 groups 数组切片。
 *
 *   总复杂度：O(pageSize) + O(M log M) per append，M ≪ N。
 *
 * 相关联修复（F-17，见 usePhotoQuery.ts）：
 *   usePhotoQuery 改为总调用 setPhotos，移除 appendPhotos 调用；
 *   appendPhotos 保留供未来其他消费方使用，并已经过 O(N_page) 优化。
 */

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { PhotoThumb, PhotoGroup } from '@/types/photo'

// ─────────────────────────────────────────────────────────
//  内部工具：分组键 & 标签构造
//  从 groupPhotosByMonth 提炼为独立函数，供 setPhotos / appendPhotos 复用
// ─────────────────────────────────────────────────────────

/** 从 ISO 时间戳计算月份分组键 'YYYY-MM' */
function photoGroupKey(createdAt: string): string {
  const d = new Date(createdAt)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** 从分组键生成展示标签 '2025年3月' */
function buildGroupLabel(key: string): string {
  const [year, month] = key.split('-')
  const d = new Date(Number(year), Number(month) - 1)
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' })
}

/**
 * 将 groupMap 转换为按时间倒序排列的 PhotoGroup 数组
 * 最多执行 O(M log M)，M = 不同月份数，通常 < 100
 */
function groupMapToSortedArray(map: Map<string, PhotoGroup>): PhotoGroup[] {
  return Array.from(map.entries())
    .sort(([a], [b]) => b.localeCompare(a))   // 倒序：最新在前
    .map(([, group]) => group)
}

/**
 * 从零构建 groupMap（用于 setPhotos 全量重建）
 * O(N) 一次遍历，必要时调用。
 */
function buildGroupMap(photos: PhotoThumb[]): Map<string, PhotoGroup> {
  const map = new Map<string, PhotoGroup>()
  for (const photo of photos) {
    const key = photoGroupKey(photo.createdAt)
    const existing = map.get(key)
    if (existing) {
      existing.photos.push(photo)
    } else {
      map.set(key, {
        key,
        label:  buildGroupLabel(key),
        photos: [photo],
      })
    }
  }
  return map
}

// ─────────────────────────────────────────────────────────
//  Store 接口
// ─────────────────────────────────────────────────────────

interface PhotoStore {
  // ── 公开状态 ──

  /** 按加载顺序排列的扁平照片列表（虚拟网格遍历用） */
  photos: PhotoThumb[]

  /** 按月份分组后的有序结构（DateGroup 标题渲染用） */
  groups: PhotoGroup[]

  /** 当前加载的总照片数（来自 API total 字段，含未加载页） */
  total: number

  /** 是否正在加载下一页（节流滚动触发用） */
  isFetchingMore: boolean

  // ── 内部状态（不对外暴露，供增量合并使用）──
  /** groupMap 是 groups 的索引形式，避免每次 append 时重建 Map */
  _groupMap: Map<string, PhotoGroup>

  // ── 写操作 ──

  /**
   * 首次加载/切换视图/筛选条件变更时全量替换
   * O(N) 单次遍历重建 groupMap + 排序
   */
  setPhotos: (photos: PhotoThumb[], total: number) => void

  /**
   * 加载更多页时追加（增量更新，F-04 核心修复）
   * O(pageSize) + O(M log M)，M = 月份数
   * 仅在发现新月份分组时才重新排序 groups 数组
   */
  appendPhotos: (newPhotos: PhotoThumb[]) => void

  /** 更新单张照片（收藏/取消收藏等局部变更） */
  updatePhoto: (id: string, patch: Partial<PhotoThumb>) => void

  /** 从列表中移除照片（软删除后刷新用） */
  removePhotos: (ids: string[]) => void

  setIsFetchingMore: (v: boolean) => void

  /** 切换视图时清空，防止旧数据闪烁 */
  reset: () => void
}

// ─────────────────────────────────────────────────────────
//  创建 Store
// ─────────────────────────────────────────────────────────

export const usePhotoStore = create<PhotoStore>()(
  subscribeWithSelector((set, _get) => ({
    photos:         [],
    groups:         [],
    total:          0,
    isFetchingMore: false,
    _groupMap:      new Map(),

    // ── setPhotos：全量重建（O(N)，视图切换 / 筛选变更时调用）──
    setPhotos: (photos, total) => {
      const groupMap = buildGroupMap(photos)
      set({
        photos,
        _groupMap: groupMap,
        groups:    groupMapToSortedArray(groupMap),
        total,
      })
    },

    // ── appendPhotos：增量合并（O(pageSize)，滚动翻页时调用）──
    appendPhotos: (newPhotos) => {
      if (newPhotos.length === 0) return

      set((s) => {
        // 1. 平铺列表直接追加
        const photos = [...s.photos, ...newPhotos]

        // 2. 复制现有 groupMap（浅拷贝 Map 引用，O(M)）
        const groupMap = new Map(s._groupMap)
        let keysChanged = false

        // 3. 仅遍历新照片（O(pageSize)）
        for (const photo of newPhotos) {
          const key      = photoGroupKey(photo.createdAt)
          const existing = groupMap.get(key)

          if (existing) {
            // 已有该月份分组：追加照片，更新 group 引用（保持 immutability）
            groupMap.set(key, {
              ...existing,
              photos: [...existing.photos, photo],
            })
          } else {
            // 新月份分组：创建，并标记需要重新排序
            groupMap.set(key, {
              key,
              label:  buildGroupLabel(key),
              photos: [photo],
            })
            keysChanged = true
          }
        }

        // 4. 重建 groups 数组
        //    - 有新月份键 → 重新排序全部 groups（O(M log M)，M 很小）
        //    - 仅已有月份追加 → 从原 groups 更新受影响项（O(1) per page）
        const groups = keysChanged
          ? groupMapToSortedArray(groupMap)
          : s.groups.map((g) => groupMap.get(g.key) ?? g)

        return { photos, _groupMap: groupMap, groups }
      })
    },

    // ── updatePhoto：局部字段更新，不影响分组结构 ──
    updatePhoto: (id, patch) => {
      set((s) => ({
        photos: s.photos.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        // 收藏/评分变化不影响分组键，_groupMap 和 groups 保持不变
      }))
    },

    // ── removePhotos：从列表和分组中移除，增量更新 ──
    removePhotos: (ids) => {
      const idSet = new Set(ids)
      set((s) => {
        const photos   = s.photos.filter((p) => !idSet.has(p.id))
        // 重建 groupMap（移除涉及多个 group，全量重建比逐项删除更简单）
        const groupMap = buildGroupMap(photos)
        return {
          photos,
          _groupMap: groupMap,
          groups:    groupMapToSortedArray(groupMap),
          total:     Math.max(0, s.total - ids.length),
        }
      })
    },

    setIsFetchingMore: (isFetchingMore) => set({ isFetchingMore }),

    reset: () => set({
      photos:         [],
      groups:         [],
      _groupMap:      new Map(),
      total:          0,
      isFetchingMore: false,
    }),
  })),
)

// ─────────────────────────────────────────────────────────
//  选择器（避免组件订阅整个 store 导致不必要重渲染）
// ─────────────────────────────────────────────────────────

export const selectPhotos    = (s: PhotoStore) => s.photos
export const selectGroups    = (s: PhotoStore) => s.groups
export const selectTotal     = (s: PhotoStore) => s.total
export const selectPhotoById = (id: string) => (s: PhotoStore) =>
  s.photos.find((p) => p.id === id) ?? null
