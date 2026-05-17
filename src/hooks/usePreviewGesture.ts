/**
 * @file src/hooks/usePreviewGesture.ts
 * @description 大图预览手势处理 Hook
 *
 * 支持的手势（PRD §4.1 M-4）：
 *   鼠标滚轮缩放    Ctrl+滚轮 or 直接滚轮（图片未超出视口时）
 *   触控板双指缩放  pinch（两指分合）→ scaleRef
 *   触控板左右划    两指水平滑动 → 切换上/下一张（速度阈值）
 *   双击            Fit ↔ 100% 切换
 *   拖拽平移        放大后可拖拽移动图片
 *   滚轮切换        未缩放时滚轮上/下 = 切换上/下一张
 *
 * 输出的状态（供 PreviewImage 消费）：
 *   scale      当前缩放倍数（1.0 = Fit）
 *   offset     { x, y } 平移偏移 px（scale=1 时为 0）
 *   isFit      是否处于 Fit 模式
 *   reset()    重置到 Fit 模式
 *
 * 性能：
 *   所有变换通过 CSS transform 实现（GPU 合成层），
 *   不触发 layout/paint，保证 ≥60fps（PRD G-2）。
 *   scale/offset 存储在 ref 中，通过 setState 批量更新。
 */

import {
  useRef,
  useState,
  useCallback,
  useEffect,
  type RefObject,
} from 'react'
import { usePreviewStore } from '@/stores/previewStore'

// ─────────────────────────────────────────────────────────
//  常量
// ─────────────────────────────────────────────────────────

const MIN_SCALE        = 1.0
const MAX_SCALE        = 4.0
const WHEEL_SENSITIVITY = 0.001   // 每像素滚轮对应的缩放比例
const SWIPE_THRESHOLD  = 80       // px，触发切换的水平滑动距离
const SWIPE_VELOCITY   = 0.4      // px/ms，触发切换的最小速度

// ─────────────────────────────────────────────────────────
//  类型
// ─────────────────────────────────────────────────────────

export interface GestureState {
  scale:   number
  offset:  { x: number; y: number }
  isFit:   boolean
}

export interface UsePreviewGestureResult {
  gestureState:  GestureState
  containerRef:  RefObject<HTMLDivElement>
  /** 重置到 Fit 模式（切换照片时调用） */
  reset:         () => void
  /** 强制设置缩放（工具栏按钮用） */
  setScale:      (scale: number) => void
}

// ─────────────────────────────────────────────────────────
//  数学工具
// ─────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

/** 计算缩放后图片可移动的最大偏移量 */
function calcMaxOffset(
  containerW: number,
  containerH: number,
  imgW:       number,
  imgH:       number,
  scale:      number,
): { maxX: number; maxY: number } {
  const scaledW = imgW * scale
  const scaledH = imgH * scale
  const maxX = Math.max(0, (scaledW - containerW) / 2)
  const maxY = Math.max(0, (scaledH - containerH) / 2)
  return { maxX, maxY }
}

// ─────────────────────────────────────────────────────────
//  Hook
// ─────────────────────────────────────────────────────────

