/**
 * @file src/components/common/ContextMenu.tsx
 * @description 全局右键上下文菜单（Portal）
 *
 * 架构说明：
 *   菜单数据由 uiStore.contextMenu 驱动（M-02 已定义）。
 *   触发方式：在任意组件的 onContextMenu 事件中调用：
 *     uiStore.openContextMenu(x, y, items, photoId?)
 *   菜单通过 createPortal 挂载到 document.body，
 *   不受父级 overflow/z-index 限制。
 *
 * 能力：
 *   - 普通菜单项：图标 + 文字 + 可选快捷键提示
 *   - 分隔线（separator: true）
 *   - 危险项（danger: true）→ 红色文字
 *   - 禁用项（disabled: true）→ 半透明，不可点击
 *   - 子菜单（children 数组）→ hover 时右侧滑出
 *   - 边界检测：自动翻转防止溢出视口
 *   - 关闭：点击外部 / Esc / 点击菜单项
 *
 * 触发来源（PRD §5.5）：
 *   - 网格单张照片右键：查看/添加到相册/收藏/复制/在资源管理器显示/删除
 *   - 网格多选右键：批量添加相册/收藏/删除
 *   - 侧边栏相册右键：重命名/删除
 *   - 侧边栏文件夹右键：从库中移除
 */

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  memo,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  useUiStore,
  selectContextMenu,
  type ContextMenuItem,
} from '@/stores/uiStore'
import { Icon } from '@/components/common/Icon'
import type { IconName } from '@/components/common/Icon'

// ─────────────────────────────────────────────────────────
//  边界检测工具
// ─────────────────────────────────────────────────────────

interface MenuPosition {
  x:       number
  y:       number
  flipX:   boolean
  flipY:   boolean
}

function calcPosition(
  rawX:   number,
  rawY:   number,
  width:  number,
  height: number,
): MenuPosition {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const MARGIN = 6

  const flipX = rawX + width  + MARGIN > vw
  const flipY = rawY + height + MARGIN > vh

  const x = flipX ? rawX - width  : rawX
  const y = flipY ? rawY - height : rawY

  return {
    x: Math.max(MARGIN, Math.min(x, vw - width  - MARGIN)),
    y: Math.max(MARGIN, Math.min(y, vh - height - MARGIN)),
    flipX,
    flipY,
  }
}

// ─────────────────────────────────────────────────────────
//  菜单项共享样式
// ─────────────────────────────────────────────────────────

const ITEM_BASE_STYLE: React.CSSProperties = {
  display:         'flex',
  alignItems:      'center',
  gap:             '8px',
  width:           '100%',
  padding:         '7px 12px',
  fontSize:        'var(--la-text-sm)',
  backgroundColor: 'transparent',
  border:          'none',
  cursor:          'default',
  textAlign:       'left',
  transition:      'background-color 60ms ease',
  userSelect:      'none',
  WebkitUserSelect:'none',
}

// ─────────────────────────────────────────────────────────
//  SubMenu — 二级菜单（hover 触发）
// ─────────────────────────────────────────────────────────

interface SubMenuProps {
  items:    ContextMenuItem[]
  onClose:  () => void
  parentWidth: number
  flipX:    boolean
}

const SubMenu = memo(function SubMenu({ items, onClose, parentWidth, flipX }: SubMenuProps) {
  return (
    <motion.div
      initial={{ opacity: 0, x: flipX ? 8 : -8, scale: 0.97 }}
      animate={{ opacity: 1, x: 0,             scale: 1    }}
      exit={{    opacity: 0, x: flipX ? 8 : -8, scale: 0.97 }}
      transition={{ duration: 0.12, ease: 'easeOut' }}
      style={{
        position:        'absolute',
        top:             '-4px',
        ...(flipX
          ? { right: '100%', marginRight: '2px' }
          : { left:  '100%', marginLeft:  '2px' }
        ),
        minWidth:        '172px',
        backgroundColor: 'var(--la-bg-raised)',
        border:          '1px solid var(--la-border)',
        borderRadius:    'var(--la-radius-lg)',
        boxShadow:       'var(--la-shadow-lg)',
        padding:         '4px 0',
        zIndex:          1,
      }}
    >
      {items.map((item) => (
        <MenuItemRow key={item.id} item={item} onClose={onClose} flipX={flipX} />
      ))}
    </motion.div>
  )
})

// ─────────────────────────────────────────────────────────
//  MenuItemRow — 单行菜单项
// ─────────────────────────────────────────────────────────

interface MenuItemRowProps {
  item:    ContextMenuItem
  onClose: () => void
  flipX:   boolean
}

