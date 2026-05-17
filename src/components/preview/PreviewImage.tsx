/**
 * @file src/components/preview/PreviewImage.tsx
 * @description 大图预览图片渲染区域（v7 — 直接显示磁盘原图）
 *
 * v7 改动：
 *   原版（v4-v6）在预览模式显示 WEBP 缩略图，导致：
 *     1. 有损压缩细节损失
 *     2. 缩略图尺寸与显示宽高比计算耦合，反复出现变形 bug
 *
 *   v7 方案：直接用 convertFileSrc(photo.filePath) 将磁盘绝对路径
 *   转换为 asset:// 协议 URL，<img> 直接加载原始文件。
 *     - 完整像素内容，无压缩损失
 *     - naturalWidth/naturalHeight = 原图真实尺寸，无需额外校正
 *     - 彻底消除缩略图宽高比不匹配导致的变形问题
 *
 *   实现（最小改动，仅 ImageContent 内部）：
 *     1. useQuery(['photo', photoId]) — 与 ExifPanel 共用，TanStack Query 去重
 *     2. convertFileSrc(photo.filePath) → originalUrl
 *     3. 原图加载前用缩略图 thumbUrl 过渡，保证用户体验
 *     4. fitDim 仍用元数据宽高（orientation 校正），布局稳定
 *
 *   Tauri 权限：tauri.conf.json 已有 assetProtocol.enable=true, scope=["**"]
 *
 * 继承 v4-v6 所有修复（flex 布局、useLayoutEffect、metaSize、objectFit:contain）
 */

import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  memo,
} from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuery } from '@tanstack/react-query'
import { convertFileSrc } from '@tauri-apps/api/core'
import { useThumbnailWithFallback } from '@/hooks/useThumbnail'
import { usePreviewGesture } from '@/hooks/usePreviewGesture'
import {
  usePreviewStore,
  selectDirection,
  selectHasNext,
  selectHasPrev,
} from '@/stores/previewStore'
import { usePhotoStore } from '@/stores/photoStore'
import { api } from '@/services/tauriIpc'
import { Icon } from '@/components/common/Icon'

// ─────────────────────────────────────────────────────────
//  左右切换动画变体
// ─────────────────────────────────────────────────────────

const slideVariants = {
  enter: (dir: number) => ({
    x:       dir > 0 ? '25%' : '-25%',
    opacity: 0,
  }),
  center: {
    x:       0,
    opacity: 1,
    transition: {
      x:       { duration: 0.25, ease: [0.4, 0, 0.2, 1] },
      opacity: { duration: 0.18 },
    },
  },
  exit: (dir: number) => ({
    x:       dir > 0 ? '-25%' : '25%',
    opacity: 0,
    transition: {
      x:       { duration: 0.2,  ease: [0.4, 0, 1, 1] },
      opacity: { duration: 0.15 },
    },
  }),
}

// ─────────────────────────────────────────────────────────
//  导航箭头（不变）
// ─────────────────────────────────────────────────────────

interface NavArrowProps { direction: 'prev' | 'next'; visible: boolean; onClick: () => void }

const NavArrow = memo(function NavArrow({ direction, visible, onClick }: NavArrowProps) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={(e) => { e.stopPropagation(); onClick() }}
          aria-label={direction === 'prev' ? '上一张' : '下一张'}
          style={{
            position: 'absolute', top: '50%', transform: 'translateY(-50%)',
            [direction === 'prev' ? 'left' : 'right']: '20px',
            zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: '44px', height: '44px', borderRadius: '50%',
            backgroundColor: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.9)',
            cursor: 'default', transition: 'background-color 120ms ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.65)' }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.45)' }}
        >
          <Icon name={direction === 'prev' ? 'chevron-left' : 'chevron-right'} size={20} strokeWidth={2} />
        </motion.button>
      )}
    </AnimatePresence>
  )
})

// ─────────────────────────────────────────────────────────
//  缩放比例 HUD（不变）
// ─────────────────────────────────────────────────────────

