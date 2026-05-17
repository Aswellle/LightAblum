/**
 * @file src/components/grid/WaterfallGrid.tsx
 * @description 瀑布流布局网格
 *
 * 使用 useWaterfallGrid 计算每张图的绝对位置，
 * 通过绝对定位 + 上下 padding 占位实现虚拟化。
 * 照片保持原始宽高比（不裁切）。
 */

import { memo } from 'react'
import { motion } from 'framer-motion'
import { useWaterfallGrid } from '@/hooks/useWaterfallGrid'
import { useScrollVelocity } from '@/hooks/useScrollVelocity'
import { useThumbnail } from '@/hooks/useThumbnail'
import { useLayoutStore, selectGridConfig } from '@/stores/layoutStore'
import { usePhotoStore, selectPhotos } from '@/stores/photoStore'
import { usePreviewStore } from '@/stores/previewStore'
import { useSelectionStore, selectIsSelected } from '@/stores/selectionStore'
import { Icon } from '@/components/common/Icon'
import type { PhotoThumb } from '@/types/photo'
import type { WaterfallLayoutItem } from '@/hooks/useWaterfallGrid'

// ─────────────────────────────────────────────────────────
//  单个瀑布流项目
// ─────────────────────────────────────────────────────────

interface WaterfallItemProps {
  item:    WaterfallLayoutItem
  allIds:  string[]
}

const WaterfallItem = memo(function WaterfallItem({ item, allIds }: WaterfallItemProps) {
  const { photo, x, y, width, height } = item
  const { url, isLoading } = useThumbnail(photo.id, 'm', 'normal')

  const isSelected  = useSelectionStore(selectIsSelected(photo.id))
  const select      = useSelectionStore((s) => s.select)
  const toggle      = useSelectionStore((s) => s.toggle)
  const rangeSelect = useSelectionStore((s) => s.rangeSelect)
  const openPreview = usePreviewStore((s) => s.open)
  const photoIds    = usePhotoStore(selectPhotos).map((p) => p.id)

  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey) {
      rangeSelect(photo.id, allIds)
    } else if (e.ctrlKey || e.metaKey) {
      toggle(photo.id)
    } else {
      select(photo.id)
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      openPreview(photo.id, photoIds, rect)
    }
  }

  return (
    <motion.div
      layoutId={`photo-${photo.id}`}
      onClick={handleClick}
      whileHover={{ scale: 1.02 }}
      transition={{ duration: 0.15 }}
      style={{
        position:    'absolute',
        left:        x,
        top:         y,
        width,
        height,
        borderRadius: 6,
        overflow:    'hidden',
        cursor:      'default',
        outline:     isSelected ? '2px solid var(--la-accent)' : 'none',
        outlineOffset: '-2px',
      }}
    >
      {url ? (
        <motion.img
          src={url}
          alt={photo.fileName}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
          style={{
            width:       '100%',
            height:      '100%',
            objectFit:   'cover',
            display:     'block',
            pointerEvents: 'none',
          }}
          draggable={false}
        />
      ) : (
        <div style={{
          width:           '100%',
          height:          '100%',
          backgroundColor: 'var(--la-bg-overlay)',
          backgroundImage: 'linear-gradient(90deg, var(--la-bg-overlay) 0%, var(--la-bg-hover) 50%, var(--la-bg-overlay) 100%)',
          backgroundSize:  '200% 100%',
          animation:       'la-shimmer 1.5s linear infinite',
        }} />
      )}

      {photo.isFavorite && (
        <div style={{
          position: 'absolute', top: 6, right: 6,
          filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))',
        }}>
          <Icon name="heart-fill" size={14} color="var(--la-favorite)" />
        </div>
      )}
    </motion.div>
  )
})

// ─────────────────────────────────────────────────────────
//  WaterfallGrid — 主组件
// ─────────────────────────────────────────────────────────

export const WaterfallGrid = memo(function WaterfallGrid() {
  const config  = useLayoutStore(selectGridConfig)
  const photos  = usePhotoStore(selectPhotos)
  const allIds  = photos.map((p) => p.id)
  const { isFast, onScroll } = useScrollVelocity()

  const {
    containerRef,
    totalHeight,
    visibleItems,
  } = useWaterfallGrid({ photos, config })

  if (!config) return null

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      style={{
        height:    '100%',
        overflowY: 'auto',
        overflowX: 'hidden',
        position:  'relative',
        backgroundColor: 'var(--la-bg-app)',
      }}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        {visibleItems.map((item) => (
          <WaterfallItem
            key={item.photo.id}
            item={item}
            allIds={allIds}
          />
        ))}
      </div>
    </div>
  )
})