const MenuItemRow = memo(function MenuItemRow({ item, onClose, flipX }: MenuItemRowProps) {
  const [subOpen, setSubOpen] = useState(false)
  const rowRef                = useRef<HTMLDivElement>(null)

  // ── 分隔线 ──
  if (item.separator) {
    return (
      <div style={{
        height:          '1px',
        backgroundColor: 'var(--la-divider)',
        margin:          '3px 0',
      }} />
    )
  }

  const isDisabled  = item.disabled === true
  const hasChildren = (item.children?.length ?? 0) > 0

  const handleClick = (e: ReactMouseEvent) => {
    e.stopPropagation()
    if (isDisabled || hasChildren) return
    item.onClick?.()
    onClose()
  }

  const textColor = item.danger
    ? 'var(--la-danger)'
    : isDisabled
    ? 'var(--la-text-disabled)'
    : 'var(--la-text-primary)'

  return (
    <div
      ref={rowRef}
      style={{ position: 'relative' }}
      onMouseEnter={() => hasChildren && setSubOpen(true)}
      onMouseLeave={() => hasChildren && setSubOpen(false)}
    >
      <button
        onClick={handleClick}
        disabled={isDisabled}
        style={{
          ...ITEM_BASE_STYLE,
          color:   textColor,
          opacity: isDisabled ? 0.5 : 1,
        }}
        onMouseEnter={(e) => {
          if (!isDisabled) {
            e.currentTarget.style.backgroundColor = item.danger
              ? 'var(--la-danger-subtle)'
              : 'var(--la-bg-hover)'
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent'
        }}
      >
        {/* 图标 */}
        <span style={{ width: '16px', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
          {item.icon && (
            <Icon
              name={item.icon as IconName}
              size={14}
              color={item.danger ? 'var(--la-danger)' : 'var(--la-text-secondary)'}
            />
          )}
        </span>

        {/* 标签 */}
        <span style={{ flex: 1 }}>{item.label}</span>

        {/* 子菜单箭头 */}
        {hasChildren && (
          <Icon
            name={flipX ? 'chevron-left' : 'chevron-right'}
            size={12}
            color="var(--la-text-tertiary)"
          />
        )}
      </button>

      {/* 子菜单 */}
      <AnimatePresence>
        {subOpen && hasChildren && (
          <SubMenu
            key="submenu"
            items={item.children!}
            onClose={onClose}
            parentWidth={rowRef.current?.offsetWidth ?? 172}
            flipX={flipX}
          />
        )}
      </AnimatePresence>
    </div>
  )
})

// ─────────────────────────────────────────────────────────
//  ContextMenu — 主组件（Portal）
// ─────────────────────────────────────────────────────────

export function ContextMenu() {
  const ctx      = useUiStore(selectContextMenu)
  const onClose  = useUiStore((s) => s.closeContextMenu)
  const menuRef  = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<MenuPosition>({ x: 0, y: 0, flipX: false, flipY: false })

  // 菜单打开时计算最终位置（需要先渲染获取尺寸）
  useEffect(() => {
    if (!ctx.isOpen || !menuRef.current) return

    const rect = menuRef.current.getBoundingClientRect()
    const computed = calcPosition(ctx.x, ctx.y, rect.width, rect.height)
    setPos(computed)
  }, [ctx.isOpen, ctx.x, ctx.y])

  // Esc 关闭
  useEffect(() => {
    if (!ctx.isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [ctx.isOpen, onClose])

  // 点击外部关闭
  useEffect(() => {
    if (!ctx.isOpen) return
    const handler = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    // 使用 capture 阶段确保在子组件阻止冒泡前捕获
    document.addEventListener('pointerdown', handler, true)
    return () => document.removeEventListener('pointerdown', handler, true)
  }, [ctx.isOpen, onClose])

  // 滚动时关闭
  useEffect(() => {
    if (!ctx.isOpen) return
    const handler = () => onClose()
    window.addEventListener('scroll', handler, { capture: true, passive: true })
    return () => window.removeEventListener('scroll', handler, true)
  }, [ctx.isOpen, onClose])

  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {ctx.isOpen && (
        <motion.div
          ref={menuRef}
          key="context-menu"
          role="menu"
          aria-label="上下文菜单"
          initial={{ opacity: 0, scale: 0.95, y: -4 }}
          animate={{ opacity: 1, scale: 1,    y: 0  }}
          exit={{    opacity: 0, scale: 0.95, y: -4,
            transition: { duration: 0.1 },
          }}
          transition={{ duration: 0.13, ease: 'easeOut' }}
          onContextMenu={(e) => e.preventDefault()}
          style={{
            position:        'fixed',
            top:             pos.y,
            left:            pos.x,
            minWidth:        '180px',
            maxWidth:        '260px',
            backgroundColor: 'var(--la-bg-raised)',
            border:          '1px solid var(--la-border)',
            borderRadius:    'var(--la-radius-lg)',
            boxShadow:       'var(--la-shadow-overlay)',
            padding:         '4px 0',
            zIndex:          'var(--la-z-overlay)' as unknown as number,
            transformOrigin: pos.flipY ? 'bottom left' : 'top left',
            // 首次渲染时暂时透明，等位置计算完成
            visibility:      ctx.isOpen ? 'visible' : 'hidden',
          }}
        >
          {ctx.items.map((item) => (
            <MenuItemRow
              key={item.id}
              item={item}
              onClose={onClose}
              flipX={pos.flipX}
            />
          ))}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