function ScaleHud({ scale }: { scale: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      style={{
        position: 'absolute', bottom: '80px', left: '50%', transform: 'translateX(-50%)',
        backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)',
        color: 'rgba(255,255,255,0.9)', fontSize: 'var(--la-text-sm)',
        fontWeight: 'var(--la-weight-medium)' as unknown as number,
        borderRadius: 'var(--la-radius-full)', padding: '4px 14px',
        pointerEvents: 'none', zIndex: 20, fontVariantNumeric: 'tabular-nums',
      }}
    >
      {Math.round(scale * 100)}%
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────
//  useContainerSize（v4，不变）
// ─────────────────────────────────────────────────────────

function useContainerSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      if (w > 0 && h > 0) setSize({ w, h })
    }
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])

  return size
}

// ─────────────────────────────────────────────────────────
//  calcFitDimensions（不变）
// ─────────────────────────────────────────────────────────

function calcFitDimensions(cw: number, ch: number, nw: number, nh: number) {
  if (!cw || !ch || !nw || !nh) return null
  const scale = Math.min(cw / nw, ch / nh)
  return {
    width:  Math.floor(nw * scale),
    height: Math.floor(nh * scale),
  }
}

// ─────────────────────────────────────────────────────────
//  getPhotoDisplaySize（v5，orientation 校正，不变）
// ─────────────────────────────────────────────────────────

function getPhotoDisplaySize(
  photoId: string,
  photos: Array<{ id: string; width: number; height: number; orientation: number }>,
): { w: number; h: number } | null {
  const photo = photos.find((p) => p.id === photoId)
  if (!photo || !photo.width || !photo.height) return null
  const { width, height, orientation } = photo
  // orientation 5-8：传感器横拍，显示时宽高互换
  if (orientation >= 5 && orientation <= 8) {
    return { w: height, h: width }
  }
  return { w: width, h: height }
}

// ─────────────────────────────────────────────────────────
//  ImageContent（v7：原图加载，缩略图作占位）
// ─────────────────────────────────────────────────────────

interface ImageContentProps {
  photoId:    string
  direction:  number
  scale:      number
  offset:     { x: number; y: number }
  containerW: number
  containerH: number
}

const ImageContent = memo(function ImageContent({
  photoId, direction, scale, offset, containerW, containerH,
}: ImageContentProps) {

  // ── v7 核心：查询原图路径（与 ExifPanel 共用 queryKey，TanStack Query 自动去重）
  const { data: photo } = useQuery({
    queryKey:  ['photo', photoId],
    queryFn:   () => api.photos.get(photoId),
    staleTime: Infinity,          // 文件路径不变，永不过期
    gcTime:    10 * 60 * 1000,
  })

  // Tauri asset:// 协议 URL → 浏览器直接读磁盘原文件
  // convertFileSrc 自动处理平台差异（Windows: http://asset.localhost/... 等）
  const originalUrl = photo?.filePath ? convertFileSrc(photo.filePath) : undefined

  // 缩略图：原图查询/加载期间的过渡占位，保证用户看到即时反馈
  const { url: thumbUrl } = useThumbnailWithFallback(photoId, 'm')

  // 显示 URL：原图优先，缩略图兜底
  const displayUrl = originalUrl ?? thumbUrl

  // ── 元数据宽高（v5，不变）
  const photos   = usePhotoStore((s) => s.photos)
  const metaSize = getPhotoDisplaySize(photoId, photos)

  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    setNaturalSize(null)
    const img = imgRef.current
    if (img?.complete && img.naturalWidth > 0) {
      setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight })
    }
  }, [displayUrl])

  const handleLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    if (img.naturalWidth > 0) {
      setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight })
    }
  }, [])

  // 宽高比：元数据优先（立即），naturalSize 次之（onLoad 后）
  const displaySize = metaSize ?? naturalSize
  const fitDim = displaySize
    ? calcFitDimensions(containerW, containerH, displaySize.w, displaySize.h)
    : null

  const tempMaxW = containerW > 0 ? containerW : undefined
  const tempMaxH = containerH > 0 ? containerH : undefined

  // 原图已加载完成标志（缩略图占位时略暗，原图加载后恢复正常亮度）
  const isOriginalLoaded = Boolean(originalUrl && naturalSize)

  return (
    <motion.div
      key={photoId}
      custom={direction}
      variants={slideVariants}
      initial="enter"
      animate="center"
      exit="exit"
      style={{
        position:       'absolute',
        inset:          0,
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        overflow:       'hidden',
        willChange:     'transform',
      }}
    >
      {displayUrl ? (
        <img
          ref={imgRef}
          src={displayUrl}
          alt=""
          draggable={false}
          onLoad={handleLoad}
          style={{
            width:     fitDim ? `${fitDim.width}px`  : undefined,
            height:    fitDim ? `${fitDim.height}px` : undefined,
            maxWidth:  fitDim ? 'none' : (tempMaxW ? `${tempMaxW}px` : '100vw'),
            maxHeight: fitDim ? 'none' : (tempMaxH ? `${tempMaxH}px` : '100vh'),
            // object-fit:contain 保证内容在 fitDim 框内无失真
            // 原图 naturalSize = 真实像素，不存在压缩/裁切导致的比例偏差
            objectFit:      'contain',
            objectPosition: 'center',
            flexShrink:     0,
            userSelect:     'none',
            pointerEvents:  'none',
            display:        'block',
            transform:        `scale(${scale}) translate(${offset.x / scale}px, ${offset.y / scale}px)`,
            transformOrigin:  'center',
            transition:       scale === 1 ? 'transform 200ms ease' : undefined,
            // 缩略图占位期间略暗，原图加载后平滑过渡到正常亮度
            filter:     isOriginalLoaded ? 'none' : 'brightness(0.92)',
            willChange: 'transform',
          }}
        />
      ) : (
        <div style={{
          width:           Math.min(containerW * 0.6, 600) || 360,
          height:          (Math.min(containerW * 0.6, 600) || 360) * 2 / 3,
          borderRadius:    'var(--la-radius-md)',
          backgroundColor: 'var(--la-bg-overlay)',
          backgroundImage: 'linear-gradient(90deg, var(--la-bg-overlay) 0%, var(--la-bg-hover) 50%, var(--la-bg-overlay) 100%)',
          backgroundSize:  '200% 100%',
          animation:       'la-shimmer 1.5s linear infinite',
        }} />
      )}
    </motion.div>
  )
})

