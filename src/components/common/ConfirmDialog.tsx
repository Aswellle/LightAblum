/**
 * @file src/components/common/ConfirmDialog.tsx
 * @description 通用二次确认弹窗
 *
 * 适用场景：
 *   - 删除照片（danger 变体，红色确认按钮）
 *   - 从库中移除文件夹
 *   - 永久删除（double-confirm 模式，需输入确认词）
 *   - 普通确认（default 变体，蓝色确认按钮）
 *
 * 使用方式（推荐：通过 useConfirmDialog hook）：
 *
 *   const confirm = useConfirmDialog()
 *
 *   // 在事件处理中：
 *   const confirmed = await confirm({
 *     title:   '删除照片',
 *     message: '将移入回收站，30 天后自动清理',
 *     confirmLabel: '删除',
 *     variant: 'danger',
 *   })
 *   if (confirmed) doDelete()
 *
 * 或直接受控使用：
 *   <ConfirmDialog
 *     open={open}
 *     title="删除相册"
 *     message="相册将被删除，照片不受影响"
 *     confirmLabel="删除"
 *     variant="danger"
 *     onConfirm={() => deleteAlbum()}
 *     onCancel={() => setOpen(false)}
 *   />
 *
 * 动画：
 *   - 遮罩：opacity 0→1，150ms
 *   - 弹窗：scale 0.95 + y 8px → scale 1 + y 0，180ms Apple ease
 *   - 退出：scale 0.95 + opacity 0，120ms
 */

import {
  useEffect,
  useRef,
  useCallback,
  useState,
  createContext,
  useContext,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Icon } from '@/components/common/Icon'
import type { IconName } from '@/components/common/Icon'

// ─────────────────────────────────────────────────────────
//  类型
// ─────────────────────────────────────────────────────────

export type ConfirmVariant = 'default' | 'danger' | 'warning'

export interface ConfirmDialogOptions {
  title:          string
  message?:       string | ReactNode
  confirmLabel?:  string
  cancelLabel?:   string
  variant?:       ConfirmVariant
  /** 展示详情（可折叠的灰色小字） */
  detail?:        string
}

interface ConfirmDialogProps extends ConfirmDialogOptions {
  open:       boolean
  onConfirm:  () => void
  onCancel:   () => void
  loading?:   boolean
}

// ─────────────────────────────────────────────────────────
//  变体配置
// ─────────────────────────────────────────────────────────

interface DialogVariantConfig {
  iconName:    IconName
  iconColor:   string
  iconBg:      string
  confirmBg:   string
  confirmHover:string
  confirmColor:string
}

const DIALOG_VARIANTS: Record<ConfirmVariant, DialogVariantConfig> = {
  default: {
    iconName:     'info',
    iconColor:    'var(--la-accent)',
    iconBg:       'var(--la-accent-subtle)',
    confirmBg:    'var(--la-accent)',
    confirmHover: 'var(--la-accent-hover)',
    confirmColor: '#fff',
  },
  danger: {
    iconName:     'trash',
    iconColor:    'var(--la-danger)',
    iconBg:       'var(--la-danger-subtle)',
    confirmBg:    'var(--la-danger)',
    confirmHover: '#E03030',
    confirmColor: '#fff',
  },
  warning: {
    iconName:     'info',
    iconColor:    '#FF9500',
    iconBg:       'rgba(255,149,0,0.12)',
    confirmBg:    '#FF9500',
    confirmHover: '#E08500',
    confirmColor: '#fff',
  },
}

