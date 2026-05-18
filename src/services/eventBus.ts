/**
 * @file src/services/eventBus.ts
 * @description Tauri 后端事件总线
 *
 * 职责：
 *   订阅 Rust 后端通过 app.emit() 推送的所有实时事件，
 *   将事件 payload 分发到对应的 Zustand store 和 TanStack Query。
 *
 * 事件清单（来自 DB_API_Design §7）：
 *   scan:started       → uiStore.setIsScanning(true)
 *   scan:progress      → uiStore.setScanProgress()
 *   scan:completed     → uiStore.setIsScanning(false) + reset photos cache
 *   scan:error         → toast.warning()
 *   thumb:ready        → photoStore.updatePhoto() + invalidate thumb query
 *   thumb:batch_done   → uiStore 更新缩略图生成进度
 *   library:changed    → reset photos cache（兼容数字和路径数组两种 payload）
 *   photo:updated      → photoStore.updatePhoto()
 *   album:updated      → invalidate albums
 *
 * 使用方式：
 *   在 App 根级调用一次 useEventBus()，组件卸载时自动清理所有监听。
 *
 * 设计原则：
 *   - 所有 store 操作必须幂等（事件可能重复推送）
 *   - 事件处理不做网络请求，仅更新本地状态或令 Query 缓存失效
 *   - 捕获所有异常，避免单个事件处理失败中断其他监听
 *
 * Bugfix 说明：
 *   1. scan:completed：改用 resetQueries 替代 invalidateQueries。
 *      原因：invalidateQueries 将缓存标记为 stale 后触发 refetch，但在
 *      TanStack Query v5 + staleTime:Infinity 的组合下，refetch 的实际
 *      执行时机依赖内部调度，存在未触发的概率。resetQueries 会清除缓存
 *      并立即重新请求，行为确定且不受 staleTime 影响。
 *
 *   2. library:changed：Rust scan.rs 发送的 payload 格式为数字
 *      （added: u64，修正前为 number 类型），而 watcher 事件发送路径数组
 *      （added: string[]）。两种格式并存，前端用 Array.isArray() 做兼容。
 *      原来直接用 TypeScript 类型 `{ added, modified, removed }` 解构后
 *      调用 added.length，当 added 是数字时抛 TypeError，虽被 try-catch
 *      吞掉不崩溃，但导致后续 resetQueries 不执行，照片列表不刷新。
 */

import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { TauriEventMap } from '@/types/ipc'
import { useUiStore, toast } from '@/stores/uiStore'

// ─────────────────────────────────────────────────────────
//  类型安全的 listen 封装
// ─────────────────────────────────────────────────────────

/**
 * 类型安全的 Tauri 事件监听器
 * 根据 TauriEventMap 推导 payload 类型，无需手动标注泛型
 */
function listenTyped<K extends keyof TauriEventMap>(
  event: K,
  handler: (payload: TauriEventMap[K]) => void,
): Promise<UnlistenFn> {
  return listen<TauriEventMap[K]>(event, (e) => {
    try {
      handler(e.payload)
    } catch (err) {
      console.error(`[EventBus] Error handling event '${event}':`, err)
    }
  })
}

// ─────────────────────────────────────────────────────────
//  主 Hook：在 App 根组件挂载一次
// ─────────────────────────────────────────────────────────

/**
 * 订阅所有 Tauri 后端事件
 * 必须在 QueryClientProvider 内部使用（需要 useQueryClient）
 *
 * @example
 * // App.tsx
 * function AppContent() {
 *   useEventBus()
 *   return <AppShell />
 * }
 */
