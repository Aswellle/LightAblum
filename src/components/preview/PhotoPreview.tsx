/**
 * @file src/components/preview/PhotoPreview.tsx
 * @description 大图预览主容器（v3 — 纯 flex 布局，彻底修复高度链断裂）
 *
 * BugFix v3：
 *   v2 引入了 height:0 配合 flex:1 1 0，意图通过 flex-basis:0 让容器
 *   不占用固有空间。但这导致了高度链断裂：
 *
 *     content-div: height:0 （显式 CSS 高度 = 0）
 *       PreviewImage: height:'100%'  → 100% of 0 = 0！
 *
 *   CSS 百分比高度规则：只有当父元素有明确的（非百分比）高度时，
 *   子元素的 height:% 才能正确解析。flex:1 不是"明确高度"。
 *   height:0 是一个明确高度（= 0），所以 height:100% 解析为 0。
 *
 *   结果：PreviewImage 高度 = 0 → ResizeObserver 返回 containerH = 0
 *        → JS 计算 fitDim 失败 → 回退到 maxHeight:100% of 0 = 0
 *        → img 按自然尺寸渲染 → 高图溢出屏幕。
 *
 * 修复：
 *   完全移除 height:0，使用纯 flex 布局。
 *   关键是 content-div 和 PreviewImage 都不设置 height（不设 = auto，
 *   由 flex 决定），只设 minHeight:0（允许 flex 缩小到 0 以下）。
 *   PreviewImage 也不用 height:'100%'，同样只用 flex:1 + minHeight:0。
 *
 *   这样 ResizeObserver 读到的是真实的 flex 布局高度，
 *   JS fit 计算正确，img 精确像素定位不会溢出。
 */

import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { usePreviewStore } from '@/stores/previewStore'
import { PreviewImage } from './PreviewImage'
import { PreviewToolbar } from './PreviewToolbar'
import { Filmstrip } from './Filmstrip'
import { ExifPanel } from './ExifPanel'

const backdropVariants = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2, ease: 'easeOut' } },
  exit:    { opacity: 0, transition: { duration: 0.22, ease: 'easeIn'  } },
}

export function PhotoPreview() {
  const currentPhotoId = usePreviewStore((s) => s.currentPhotoId)
  const close          = usePreviewStore((s) => s.close)

  useEffect(() => {
    const original = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = original }
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [close])

  if (!currentPhotoId) return null

  return (
    <motion.div
      key="photo-preview-root"
      variants={backdropVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      style={{
        position:         'fixed',
        inset:            0,
        zIndex:           'var(--la-z-preview)' as unknown as number,
        backgroundColor:  'rgba(0,0,0,0.92)',
        backdropFilter:   'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        // 根容器：flex 列，撑满视口
        display:          'flex',
        flexDirection:    'column',
        overflow:         'hidden',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) close() }}
    >
      {/* 工具栏：绝对定位，不占 flex 空间 */}
      <PreviewToolbar photoId={currentPhotoId} />

      {/* 主内容区：flex:1 + minHeight:0（不设 height，让 flex 决定）
          ✅ 这样子元素的 height 由 flex 布局确定，非 0
          ✅ overflow:hidden 确保 position:absolute 子元素被正确裁剪
          ❌ 不用 height:0（会导致 height:100% 子元素解析为 0）*/}
      <div style={{
        flex:      1,
        minHeight: 0,          // 允许 flex 收缩
        display:   'flex',
        overflow:  'hidden',
        position:  'relative',
      }}>
        <PreviewImage />
        <ExifPanel photoId={currentPhotoId} />
      </div>

      {/* 胶片条：绝对定位，不占 flex 空间 */}
      <Filmstrip />
    </motion.div>
  )
}
