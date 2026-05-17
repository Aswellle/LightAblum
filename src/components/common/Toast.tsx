/**
 * @file src/components/common/Toast.tsx
 * @description 全局通知 Toast 组件
 *
 * 架构说明：
 *   Toast 组件通过 React.createPortal 挂载到 document.body，
 *   不受父级 overflow:hidden 影响，始终可见。
 *   数据来源：uiStore.toasts 队列（M-02 已实现）。
 *   触发方式：import { toast } from '@/stores/uiStore' 后调用工厂函数。
 *
 * 视觉规格：
 *   - 位置：右下角，距边缘 16px
 *   - 最大同时显示 5 条，溢出时从底部弹出旧条目
 *   - 每条高度自适应文字内容
 *   - 4 种变体：info(蓝) / success(绿) / warning(橙) / error(红)
 *   - 动画：从右侧滑入（translateX + opacity），消失时向下淡出
 *
 * 自动消失：
 *   duration > 0 时 uiStore.addToast 已设置 setTimeout，
 *   Toast 组件无需自行管理计时器。
 *   duration = 0（error）需用户手动点 × 关闭。
 *
 * Action 按钮：
 *   可选的操作按钮，例如"撤销"，点击后执行 action.onClick 并关闭。
 *
 * 使用：
 *   toast.success('照片已收藏')
 *   toast.error('操作失败', { label: '重试', onClick: retry })
 *   toast.info('共 12,345 张照片')
 *   toast.warning('存储空间不足 1GB')
 */

import { useCallback, memo } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useUiStore, selectToasts, type ToastItem, type ToastVariant } from '@/stores/uiStore'
import { Icon } from '@/components/common/Icon'
import type { IconName } from '@/components/common/Icon'

// ─────────────────────────────────────────────────────────
//  变体配置
// ─────────────────────────────────────────────────────────

interface VariantConfig {
  iconName:    IconName
  iconColor:   string
  borderColor: string
  bgColor:     string
}

const VARIANT_CONFIG: Record<ToastVariant, VariantConfig> = {
  info: {
    iconName:    'info',
    iconColor:   'var(--la-accent)',
    borderColor: 'var(--la-accent)',
    bgColor:     'var(--la-accent-subtle)',
  },
  success: {
    iconName:    'check',
    iconColor:   'var(--la-success)',
    borderColor: 'var(--la-success)',
    bgColor:     'var(--la-success-subtle)',
  },
  warning: {
    iconName:    'info',
    iconColor:   '#FF9500',
    borderColor: '#FF9500',
    bgColor:     'rgba(255,149,0,0.12)',
  },
  error: {
    iconName:    'x',
    iconColor:   'var(--la-danger)',
    borderColor: 'var(--la-danger)',
    bgColor:     'var(--la-danger-subtle)',
  },
}

// ─────────────────────────────────────────────────────────
//  单条 ToastCard
// ─────────────────────────────────────────────────────────

interface ToastCardProps {
  toast:     ToastItem
  onClose:   (id: string) => void
}