export function useEventBus(): void {
  const queryClient     = useQueryClient()
  const setScanProgress = useUiStore((s) => s.setScanProgress)
  const setIsScanning   = useUiStore((s) => s.setIsScanning)

  // 用 ref 保存 unlisten 函数列表，避免 effect 依赖数组过长
  const unlistenRef = useRef<Array<Promise<UnlistenFn>>>([])

  useEffect(() => {
    const listeners = unlistenRef.current

    // ── scan:started ──────────────────────────────────────
    listeners.push(
      listenTyped('scan:started', ({ folder, taskId }) => {
        setIsScanning(true)
        console.info(`[Scan] Started: ${folder} (task: ${taskId})`)
      }),
    )

    // ── scan:progress ─────────────────────────────────────
    listeners.push(
      listenTyped('scan:progress', (progress) => {
        setScanProgress(progress)
      }),
    )

    // ── scan:completed ────────────────────────────────────
    // Bugfix: resetQueries 清除缓存并立即重新请求，
    // 不受 staleTime:Infinity 影响，确保扫描完成后照片列表必然刷新。
    listeners.push(
      listenTyped('scan:completed', ({ folder, totalNew, totalUpdated, durationMs }) => {
        setScanProgress(null)
        setIsScanning(false)

        // 强制清除照片缓存并立即重新拉取（比 invalidateQueries 更确定）
        queryClient.resetQueries({ queryKey: ['photos'] })
        queryClient.resetQueries({ queryKey: ['search', 'stats'] })

        // 刷新文件夹列表（扫描会更新 watched_folders.photo_count）
        queryClient.invalidateQueries({ queryKey: ['folders'] })

        // 完成提示
        const sec = (durationMs / 1000).toFixed(1)
        if (totalNew > 0 || totalUpdated > 0) {
          toast.success(
            `扫描完成：新增 ${totalNew} 张，更新 ${totalUpdated} 张（用时 ${sec}s）`,
          )
        }

        console.info(`[Scan] Completed: ${folder} — new=${totalNew} updated=${totalUpdated}`)
      }),
    )

    // ── scan:error ────────────────────────────────────────
    listeners.push(
      listenTyped('scan:error', ({ path, error }) => {
        console.warn(`[Scan] Error on ${path}:`, error)
        // 扫描错误不弹 Toast（可能有大量文件权限错误），
        // 只在状态栏 errors 计数中体现
      }),
    )

    // ── thumb:ready ───────────────────────────────────────
    listeners.push(
      listenTyped('thumb:ready', ({ photoId, size }) => {
        // 1. 令 TanStack Query 重取该照片的缩略图路径
        queryClient.invalidateQueries({
          queryKey: ['thumb', photoId, size],
          exact:    true,
        })

        // 2. 通知 thumbnailLoader 清除该条的"请求中"状态，触发重加载
        //    （由 thumbnailLoader.ts 内部订阅 EventBus 处理，见该文件）
        thumbReadyCallbacks.forEach((cb) => cb(photoId, size))
      }),
    )

    // ── thumb:batch_done ──────────────────────────────────
    listeners.push(
      listenTyped('thumb:batch_done', ({ count, remaining }) => {
        console.debug(`[Thumb] Batch done: ${count} done, ${remaining} remaining`)
        // 批量完成时，若当前视图存在等待中的缩略图，整体刷新
        if (remaining === 0) {
          queryClient.invalidateQueries({ queryKey: ['photos'] })
        }
      }),
    )

    // ── library:changed ───────────────────────────────────
    // Rust scan.rs 和 watcher 均已统一为 string[] 格式（LibraryChangedPayload）
    listeners.push(
      listenTyped('library:changed', (payload) => {
        const { added, modified, removed } = payload

        console.info(
          `[Library] Changed — added:${added.length} modified:${modified.length} removed:${removed.length}`,
        )

        // 强制刷新照片列表
        queryClient.resetQueries({ queryKey: ['photos'] })
        // Fix: also refresh stats so sidebar counts update (all_photos, favorites)
        queryClient.invalidateQueries({ queryKey: ['stats'] })

        if (removed.length > 0) {
          // 有文件被删除：日志记录，DB 已标记 missing，待后端处理
          console.warn(`[Library] ${removed.length} files removed from disk`)
        }
      }),
    )

    // ── photo:updated ─────────────────────────────────────
    listeners.push(
      listenTyped('photo:updated', ({ photoId, fields }) => {
        // 局部字段更新（收藏、评分等）：不需要整体 reset
        console.debug(`[Photo] Updated: ${photoId} fields=[${fields.join(',')}]`)

        queryClient.invalidateQueries({
          queryKey: ['photo', photoId],
          exact:    true,
        })
      }),
    )

    // ── album:updated ─────────────────────────────────────
    listeners.push(
      listenTyped('album:updated', ({ albumId, action }) => {
        console.debug(`[Album] Updated: ${albumId} action=${action}`)

        // 相册变更：刷新相册列表和封面
        // staleTime:Infinity 下 invalidateQueries 不触发 refetch，改用 resetQueries
        queryClient.resetQueries({ queryKey: ['albums'] })
        queryClient.resetQueries({ queryKey: ['album', albumId] })
      }),
    )

    // ── 清理 ──────────────────────────────────────────────
    return () => {
      Promise.allSettled(unlistenRef.current).then((results) => {
        results.forEach((result) => {
          if (result.status === 'fulfilled') result.value()
        })
      })
      unlistenRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // 仅在挂载/卸载时执行，store 方法通过 getState() 获取最新值
}

// ─────────────────────────────────────────────────────────
//  thumb:ready 外部订阅接口
//  供 thumbnailLoader.ts 注册回调，当缩略图就绪时取消挂起请求
// ─────────────────────────────────────────────────────────

type ThumbReadyCallback = (photoId: string, size: string) => void

const thumbReadyCallbacks = new Set<ThumbReadyCallback>()

/**
 * 注册缩略图就绪回调（由 thumbnailLoader 使用）
 * @returns 取消注册函数
 */
export function onThumbReady(cb: ThumbReadyCallback): () => void {
  thumbReadyCallbacks.add(cb)
  return () => thumbReadyCallbacks.delete(cb)
}

// ─────────────────────────────────────────────────────────
//  单次调用工具（在 Hook 外部发送 Tauri 事件，测试/开发用）
// ─────────────────────────────────────────────────────────

/**
 * 在 Hook 外部（如 Zustand action 中）订阅单个 Tauri 事件
 * 返回 unlisten 函数，调用方负责在适当时机清理
 *
 * @example
 * const unlisten = await subscribeEvent('scan:progress', (p) => console.log(p))
 * // 稍后...
 * unlisten()
 */
export async function subscribeEvent<K extends keyof TauriEventMap>(
  event: K,
  handler: (payload: TauriEventMap[K]) => void,
): Promise<UnlistenFn> {
  return listenTyped(event, handler)
}