// ─────────────────────────────────────────────────────────
//  ConfirmDialog — 受控组件
// ─────────────────────────────────────────────────────────

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '确认',
  cancelLabel  = '取消',
  variant      = 'default',
  detail,
  onConfirm,
  onCancel,
  loading      = false,
}: ConfirmDialogProps) {
  const cfg        = DIALOG_VARIANTS[variant]
  const confirmRef = useRef<HTMLButtonElement>(null)

  // 打开时聚焦确认按钮（使 Enter 键可直接确认）
  useEffect(() => {
    if (open) {
      setTimeout(() => confirmRef.current?.focus(), 50)
    }
  }, [open])

  // Esc 关闭
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onCancel])

  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          {/* 遮罩 */}
          <motion.div
            key="overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{    opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onCancel}
            style={{
              position:        'fixed',
              inset:           0,
              backgroundColor: 'rgba(0,0,0,0.55)',
              zIndex:          'var(--la-z-modal)' as unknown as number,
            }}
          />

          {/* 弹窗 */}
          <motion.div
            key="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            initial={{ opacity: 0, scale: 0.95, y: 8  }}
            animate={{ opacity: 1, scale: 1,    y: 0  }}
            exit={{    opacity: 0, scale: 0.95, y: 8,
              transition: { duration: 0.12 },
            }}
            transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
            onClick={(e) => e.stopPropagation()}
            style={{
              position:        'fixed',
              top:             '50%',
              left:            '50%',
              transform:       'translate(-50%, -50%)',
              width:           '360px',
              maxWidth:        'calc(100vw - 32px)',
              backgroundColor: 'var(--la-bg-raised)',
              borderRadius:    'var(--la-radius-lg)',
              border:          '1px solid var(--la-border)',
              boxShadow:       'var(--la-shadow-overlay)',
              zIndex:          ('calc(var(--la-z-modal) + 1)') as unknown as number,
              overflow:        'hidden',
            }}
          >
            {/* 内容区 */}
            <div style={{ padding: '20px 20px 16px' }}>
              {/* 图标 + 标题行 */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                {/* 变体图标 */}
                <div style={{
                  flexShrink:      0,
                  display:         'flex',
                  alignItems:      'center',
                  justifyContent:  'center',
                  width:           '36px',
                  height:          '36px',
                  borderRadius:    '50%',
                  backgroundColor: cfg.iconBg,
                  marginTop:       '1px',
                }}>
                  <Icon name={cfg.iconName} size={18} color={cfg.iconColor} />
                </div>

                {/* 标题 + 描述 */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h2
                    id="confirm-title"
                    style={{
                      fontSize:     'var(--la-text-base)',
                      fontWeight:   'var(--la-weight-semibold)' as unknown as number,
                      color:        'var(--la-text-primary)',
                      margin:       0,
                      lineHeight:   'var(--la-leading-tight)',
                    }}
                  >
                    {title}
                  </h2>

                  {message && (
                    <p style={{
                      marginTop:   '6px',
                      fontSize:    'var(--la-text-sm)',
                      color:       'var(--la-text-secondary)',
                      lineHeight:  'var(--la-leading-normal)',
                      margin:      '6px 0 0',
                    }}>
                      {message}
                    </p>
                  )}

                  {detail && (
                    <p style={{
                      marginTop:   '6px',
                      fontSize:    'var(--la-text-xs)',
                      color:       'var(--la-text-tertiary)',
                      lineHeight:  'var(--la-leading-relaxed)',
                      margin:      '6px 0 0',
                    }}>
                      {detail}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* 分隔线 */}
            <div style={{
              height:          '1px',
              backgroundColor: 'var(--la-divider)',
              margin:          '0',
            }} />

            {/* 按钮区 */}
            <div style={{
              display:        'flex',
              justifyContent: 'flex-end',
              gap:            '8px',
              padding:        '12px 16px',
              backgroundColor:'var(--la-bg-overlay)',
            }}>
              {/* 取消 */}
              <button
                onClick={onCancel}
                disabled={loading}
                style={{
                  padding:         '7px 16px',
                  borderRadius:    'var(--la-radius-md)',
                  fontSize:        'var(--la-text-sm)',
                  fontWeight:      'var(--la-weight-medium)' as unknown as number,
                  color:           'var(--la-text-secondary)',
                  backgroundColor: 'transparent',
                  border:          '1px solid var(--la-border)',
                  cursor:          'default',
                  transition:      'all 100ms ease',
                  opacity:         loading ? 0.5 : 1,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--la-bg-hover)'
                  e.currentTarget.style.color = 'var(--la-text-primary)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent'
                  e.currentTarget.style.color = 'var(--la-text-secondary)'
                }}
              >
                {cancelLabel}
              </button>

              {/* 确认 */}
              <button
                ref={confirmRef}
                onClick={onConfirm}
                disabled={loading}
                style={{
                  padding:         '7px 16px',
                  borderRadius:    'var(--la-radius-md)',
                  fontSize:        'var(--la-text-sm)',
                  fontWeight:      'var(--la-weight-medium)' as unknown as number,
                  color:           cfg.confirmColor,
                  backgroundColor: cfg.confirmBg,
                  border:          'none',
                  cursor:          loading ? 'wait' : 'default',
                  transition:      'background-color 100ms ease',
                  opacity:         loading ? 0.75 : 1,
                  minWidth:        '72px',
                }}
                onMouseEnter={(e) => {
                  if (!loading) e.currentTarget.style.backgroundColor = cfg.confirmHover
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = cfg.confirmBg
                }}
              >
                {loading ? '处理中…' : confirmLabel}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  )
}

// ─────────────────────────────────────────────────────────
//  useConfirmDialog — 命令式调用 hook
//  返回一个 Promise<boolean>，业务代码无需管理 open 状态
// ─────────────────────────────────────────────────────────

interface ConfirmState extends ConfirmDialogOptions {
  resolve: (value: boolean) => void
}

const ConfirmContext = createContext<{
  confirm: (opts: ConfirmDialogOptions) => Promise<boolean>
} | null>(null)

/**
 * ConfirmDialogProvider — 挂载在 App 层，提供命令式 confirm()
 *
 * @example
 * // App.tsx：
 * <ConfirmDialogProvider>
 *   <AppContent />
 * </ConfirmDialogProvider>
 *
 * // 在任意组件中：
 * const confirm = useConfirmDialog()
 * const ok = await confirm({ title: '删除？', variant: 'danger' })
 */
export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null)
  const [loading, setLoading] = useState(false)

  const confirm = useCallback((opts: ConfirmDialogOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({ ...opts, resolve })
    })
  }, [])

  const handleConfirm = useCallback(() => {
    setLoading(true)
    // 给调用方一帧来处理 async 操作，然后关闭
    state?.resolve(true)
    // 延迟清理，等 exit 动画完成
    setTimeout(() => {
      setState(null)
      setLoading(false)
    }, 200)
  }, [state])

  const handleCancel = useCallback(() => {
    state?.resolve(false)
    setState(null)
    setLoading(false)
  }, [state])

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      <ConfirmDialog
        open={state !== null}
        title={state?.title ?? ''}
        message={state?.message}
        confirmLabel={state?.confirmLabel}
        cancelLabel={state?.cancelLabel}
        variant={state?.variant}
        detail={state?.detail}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
        loading={loading}
      />
    </ConfirmContext.Provider>
  )
}

/**
 * 命令式确认弹窗 hook
 *
 * @example
 * const confirm = useConfirmDialog()
 *
 * async function handleDelete() {
 *   const ok = await confirm({
 *     title:        '删除 3 张照片',
 *     message:      '照片将移入回收站，30 天后自动清理。',
 *     confirmLabel: '删除',
 *     variant:      'danger',
 *   })
 *   if (ok) await api.photos.delete(selectedIds)
 * }
 */
export function useConfirmDialog() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) {
    throw new Error('useConfirmDialog must be used within <ConfirmDialogProvider>')
  }
  return ctx.confirm
}
