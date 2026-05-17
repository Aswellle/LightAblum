/**
 * @file src/components/preview/Filmstrip.tsx
 * @description 大图预览底部胶片缩略图条
 *
 * 规格（PRD §4.1 M-4）：
 *   - 底部显示，高度约 80px
 *   - 最多显示 5 张缩略图，从屏幕最左边开始排列
 *   - 以当前活跃照片为中心计算显示窗口，活跃态蓝色边框
 *   - 点击缩略图直接跳转（previewStore.goTo）
 *   - 2s 无操作后与工具栏一起隐藏（isUiHidden）
 *   - 与工具栏一样使用 AnimatePresence 淡入/淡出
 *
 * v2 改动（UI 调整）：
 *   - 改为最多显示 5 张缩略图的滑动窗口，而非全量横向滚动
 *   - 窗口以 currentIndex 为中心计算，边界时靠左/靠右对齐
 *   - 移除 scrollIntoView（窗口切换已保证活跃项在视口内）
 *   - 缩略图区域从左侧开始排列
 *
 * v3 修复（导航索引错位 bug）：
 *   根因：v2 用 usePhotoStore(selectPhotos) 作为 photos 来源，
 *   再用 photos.indexOf(photo) 计算 goTo 的 index。
 *   当 photoStore 因查询刷新（invalidateQueries / 分页追加）而更新时，
 *   photoStore.photos 的长度/顺序与 previewStore.photoIds 不再一致，
 *   导致 index 错位 → 跳转到错误的照片（在收藏/相册/文件夹等视图尤为明显）。
 *
 *   修复：全部基于 previewStore.photoIds 计算窗口和索引，
 *   不再依赖 photoStore。previewStore.photoIds 在 open() 时固定，
 *   是唯一与 next/prev/goTo 逻辑一致的 source of truth。
 */

import { memo, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useThumbnail } from '@/hooks/useThumbnail'
import { usePreviewStore } from '@/stores/previewStore'

/** 胶片条最多同时显示的缩略图数量 */
const MAX_VISIBLE = 5

// ─────────────────────────────────────────────────────────
//  单个缩略图
// ─────────────────────────────────────────────────────────

interface FilmThumbProps {
  photoId:  string
  index:    number       // global index within previewStore.photoIds
  active:   boolean
  onClick:  () => void
}

const FilmThumb = memo(function FilmThumb({ photoId, active, onClick }: FilmThumbProps) {
  const { url } = useThumbnail(photoId, 's', active ? 'high' : 'low')

  return (
    <button
      onClick={onClick}
      aria-label={`跳转到照片 ${photoId}`}
      aria-current={active ? 'true' : undefined}
      style={{
        flexShrink:      0,
        width:           '54px',
        height:          '54px',
        borderRadius:    'var(--la-radius-sm)',
        overflow:        'hidden',
        border:          active
          ? '2px solid var(--la-accent)'
          : '2px solid transparent',
        opacity:         active ? 1 : 0.5,
        cursor:          'default',
        transition:      'opacity 120ms ease, border-color 120ms ease',
        backgroundColor: 'var(--la-bg-overlay)',
        padding:         0,
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.opacity = '0.8'
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.opacity = '0.5'
      }}
    >
      {url ? (
        <img
          src={url}
          alt=""
          draggable={false}
          style={{
            width:         '100%',
            height:        '100%',
            objectFit:     'cover',
            display:       'block',
            pointerEvents: 'none',
          }}
        />
      ) : (
        <div style={{
          width:           '100%',
          height:          '100%',
          backgroundColor: 'var(--la-bg-overlay)',
          backgroundImage: 'linear-gradient(90deg,var(--la-bg-overlay) 0%,var(--la-bg-hover) 50%,var(--la-bg-overlay) 100%)',
          backgroundSize:  '200% 100%',
          animation:       'la-shimmer 1.5s linear infinite',
        }} />
      )}
    </button>
  )
})

// ─────────────────────────────────────────────────────────
//  Filmstrip — 主组件
// ─────────────────────────────────────────────────────────

export const Filmstrip = memo(function Filmstrip() {
  const currentPhotoId  = usePreviewStore((s) => s.currentPhotoId)
  const currentIndex    = usePreviewStore((s) => s.currentIndex)
  const isUiHidden      = usePreviewStore((s) => s.isUiHidden)
  const isFilmstrip     = usePreviewStore((s) => s.isFilmstripVisible)
  const goTo            = usePreviewStore((s) => s.goTo)
  // v3 fix: use previewStore.photoIds as the single source of truth
  // This is set once at open() time and stays stable for the whole preview session.
  // Using photoStore.photos instead would cause index mismatches when the store
  // gets updated (pagination load / query invalidation) after preview opens.
  const photoIds        = usePreviewStore((s) => s.photoIds)

  // ── 计算最多 MAX_VISIBLE 张的滑动窗口 ──────────────────
  //
  // 完全基于 previewStore.photoIds（与 next/prev/goTo 使用相同数组）
  // 规则：以 currentIndex 为中心，边界修正确保窗口不越界
  //
  // 示例（MAX_VISIBLE=5，总数=13）：
  //   currentIndex=0  → window=[0..4]
  //   currentIndex=6  → window=[4..8]
  //   currentIndex=12 → window=[8..12]
  const windowSlice = useMemo(() => {
    const total = photoIds.length
    if (total === 0) return { ids: [], startIdx: 0 }
    if (total <= MAX_VISIBLE) return { ids: photoIds, startIdx: 0 }

    const half     = Math.floor(MAX_VISIBLE / 2)          // = 2
    let   startIdx = currentIndex - half                   // 期望起始
    startIdx = Math.max(0, Math.min(startIdx, total - MAX_VISIBLE))
    return { ids: photoIds.slice(startIdx, startIdx + MAX_VISIBLE), startIdx }
  }, [photoIds, currentIndex])

  if (!isFilmstrip) return null

  return (
    <AnimatePresence>
      {!isUiHidden && (
        <motion.div
          key="filmstrip"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0  }}
          exit={{    opacity: 0, y: 10 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          style={{
            position:      'absolute',
            bottom:        0,
            left:          0,
            right:         0,
            zIndex:        20,
            // 底部渐变遮罩
            background:    'linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 100%)',
            padding:       '20px 16px 12px',
            pointerEvents: 'auto',
          }}
        >
          {/* 缩略图行：左对齐，最多 MAX_VISIBLE 张，不横向滚动 */}
          <div style={{
            display:    'flex',
            alignItems: 'center',
            gap:        '4px',
          }}>
            {windowSlice.ids.map((photoId, sliceIdx) => {
              // globalIdx = the index within previewStore.photoIds
              // This is what goTo() expects — consistent with next()/prev()
              const globalIdx = windowSlice.startIdx + sliceIdx
              return (
                <FilmThumb
                  key={photoId}
                  photoId={photoId}
                  index={globalIdx}
                  active={photoId === currentPhotoId}
                  onClick={() => goTo(globalIdx)}
                />
              )
            })}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
})