// ─────────────────────────────────────────────────────────
//  PreviewImage — 主组件（结构完全不变）
// ─────────────────────────────────────────────────────────

export const PreviewImage = memo(function PreviewImage() {
  const currentPhotoId = usePreviewStore((s) => s.currentPhotoId)
  const direction      = usePreviewStore(selectDirection)
  const hasNext        = usePreviewStore(selectHasNext)
  const hasPrev        = usePreviewStore(selectHasPrev)
  const next           = usePreviewStore((s) => s.next)
  const prev           = usePreviewStore((s) => s.prev)
  const isUiHidden     = usePreviewStore((s) => s.isUiHidden)

  const [showHud, setShowHud]   = useState(false)
  const [hovering, setHovering] = useState(false)
  const hudTimerRef             = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { gestureState, containerRef } = usePreviewGesture(null)
  const { scale, offset, isFit }       = gestureState

  const containerSize = useContainerSize(containerRef)

  useEffect(() => {
    if (scale === 1) { setShowHud(false); return }
    setShowHud(true)
    if (hudTimerRef.current) clearTimeout(hudTimerRef.current)
    hudTimerRef.current = setTimeout(() => setShowHud(false), 1500)
    return () => { if (hudTimerRef.current) clearTimeout(hudTimerRef.current) }
  }, [scale])

  if (!currentPhotoId) return null

  return (
    <div
      ref={containerRef}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      style={{
        flex:            1,
        minWidth:        0,
        minHeight:       0,
        position:        'relative',
        overflow:        'hidden',
        backgroundColor: '#000',
        cursor:          scale > 1 ? 'grab' : 'default',
      }}
    >
      <AnimatePresence initial={false} custom={direction} mode="popLayout">
        <ImageContent
          key={currentPhotoId}
          photoId={currentPhotoId}
          direction={direction}
          scale={scale}
          offset={offset}
          containerW={containerSize.w}
          containerH={containerSize.h}
        />
      </AnimatePresence>

      <NavArrow direction="prev" visible={hovering && !isUiHidden && hasPrev && isFit} onClick={prev} />
      <NavArrow direction="next" visible={hovering && !isUiHidden && hasNext && isFit} onClick={next} />

      <AnimatePresence>
        {showHud && <ScaleHud key="hud" scale={scale} />}
      </AnimatePresence>
    </div>
  )
})
