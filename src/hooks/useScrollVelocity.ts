/**
 * @file src/hooks/useScrollVelocity.ts
 * @description 滚动速度检测 Hook
 *
 * 作用：
 *   测量滚动容器的实时速度（px/s），供虚拟网格引擎动态调整
 *   缩略图加载策略：
 *     - 速度 < 1000 px/s  → 正常加载（high/normal 优先级）
 *     - 速度 1000~3000    → 仅加载视口中心项（节约 IPC）
 *     - 速度 > 3000 px/s  → 暂停 overscan 预取，等滚动停止
 *
 * 输出：
 *   velocity   - 当前速度 ref（不触发 re-render，由渲染循环读取）
 *   isSlowing  - 是否即将停止（用于 200ms 后升级缩略图质量）
 *   onScroll   - 绑定到滚动容器的事件处理器
 *
 * 停止检测：
 *   停止滚动后 200ms（PRD §4.1 M-3 规格），isSlowing 变为 true，
 *   通知 VirtualGrid 将当前视口缩略图从 's' 升级到 'm' 尺寸。
 */

import { useRef, useCallback, useEffect, useState } from 'react'

/** 停止后延迟升级质量的时间 (ms)，对应 PRD 中的 200ms */
const QUALITY_DELAY_MS = 200
/** EMA 平滑系数（0.2 = 强平滑，避免抖动） */
const EMA_ALPHA = 0.2

export interface ScrollVelocityResult {
  /** 当前 EMA 平滑后的滚动速度 (px/s)，ref 不触发重渲染 */
  velocity:  React.MutableRefObject<number>
  /** true = 滚动已停止，可以加载高分辨率缩略图 */
  isStopped: boolean
  /** 绑定到滚动容器的 onScroll 处理器 */
  onScroll:  (e: React.UIEvent<HTMLElement>) => void
  /** 当前是否处于快速滚动（速度 > 3000px/s）*/
  isFast:    boolean
}

export function useScrollVelocity(): ScrollVelocityResult {
  const lastScrollTopRef = useRef(0)
  const lastTimeRef      = useRef(performance.now())
  const velocityRef      = useRef(0)
  const stopTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [isStopped, setIsStopped] = useState(true)
  const [isFast,    setIsFast]    = useState(false)

  const onScroll = useCallback((e: React.UIEvent<HTMLElement>) => {
    const now       = performance.now()
    const dt        = Math.max(1, now - lastTimeRef.current)
    const scrollTop = e.currentTarget.scrollTop
    const dy        = Math.abs(scrollTop - lastScrollTopRef.current)
    const rawSpeed  = (dy / dt) * 1000   // px/s

    // EMA 平滑
    velocityRef.current = EMA_ALPHA * rawSpeed + (1 - EMA_ALPHA) * velocityRef.current

    lastScrollTopRef.current = scrollTop
    lastTimeRef.current      = now

    // 速度状态
    const fast = velocityRef.current > 3000
    setIsFast((prev) => prev !== fast ? fast : prev)   // 避免无意义 re-render
    setIsStopped(false)

    // 重置停止计时器
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current)
    stopTimerRef.current = setTimeout(() => {
      velocityRef.current = 0
      setIsStopped(true)
      setIsFast(false)
    }, QUALITY_DELAY_MS)
  }, [])

  // 清理
  useEffect(() => {
    return () => {
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current)
    }
  }, [])

  return { velocity: velocityRef, isStopped, isFast, onScroll }
}
