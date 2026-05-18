/**
 * @file src/components/grid/VirtualGrid.tsx
 * @description 虚拟化网格渲染容器
 *
 * 职责：
 *   - 消费 useVirtualGrid 的计算结果
 *   - 渲染顶部/底部占位 div（撑起滚动条）
 *   - 渲染可见行（GroupHeaderRow 或 PhotoRow）
 *   - 将 preloadThumbnails 调用到 overscan 区域
 *   - 滚动触底时调用 onLoadMore（加载下一页）
 *   - 将 centerPhotoId 提升为 'high' 优先级缩略图请求
 *
 * 空态/加载态：
 *   - isLoading = true（首次加载）→ 骨架屏占位格矩阵
 *   - photos = [] + !isLoading    → 空态提示（视图相关文案）
 *
 * 与 PhotoGrid 的分工：
 *   PhotoGrid  负责数据查询（usePhotoQuery）+ 视图路由
 *   VirtualGrid 负责纯渲染，接收 photos（已平铺的数组）
 */

import { useCallback, memo, useMemo } from 'react'
import { useVirtualGrid, type VirtualRow } from '@/hooks/useVirtualGrid'
import { useScrollVelocity } from '@/hooks/useScrollVelocity'
import { usePreloadThumbnails } from '@/hooks/useThumbnail'
import { useLayoutStore, selectGridConfig } from '@/stores/layoutStore'
import { usePhotoStore, selectGroups } from '@/stores/photoStore'
import { DateGroup } from './DateGroup'
import { GridItem } from './GridItem'

// ─────────────────────────────────────────────────────────
//  加载态骨架屏
// ─────────────────────────────────────────────────────────

function GridSkeleton({ columns, itemSize, gap }: { columns: number; itemSize: number; gap: number }) {
  const count = columns * 4   // 4 行占位格
  return (
    <div style={{
      display:             'grid',
      gridTemplateColumns: `repeat(${columns}, ${itemSize}px)`,
      gap,
      padding:             gap,
    }}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            width:           itemSize,
            height:          itemSize,
            borderRadius:    4,
            backgroundColor: 'var(--la-bg-overlay)',
            backgroundImage: 'linear-gradient(90deg, var(--la-bg-overlay) 0%, var(--la-bg-hover) 50%, var(--la-bg-overlay) 100%)',
            backgroundSize:  '200% 100%',
            animation:       'la-shimmer 1.5s linear infinite',
            animationDelay:  `${(i * 0.05) % 0.5}s`,
          }}
        />
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────
//  空态
// ─────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div style={{
      height:         '100%',
      display:        'flex',
      flexDirection:  'column',
      alignItems:     'center',
      justifyContent: 'center',
      gap:            '12px',
      color:          'var(--la-text-tertiary)',
      userSelect:     'none',
    }}>
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none"
        stroke="var(--la-text-tertiary)" strokeWidth="1.5" strokeLinecap="round">
        <rect x="4"  y="10" width="28" height="24" rx="3" />
        <rect x="12" y="4"  width="32" height="28" rx="3" />
        <circle cx="22" cy="19" r="4" />
        <path d="M12 32l6-6 4 4 6-8 4 10" strokeLinejoin="round" />
      </svg>
      <p style={{ fontSize: 'var(--la-text-sm)' }}>
        没有照片
      </p>
      <p style={{ fontSize: 'var(--la-text-xs)', color: 'var(--la-text-tertiary)' }}>
        点击「导入」按钮添加照片文件夹
      </p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────
//  RowRenderer — 渲染单行（分组标题 or 照片行）
// ─────────────────────────────────────────────────────────

interface RowRendererProps {
  row:       VirtualRow
  config:    NonNullable<ReturnType<typeof selectGridConfig>>
  allIds:    string[]
}

const RowRenderer = memo(function RowRenderer({ row, config, allIds }: RowRendererProps) {
  const { itemSize, gap } = config

  if (row.type === 'group-header') {
    return (
      <DateGroup
        label={row.label}
        count={row.count}
        photoIds={row.groupPhotoIds}  // Fix: pass only this group's photo IDs
      />
    )
  }

  // photo-row
  return (
    <div style={{
      display: 'flex',
      gap,
    }}>
      {row.photos.map((photo) => (
        <GridItem
          key={photo.id}
          photo={photo}
          size={itemSize}
          allIds={allIds}
        />
      ))}
      {/* 末行补空格，保持对齐 */}
      {row.photos.length < config.columns && Array.from({
        length: config.columns - row.photos.length,
      }).map((_, i) => (
        <div key={`pad-${i}`} style={{ width: itemSize, height: itemSize, flexShrink: 0 }} />
      ))}
    </div>
  )
})

// ─────────────────────────────────────────────────────────
//  VirtualGrid — 主组件
// ─────────────────────────────────────────────────────────

interface VirtualGridProps {
  isLoading?:  boolean
  onLoadMore?: () => void
  hasMore?:    boolean
}

export const VirtualGrid = memo(function VirtualGrid({
  isLoading  = false,
  onLoadMore,
  hasMore    = false,
}: VirtualGridProps) {
  const config    = useLayoutStore(selectGridConfig)
  const groups    = usePhotoStore(selectGroups)

  const { isFast, onScroll: onScrollVelocity } = useScrollVelocity()

  const {
    containerRef,
    totalHeight,
    offsetTop,
    offsetBottom,
    visibleRows,
    allPhotoIds,
  } = useVirtualGrid({ groups, config })

  // ── 预加载 overscan 区域缩略图 ──
  const overscanIds = useMemo(() => {
    const ids: string[] = []
    for (const row of visibleRows) {
      if (row.type === 'photo-row') {
        row.photos.forEach((p) => ids.push(p.id))
      }
    }
    return ids
  }, [visibleRows])

  usePreloadThumbnails(overscanIds, 's', isFast)

  // ── 滚动触底加载更多 ──
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    onScrollVelocity(e)
    if (!onLoadMore || !hasMore) return
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget
    if (scrollTop + clientHeight >= scrollHeight * 0.85) {
      onLoadMore()
    }
  }, [onScrollVelocity, onLoadMore, hasMore])

  // ── 空态 / 加载态 ──
  if (!config) return null
  const { columns, itemSize, gap } = config
  const isEmpty = groups.length === 0 && !isLoading

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      style={{
        height:    '100%',
        overflowY: 'auto',
        overflowX: 'hidden',
        position:  'relative',
        // 背景：纯黑（深色）/ 纯白（浅色）—— 照片优先
        backgroundColor: 'var(--la-bg-app)',
      }}
    >
      {/* 加载骨架屏 */}
      {isLoading && <GridSkeleton columns={columns} itemSize={itemSize} gap={gap} />}

      {/* 空态 */}
      {isEmpty && <EmptyState />}

      {/* 虚拟化内容区 */}
      {!isLoading && !isEmpty && (
        <div style={{ height: totalHeight, position: 'relative' }}>
          {/* 上方占位 */}
          <div style={{ height: offsetTop }} />

          {/* 可见行 */}
          <div style={{ padding: `0 ${gap}px` }}>
            {visibleRows.map((row) => (
              <div
                key={row.key}
                style={{ height: row.height, marginBottom: row.type === 'photo-row' ? gap : 0 }}
              >
                <RowRenderer
                  row={row}
                  config={config}
                  allIds={allPhotoIds}
                />
              </div>
            ))}
          </div>

          {/* 下方占位 */}
          <div style={{ height: offsetBottom }} />
        </div>
      )}
    </div>
  )
})