const ToastCard = memo(function ToastCard({ toast, onClose }: ToastCardProps) {
  const cfg = VARIANT_CONFIG[toast.variant]

  const handleAction = useCallback(() => {
    toast.action?.onClick()
    onClose(toast.id)
  }, [toast, onClose])

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 64, scale: 0.96 }}
      animate={{ opacity: 1, x: 0,  scale: 1    }}
      exit={{
        opacity:   0,
        y:         8,
        scale:     0.96,
        transition: { duration: 0.18, ease: 'easeIn' },
      }}
      transition={{
        duration: 0.25,
        ease:     [0.2, 0, 0, 1],
      }}
      style={{
        display:         'flex',
        alignItems:      'flex-start',
        gap:             '10px',
        width:           '320px',
        maxWidth:        'calc(100vw - 32px)',
        padding:         '11px 12px',
        borderRadius:    'var(--la-radius-lg)',
        backgroundColor: 'var(--la-bg-raised)',
        border:          `1px solid ${cfg.borderColor}`,
        boxShadow:       'var(--la-shadow-overlay)',
        position:        'relative',
        overflow:        'hidden',
        cursor:          'default',
      }}
    >
      {/* 左侧色条 */}
      <div style={{
        position:        'absolute',
        left:            0,
        top:             0,
        bottom:          0,
        width:           '3px',
        backgroundColor: cfg.borderColor,
        borderRadius:    'var(--la-radius-lg) 0 0 var(--la-radius-lg)',
      }} />

      {/* 图标 */}
      <div style={{
        flexShrink:      0,
        display:         'flex',
        alignItems:      'center',
        justifyContent:  'center',
        width:           '22px',
        height:          '22px',
        borderRadius:    '50%',
        backgroundColor: cfg.bgColor,
        marginLeft:      '4px',   // 补偿左侧色条
      }}>
        <Icon name={cfg.iconName} size={13} color={cfg.iconColor} strokeWidth={2} />
      </div>

      {/* 文字区 */}
      <div style={{ flex: 1, minWidth: 0, paddingTop: '1px' }}>
        <p style={{
          fontSize:    'var(--la-text-sm)',
          color:       'var(--la-text-primary)',
          lineHeight:  'var(--la-leading-normal)',
          wordBreak:   'break-word',
          margin:      0,
        }}>
          {toast.message}
        </p>

        {/* Action 按钮 */}
        {toast.action && (
          <button
            onClick={handleAction}
            style={{
              marginTop:       '6px',
              fontSize:        'var(--la-text-xs)',
              color:           cfg.iconColor,
              fontWeight:      'var(--la-weight-medium)' as unknown as number,
              backgroundColor: 'transparent',
              border:          'none',
              padding:         '0',
              cursor:          'default',
              textDecoration:  'underline',
              textUnderlineOffset: '2px',
              transition:      'opacity 100ms ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.75' }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'    }}
          >
            {toast.action.label}
          </button>
        )}
      </div>

      {/* 关闭按钮 */}
      <button
        onClick={() => onClose(toast.id)}
        aria-label="关闭通知"
        style={{
          flexShrink:      0,
          display:         'flex',
          alignItems:      'center',
          justifyContent:  'center',
          width:           '20px',
          height:          '20px',
          borderRadius:    'var(--la-radius-sm)',
          backgroundColor: 'transparent',
          border:          'none',
          color:           'var(--la-text-tertiary)',
          cursor:          'default',
          transition:      'all 100ms ease',
          marginTop:       '1px',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = 'var(--la-bg-overlay)'
          e.currentTarget.style.color = 'var(--la-text-secondary)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent'
          e.currentTarget.style.color = 'var(--la-text-tertiary)'
        }}
      >
        <Icon name="x" size={12} strokeWidth={2} />
      </button>
    </motion.div>
  )
})

// ─────────────────────────────────────────────────────────
//  Toast — 主组件（Portal）
// ─────────────────────────────────────────────────────────

export function Toast() {
  const toasts      = useUiStore(selectToasts)
  const removeToast = useUiStore((s) => s.removeToast)

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      aria-live="polite"
      aria-label="通知区域"
      style={{
        position:      'fixed',
        bottom:        '16px',
        right:         '16px',
        display:       'flex',
        flexDirection: 'column-reverse',  // 新消息在底部出现，往上堆叠
        gap:           '8px',
        zIndex:        'var(--la-z-toast)' as unknown as number,
        pointerEvents: 'none',            // 容器不拦截鼠标事件
      }}
    >
      <AnimatePresence initial={false} mode="sync">
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{ pointerEvents: 'auto' }}  // 每个 card 独立响应鼠标
          >
            <ToastCard toast={t} onClose={removeToast} />
          </div>
        ))}
      </AnimatePresence>
    </div>,
    document.body,
  )
}