export function usePreviewGesture(
  imgNaturalSize: { width: number; height: number } | null,
): UsePreviewGestureResult {
  const containerRef = useRef<HTMLDivElement>(null)
  const next         = usePreviewStore((s) => s.next)
  const prev         = usePreviewStore((s) => s.prev)

  // ── 状态（ref 驱动 transform，setState 触发渲染）──
  const scaleRef     = useRef(1)
  const offsetRef    = useRef({ x: 0, y: 0 })
  const [state, setState] = useState<GestureState>({
    scale:  1,
    offset: { x: 0, y: 0 },
    isFit:  true,
  })

  const commit = useCallback(() => {
    setState({
      scale:  scaleRef.current,
      offset: { ...offsetRef.current },
      isFit:  scaleRef.current <= MIN_SCALE + 0.01,
    })
  }, [])

  const reset = useCallback(() => {
    scaleRef.current  = 1
    offsetRef.current = { x: 0, y: 0 }
    commit()
  }, [commit])

  const setScale = useCallback((newScale: number) => {
    scaleRef.current  = clamp(newScale, MIN_SCALE, MAX_SCALE)
    offsetRef.current = { x: 0, y: 0 }
    commit()
  }, [commit])

  // ── 处理边界：缩放后偏移可能越界 ──────────────────────
  const clampOffset = useCallback(() => {
    const container = containerRef.current
    if (!container || !imgNaturalSize) return

    // 估算 Fit 模式下图片的显示尺寸
    const cw = container.clientWidth
    const ch = container.clientHeight
    const { width: nw, height: nh } = imgNaturalSize
    const fitScale = Math.min(cw / nw, ch / nh)
    const displayW = nw * fitScale
    const displayH = nh * fitScale

    const { maxX, maxY } = calcMaxOffset(cw, ch, displayW, displayH, scaleRef.current)
    offsetRef.current.x = clamp(offsetRef.current.x, -maxX, maxX)
    offsetRef.current.y = clamp(offsetRef.current.y, -maxY, maxY)
  }, [imgNaturalSize])

  // ─────────────────────────────────────────────────────
  //  Pointer 事件（拖拽平移 + 双击缩放）
  // ─────────────────────────────────────────────────────

  const isDraggingRef      = useRef(false)
  const dragStartRef       = useRef({ x: 0, y: 0 })
  const dragOffsetStartRef = useRef({ x: 0, y: 0 })
  const lastTapRef         = useRef(0)

  // 触控板双指滑动检测
  const swipeStartRef   = useRef({ x: 0, y: 0, time: 0 })
  const isTwoFingerRef  = useRef(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onPointerDown = (e: PointerEvent) => {
      // 双击检测
      const now = Date.now()
      if (now - lastTapRef.current < 300) {
        // 双击：Fit ↔ 100%
        if (scaleRef.current > MIN_SCALE + 0.01) {
          reset()
        } else {
          scaleRef.current = 2.0
          clampOffset()
          commit()
        }
        lastTapRef.current = 0
        return
      }
      lastTapRef.current = now

      if (scaleRef.current <= MIN_SCALE + 0.01) return  // Fit 模式不拖拽

      isDraggingRef.current      = true
      dragStartRef.current       = { x: e.clientX, y: e.clientY }
      dragOffsetStartRef.current = { ...offsetRef.current }
      el.setPointerCapture(e.pointerId)
    }

    const onPointerMove = (e: PointerEvent) => {
      if (!isDraggingRef.current) return
      const dx = e.clientX - dragStartRef.current.x
      const dy = e.clientY - dragStartRef.current.y
      offsetRef.current = {
        x: dragOffsetStartRef.current.x + dx,
        y: dragOffsetStartRef.current.y + dy,
      }
      clampOffset()
      commit()
    }

    const onPointerUp = () => {
      isDraggingRef.current = false
    }

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup',   onPointerUp)

    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup',   onPointerUp)
    }
  }, [clampOffset, commit, reset])

  // ─────────────────────────────────────────────────────
  //  Wheel 事件（缩放 + 触控板双指滑动切换）
  // ─────────────────────────────────────────────────────

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()

      // 触控板：deltaMode = 0（像素级），通常 |deltaX| > 0 时是左右滑动
      const isTrackpad = e.deltaMode === 0 && !e.ctrlKey

      // ── 左右滑动（切换图片）──
      if (isTrackpad && Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.5) {
        // 记录滑动起点
        if (!isTwoFingerRef.current) {
          isTwoFingerRef.current = true
          swipeStartRef.current  = { x: e.clientX, y: e.clientY, time: Date.now() }
        }

        const elapsed  = Date.now() - swipeStartRef.current.time + 1
        const distance = e.deltaX   // 累计方向

        // 速度达到阈值时切换
        const velocity = Math.abs(distance) / elapsed
        if (Math.abs(distance) > SWIPE_THRESHOLD || velocity > SWIPE_VELOCITY) {
          if (distance > 0) next()
          else prev()
          isTwoFingerRef.current = false
        }
        return
      }

      isTwoFingerRef.current = false

      // ── 捏合缩放（ctrlKey 在 macOS 触控板缩放时为 true）──
      if (e.ctrlKey || !isTrackpad) {
        const delta    = -e.deltaY * WHEEL_SENSITIVITY * (isTrackpad ? 8 : 1)
        const newScale = clamp(scaleRef.current * (1 + delta), MIN_SCALE, MAX_SCALE)

        // 以鼠标位置为缩放中心
        const rect = el.getBoundingClientRect()
        const cx   = e.clientX - rect.left - rect.width  / 2
        const cy   = e.clientY - rect.top  - rect.height / 2
        const sr   = newScale / scaleRef.current
        offsetRef.current = {
          x: offsetRef.current.x * sr + cx * (sr - 1),
          y: offsetRef.current.y * sr + cy * (sr - 1),
        }

        scaleRef.current = newScale
        clampOffset()
        commit()
        return
      }

      // ── 垂直滚动（Fit 模式下切换图片）──
      if (scaleRef.current <= MIN_SCALE + 0.01) {
        if (e.deltaY > 0) next()
        else prev()
      }
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [commit, clampOffset, next, prev])

  // ── 切换照片时重置手势状态 ──
  const currentPhotoId = usePreviewStore((s) => s.currentPhotoId)
  useEffect(() => {
    reset()
  }, [currentPhotoId, reset])

  return { gestureState: state, containerRef, reset, setScale }
}
