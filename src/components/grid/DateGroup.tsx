/**
 * @file src/components/grid/DateGroup.tsx
 * @description 日期分组标题行
 *
 * 渲染在每个月份分组的顶部，显示：
 *   - 月份标签（如"2025年3月"）
 *   - 该组照片数量
 *   - 「全选本组」按钮（始终显示，不再仅 hover 时出现）
 *
 * 高度固定 44px（与 useVirtualGrid 中 GROUP_HEADER_HEIGHT 一致）
 */

import { memo } from 'react'
import { useSelectionStore } from '@/stores/selectionStore'

interface DateGroupProps {
  label:    string
  count:    number
  /** 组内全部照片 ID（用于「全选本组」） */
  photoIds: string[]
}

export const DateGroup = memo(function DateGroup({
  label, count, photoIds,
}: DateGroupProps) {
  const selectedIds = useSelectionStore((s) => s.selectedIds)

  // 判断本组是否全部已选中
  const allSelected =
    photoIds.length > 0 &&
    photoIds.every((id) => selectedIds.has(id))

  const handleGroupSelect = () => {
    if (allSelected) {
      // 反选：清空本组的选中（不影响其他组）
      const next = new Set(selectedIds)
      photoIds.forEach((id) => next.delete(id))
      // 使用 store 内部方法模拟（实际上是局部取消，而非 clearSelection）
      useSelectionStore.setState({ selectedIds: next })
    } else {
      // 全选本组（追加到已有选中）
      const next = new Set(selectedIds)
      photoIds.forEach((id) => next.add(id))
      useSelectionStore.setState({ selectedIds: next })
    }
  }

  return (
    <div
      style={{
        height:      '44px',
        display:     'flex',
        alignItems:  'center',
        gap:         '10px',
        padding:     '0 4px 0 2px',
        userSelect:  'none',
      }}
    >
      {/* 月份标签 */}
      <h2 style={{
        fontSize:   'var(--la-text-base)',
        fontWeight: 'var(--la-weight-semibold)' as unknown as number,
        color:      'var(--la-text-primary)',
        margin:     0,
        lineHeight: 1,
      }}>
        {label}
      </h2>

      {/* 数量徽标 */}
      <span style={{
        fontSize:   'var(--la-text-sm)',
        color:      'var(--la-text-secondary)',
        lineHeight: 1,
      }}>
        {count.toLocaleString('zh-CN')} 张
      </span>

      {/* 全选本组按钮（始终显示） */}
      {(
        <button
          onClick={handleGroupSelect}
          style={{
            marginLeft:      'auto',
            fontSize:        'var(--la-text-xs)',
            color:           allSelected ? 'var(--la-accent)' : 'var(--la-text-tertiary)',
            backgroundColor: 'transparent',
            border:          `1px solid ${allSelected ? 'var(--la-accent)' : 'var(--la-border)'}`,
            borderRadius:    'var(--la-radius-sm)',
            padding:         '2px 8px',
            cursor:          'default',
            transition:      'all 100ms ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--la-accent)'
            e.currentTarget.style.borderColor = 'var(--la-accent)'
          }}
          onMouseLeave={(e) => {
            if (!allSelected) {
              e.currentTarget.style.color = 'var(--la-text-tertiary)'
              e.currentTarget.style.borderColor = 'var(--la-border)'
            }
          }}
        >
          {allSelected ? '取消全选' : '全选本组'}
        </button>
      )}
    </div>
  )
})
