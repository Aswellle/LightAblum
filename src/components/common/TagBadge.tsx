/**
 * @file src/components/common/TagBadge.tsx
 * @description 标签色块徽章组件（Phase-B M-12）
 *
 * 用途：
 *   - 在照片右键菜单的「标签」子菜单中显示标签颜色标识
 *   - 在 TagEditor 弹窗的标签列表中显示
 *   - 在侧边栏 TagFilterPanel 中显示
 *
 * 设计原则：
 *   - 纯展示组件，接收 name/color，无内部状态
 *   - 尺寸变体：sm（侧边栏列表）/ md（编辑器）
 *   - 点击回调可选，有则显示 hover 效果
 */

import { memo } from 'react'
import type { Tag } from '@/types/ipc'

interface TagBadgeProps {
  tag:      Tag
  size?:    'sm' | 'md'
  selected?: boolean
  onClick?: () => void
  onRemove?: () => void
}

export const TagBadge = memo(function TagBadge({
  tag,
  size = 'md',
  selected = false,
  onClick,
  onRemove,
}: TagBadgeProps) {
  const isSm = size === 'sm'

  return (
    <span
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
      style={{
        display:        'inline-flex',
        alignItems:     'center',
        gap:            isSm ? '4px' : '5px',
        padding:        isSm ? '2px 6px' : '3px 8px',
        borderRadius:   '20px',
        fontSize:       isSm ? '11px' : '12px',
        fontWeight:     500,
        lineHeight:     1.4,
        cursor:         onClick ? 'pointer' : 'default',
        userSelect:     'none',
        transition:     'opacity 120ms',
        opacity:        selected ? 1 : 0.85,
        border:         `1.5px solid ${tag.color}`,
        backgroundColor: selected
          ? tag.color + '33'   // 20% opacity tint
          : tag.color + '18',  // 9% opacity tint
        color:          'var(--la-text-primary)',
      }}
      title={tag.name}
    >
      {/* 色点 */}
      <span
        style={{
          width:        isSm ? '6px' : '8px',
          height:       isSm ? '6px' : '8px',
          borderRadius: '50%',
          backgroundColor: tag.color,
          flexShrink:   0,
        }}
        aria-hidden
      />
      <span
        style={{
          maxWidth:     isSm ? '80px' : '120px',
          overflow:     'hidden',
          textOverflow: 'ellipsis',
          whiteSpace:   'nowrap',
        }}
      >
        {tag.name}
      </span>

      {/* 移除按钮（可选） */}
      {onRemove && (
        <span
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          role="button"
          aria-label={`移除标签 ${tag.name}`}
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onRemove(); } }}
          style={{
            marginLeft:  '2px',
            fontSize:    isSm ? '10px' : '11px',
            lineHeight:  1,
            opacity:     0.6,
            cursor:      'pointer',
            padding:     '0 1px',
            borderRadius: '50%',
          }}
        >
          ✕
        </span>
      )}
    </span>
  )
})
