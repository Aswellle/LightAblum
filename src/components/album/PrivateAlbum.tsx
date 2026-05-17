/**
 * @file src/components/album/PrivateAlbum.tsx
 * @description 私密相册 — 密码锁屏 + 创建向导（v3 — PinDot 颜色一致性修复）
 *
 * v3 修复：PinDot 填充圆点颜色深浅不一致
 *   根因：filled 圆点使用 `motion.div` + `initial={{ scale: 0 }}`。
 *   当用户连续输入多位数字时，不同时刻填入的格子其 spring 动画处于
 *   不同阶段（opacity/scale 插值中），视觉上颜色深浅参差不齐。
 *   memo() 缓存意味着已填格子不重新渲染，但 React key 变化或
 *   父组件重渲染会导致某些 motion.div 重置动画起始状态。
 *
 *   修复：将 filled 圆点改为普通 `<div>` + CSS `transition`，
 *   通过 `opacity: filled ? 1 : 0` + `transform: scale(filled ? 1 : 0.5)`
 *   实现确定性过渡。无 spring 动画，无 Framer Motion 状态，
 *   所有已填圆点在动画完成后呈现完全一致的颜色。
 *
 * 继承 v2 修复：
 *   - window.addEventListener('keydown') 代替隐藏 input（PIN 输入修复）
 *   - 遮罩点击不关闭向导（退出保护）
 */

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  memo,
} from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { createPortal } from 'react-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/tauriIpc'
import { Icon } from '@/components/common/Icon'
import { PhotoGrid } from '@/components/grid/PhotoGrid'
import { AlbumContext } from '@/components/album/AlbumView'
import { useUiStore, selectCurrentView } from '@/stores/uiStore'
import { toast } from '@/stores/uiStore'

// ─────────────────────────────────────────────────────────
//  PinDot — 单个 PIN 码格（v3：普通 div + CSS transition）
// ─────────────────────────────────────────────────────────

interface PinDotProps {
  filled:   boolean
  focused:  boolean
  hasError: boolean
}

const PinDot = memo(function PinDot({ filled, focused, hasError }: PinDotProps) {
  return (
    <div style={{
      width:           '52px',
      height:          '60px',
      borderRadius:    'var(--la-radius-lg)',
      border:          `1.5px solid ${
        hasError  ? 'var(--la-danger)'
        : focused ? 'var(--la-accent)'
        : filled  ? 'var(--la-border-strong)'
        :           'var(--la-border)'
      }`,
      backgroundColor: hasError
        ? 'var(--la-danger-subtle)'
        : focused
        ? 'var(--la-accent-subtle)'
        : 'var(--la-bg-overlay)',
      display:         'flex',
      alignItems:      'center',
      justifyContent:  'center',
      transition:      'border-color 150ms ease, background-color 150ms ease',
      flexShrink:      0,
    }}>
      {/* v3 修复：改用普通 div + CSS transition，消除 spring 动画导致的颜色不一致
          所有已填格子使用相同的确定性过渡，保证颜色完全一致 */}
      {filled ? (
        <div
          style={{
            width:            '11px',
            height:           '11px',
            borderRadius:     '50%',
            // 错误状态用 danger 色，正常状态用 text-primary（深色/浅色模式均正确）
            backgroundColor:  hasError ? 'var(--la-danger)' : 'var(--la-text-primary)',
            // CSS transform + opacity 过渡：GPU 合成，无 JS 计算
            opacity:          1,
            transform:        'scale(1)',
            transition:       'transform 150ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 120ms ease',
          }}
        />
      ) : focused ? (
        // 当前焦点：光标闪烁（保留 motion 动画）
        <motion.div
          animate={{ opacity: [1, 0, 1] }}
          transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
          style={{
            width:           '2px',
            height:          '26px',
            borderRadius:    '1px',
            backgroundColor: 'var(--la-accent)',
          }}
        />
      ) : (
        // 空格：隐藏但保持布局（保证填入动画从正确位置开始）
        <div
          style={{
            width:      '11px',
            height:     '11px',
            borderRadius: '50%',
            backgroundColor: 'var(--la-text-primary)',
            opacity:    0,
            transform:  'scale(0.5)',
            transition: 'transform 150ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 120ms ease',
          }}
        />
      )}
    </div>
  )
})

// ─────────────────────────────────────────────────────────
//  PinRow — 6 格一行
// ─────────────────────────────────────────────────────────

interface PinRowProps {
  digits:   string[]
  hasError: boolean
  shake:    boolean
}

function PinRow({ digits, hasError, shake }: PinRowProps) {
  const filledCount = digits.filter(Boolean).length
  return (
    <motion.div
      animate={shake ? { x: [-8, 8, -6, 6, -4, 4, 0] } : { x: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      style={{ display: 'flex', gap: '10px', alignItems: 'center' }}
    >
      {digits.map((d, i) => (
        <PinDot
          key={i}
          filled={!!d}
          focused={!hasError && i === filledCount}
          hasError={hasError}
        />
      ))}
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────
//  usePinInput — window 级键盘监听（v3 — albumId 隔离修复）
// ─────────────────────────────────────────────────────────
//
// v3 修复：跨私密相册 attempts/cooldown 互相污染
//   根因：AnimatePresence mode="sync" 在视图切换时，新旧两个
//   PasswordLockScreen 同时挂载（~120ms 过渡期）。两个实例都以
//   active=true 调用 usePinInput，注册了两个 window keydown 监听器，
//   同一次击键会触发两个 handleComplete 回调，导致：
//     - A 的正确密码同时触发 B 的 onUnlock（若密码相同）
//     - A 的错误计数影响 B 的 attempts 状态
//
//   修复方案：模块级 `activeAlbumToken` 变量（字符串 token）。
//   每次 usePinInput active=true 时，生成唯一 token 并写入该变量，
//   声明本实例为"当前活跃的 PIN 输入"。键盘事件触发时，
//   处理器先检查自己的 token 是否仍是最新的，不是则忽略该事件。
//   新实例激活时覆盖旧 token，旧实例的处理器自动失效。

/** 模块级：记录当前"有权处理键盘输入"的 PIN 实例 token */
let activeAlbumToken = ''

function usePinInput(
  active:    boolean,
  albumId:   string,
  digits:    string[],
  setDigits: React.Dispatch<React.SetStateAction<string[]>>,
  onComplete: (pin: string) => void,
) {
  // 使用 useRef 持久化本实例的 token，不触发重渲染
  const myToken = useRef('')

  useEffect(() => {
    if (!active) return

    // 声明本实例为当前活跃 PIN 输入（覆盖旧实例的 token）
    const token = `${albumId}-${Date.now()}`
    myToken.current    = token
    activeAlbumToken   = token

    const handler = (e: KeyboardEvent) => {
      // token 不匹配：另一个 PasswordLockScreen 已激活，忽略
      if (myToken.current !== activeAlbumToken) return

      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase()
      if (tag === 'input') {
        const inputEl = e.target as HTMLInputElement
        if (inputEl.dataset.pinIgnore !== 'true') return
      }

      if (e.key === 'Backspace') {
        setDigits((prev) => {
          const next = [...prev]
          const last = next.map((d, i) => (d ? i : -1)).filter((i) => i >= 0).pop()
          if (last !== undefined) next[last] = ''
          return next
        })
        e.preventDefault()
        return
      }

      if (!/^\d$/.test(e.key)) return
      e.preventDefault()

      setDigits((prev) => {
        const next = [...prev]
        const firstEmpty = next.findIndex((d) => !d)
        if (firstEmpty === -1) return prev
        next[firstEmpty] = e.key
        if (firstEmpty === 5) {
          setTimeout(() => onComplete(next.join('')), 0)
        }
        return next
      })
    }

    window.addEventListener('keydown', handler)
    return () => {
      window.removeEventListener('keydown', handler)
      // 本实例卸载时，若仍持有 token，释放它
      if (activeAlbumToken === myToken.current) activeAlbumToken = ''
    }
  }, [active, albumId, setDigits, onComplete])
}

// ─────────────────────────────────────────────────────────
//  PasswordLockScreen — 锁屏界面
// ─────────────────────────────────────────────────────────

interface PasswordLockScreenProps {
  albumId:   string
  albumName: string
  onUnlock:  () => void
  onBack:    () => void
}

export const PasswordLockScreen = memo(function PasswordLockScreen({
  albumId, albumName, onUnlock, onBack,
}: PasswordLockScreenProps) {
  const [digits, setDigits]       = useState(['', '', '', '', '', ''])
  const [shake, setShake]         = useState(false)
  const [hasError, setHasError]   = useState(false)
  const [errorMsg, setErrorMsg]   = useState<string | null>(null)
  const [attempts, setAttempts]   = useState(0)
  const [cooldown, setCooldown]   = useState(0)
  const [verifying, setVerifying] = useState(false)

  useEffect(() => {
    if (cooldown <= 0) return
    const id = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) { clearInterval(id); setAttempts(0); return 0 }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [cooldown])

  const resetPin = useCallback((withError?: string) => {
    setTimeout(() => {
      setDigits(['', '', '', '', '', ''])
      setHasError(false)
      setShake(false)
      if (withError) setErrorMsg(withError)
    }, 500)
  }, [])

  const handleComplete = useCallback(async (pin: string) => {
    if (verifying || cooldown > 0) return
    setVerifying(true)
    try {
      const ok = await api.albums.verifyPassword(albumId, pin)
      if (ok) {
        onUnlock()
      } else {
        const newAttempts = attempts + 1
        setAttempts(newAttempts)
        setHasError(true)
        setShake(true)
        if (newAttempts >= 3) {
          setCooldown(10)
          resetPin('连续错误次数过多，请等待冷却')
        } else {
          resetPin(`密码错误，还剩 ${3 - newAttempts} 次机会`)
        }
      }
    } catch {
      resetPin('验证失败，请重试')
    } finally {
      setVerifying(false)
    }
  }, [albumId, attempts, verifying, cooldown, onUnlock, resetPin])

  // v3：传入 albumId，让 token 机制按相册隔离键盘输入
  usePinInput(cooldown === 0 && !verifying, albumId, digits, setDigits, handleComplete)

  // v3：albumId 变化时（React 复用组件实例切换相册），重置所有状态
  // 防止 A 相册的 attempts/cooldown 残留影响 B 相册的解锁流程
  useEffect(() => {
    setDigits(['', '', '', '', '', ''])
    setHasError(false)
    setShake(false)
    setErrorMsg(null)
    setAttempts(0)
    setCooldown(0)
    setVerifying(false)
  }, [albumId])

  const isCooling = cooldown > 0

  return (
    <div style={{
      height:          '100%',
      display:         'flex',
      flexDirection:   'column',
      alignItems:      'center',
      justifyContent:  'center',
      backgroundColor: 'var(--la-bg-app)',
      position:        'relative',
      userSelect:      'none',
      overflow:        'hidden',
    }}>
      <button
        onClick={onBack}
        style={{
          position: 'absolute', top: '20px', left: '20px',
          display: 'flex', alignItems: 'center', gap: '4px',
          padding: '6px 12px 6px 8px', borderRadius: 'var(--la-radius-md)',
          backgroundColor: 'transparent', border: 'none',
          color: 'var(--la-accent)', fontSize: 'var(--la-text-sm)',
          cursor: 'default', transition: 'background-color 100ms ease',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--la-bg-hover)' }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
      >
        <Icon name="chevron-left" size={16} strokeWidth={2} />
        <span>返回</span>
      </button>

      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 400, damping: 28, delay: 0.05 }}
        style={{
          width: '80px', height: '80px', borderRadius: '22px',
          background: isCooling ? 'var(--la-bg-overlay)' : 'linear-gradient(145deg, #0A84FF 0%, #0055CC 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: '28px',
          boxShadow: isCooling ? 'none' : '0 12px 32px rgba(10,132,255,0.35)',
          transition: 'all 300ms ease',
        }}
      >
        <Icon
          name={isCooling ? 'x-circle' : 'lock'}
          size={36}
          color={isCooling ? 'var(--la-text-tertiary)' : '#fff'}
          strokeWidth={1.4}
        />
      </motion.div>

      <h1 style={{
        fontSize: 'var(--la-text-xl)', fontWeight: 'var(--la-weight-semibold)',
        color: 'var(--la-text-primary)', margin: '0 0 8px', textAlign: 'center',
        maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {albumName}
      </h1>

      <p style={{
        fontSize: 'var(--la-text-sm)', color: 'var(--la-text-tertiary)',
        margin: '0 0 40px', textAlign: 'center', lineHeight: '1.4',
      }}>
        {isCooling ? `尝试次数过多，请等待 ${cooldown} 秒` : verifying ? '验证中…' : '输入 6 位数字密码'}
      </p>

      <PinRow digits={digits} hasError={hasError} shake={shake} />

      <div style={{ height: '32px', marginTop: '16px', display: 'flex', alignItems: 'center' }}>
        <AnimatePresence mode="wait">
          {errorMsg && (
            <motion.p
              key={errorMsg}
              initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              style={{
                fontSize: 'var(--la-text-sm)',
                color: isCooling ? 'var(--la-text-secondary)' : 'var(--la-danger)',
                textAlign: 'center', margin: 0,
              }}
            >
              {errorMsg}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {verifying && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{
              marginTop: '12px', display: 'flex', alignItems: 'center',
              gap: '8px', color: 'var(--la-text-tertiary)', fontSize: 'var(--la-text-xs)',
            }}
          >
            <div style={{
              width: 12, height: 12,
              border: '1.5px solid var(--la-text-tertiary)',
              borderTopColor: 'transparent', borderRadius: '50%',
              animation: 'la-spin 0.7s linear infinite',
            }} />
            正在验证
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})

// ─────────────────────────────────────────────────────────
//  PrivateAlbumView — 带密码保护的相册容器
// ─────────────────────────────────────────────────────────

interface PrivateAlbumViewProps {
  albumId:     string
  albumName:   string
  hasPassword: boolean
}

export function PrivateAlbumView({ albumId, albumName, hasPassword }: PrivateAlbumViewProps) {
  const queryClient                     = useQueryClient()
  const [unlocked, setUnlocked]        = useState(!hasPassword)
  const setView                         = useUiStore((s) => s.setView)
  const currentView                     = useUiStore(selectCurrentView)
  // Fix: sync unlock state so StatusBar knows whether to show photo count
  const setPrivateAlbumUnlocked         = useUiStore((s) => s.setPrivateAlbumUnlocked)

  // Fix: removeFromAlbum for private album context
  const removeFromPrivateAlbumMutation = useMutation({
    mutationFn: (photoIds: string[]) => api.albums.removePhotos(albumId, photoIds),
    onSuccess: (_, photoIds) => {
      queryClient.invalidateQueries({ queryKey: ['photos'] })
      queryClient.invalidateQueries({ queryKey: ['album', albumId] })
      queryClient.invalidateQueries({ queryKey: ['albums'] })
      toast.success(`已从私密相册移出 ${photoIds.length} 张照片`)
    },
    onError: () => toast.error('移出失败'),
  })
  const handleRemoveFromPrivate = useCallback(
    (photoIds: string[]) => removeFromPrivateAlbumMutation.mutate(photoIds),
    [removeFromPrivateAlbumMutation],
  )

  // 离开该相册时立即上锁：只要当前视图不再是本相册，重置 unlocked 为 false
  // 修复：解锁 A 相册后导航到其他视图（或其他私密相册），再回来需重新验证
  useEffect(() => {
    const isHere = currentView.type === 'album' && currentView.albumId === albumId
    if (!isHere) {
      setUnlocked(false)
      // Fix: lock the uiStore flag too so StatusBar hides count
      setPrivateAlbumUnlocked(false)
    }
  }, [currentView, albumId, setPrivateAlbumUnlocked])

  // Fix: sync initial unlock state to uiStore (e.g. album has no password)
  useEffect(() => {
    setPrivateAlbumUnlocked(unlocked)
  }, [unlocked, setPrivateAlbumUnlocked])

  if (!unlocked) {
    return (
      <PasswordLockScreen
        albumId={albumId} albumName={albumName}
        onUnlock={() => {
          setUnlocked(true)
          // Fix: notify uiStore so StatusBar can show count
          setPrivateAlbumUnlocked(true)
        }}
        onBack={() => setView({ type: 'all_photos' })}
      />
    )
  }
  return (
    <AlbumContext.Provider value={{
      albumId,
      isPrivateAlbum:  true,
      removeFromAlbum: handleRemoveFromPrivate,
    }}>
      <PhotoGrid />
    </AlbumContext.Provider>
  )
}

// ─────────────────────────────────────────────────────────
//  StepIndicator
// ─────────────────────────────────────────────────────────

function StepIndicator({ currentStep, labels }: { currentStep: number; labels: string[] }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
      {labels.map((label, i) => {
        const done = i < currentStep, active = i === currentStep
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <div style={{
              width: '24px', height: '24px', borderRadius: '50%', flexShrink: 0,
              backgroundColor: done || active ? 'var(--la-accent)' : 'var(--la-bg-overlay)',
              border: `1.5px solid ${done || active ? 'var(--la-accent)' : 'var(--la-border)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 200ms ease',
            }}>
              {done
                ? <Icon name="check" size={12} color="#fff" strokeWidth={2.5} />
                : <span style={{ fontSize: '11px', fontWeight: 'var(--la-weight-semibold)', color: active ? '#fff' : 'var(--la-text-tertiary)' }}>{i + 1}</span>
              }
            </div>
            <span style={{
              fontSize: '12px',
              color: active ? 'var(--la-text-primary)' : done ? 'var(--la-text-secondary)' : 'var(--la-text-tertiary)',
              fontWeight: active ? 'var(--la-weight-medium)' : 'var(--la-weight-regular)',
              transition: 'color 200ms ease', whiteSpace: 'nowrap',
            }}>
              {label}
            </span>
            {i < labels.length - 1 && (
              <div style={{
                width: '20px', height: '1.5px',
                backgroundColor: i < currentStep ? 'var(--la-accent)' : 'var(--la-border)',
                transition: 'background-color 200ms ease', marginLeft: '4px', flexShrink: 0,
              }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────
//  CreatePrivateAlbumDialog — 三步创建向导（v3）
// ─────────────────────────────────────────────────────────

interface CreatePrivateAlbumDialogProps {
  onClose:   () => void
  onCreated: (albumId: string) => void
}

type WizardStep = 'name' | 'password' | 'confirm'

export const CreatePrivateAlbumDialog = memo(function CreatePrivateAlbumDialog({
  onClose, onCreated,
}: CreatePrivateAlbumDialogProps) {
  const [step, setStep]             = useState<WizardStep>('name')
  const [albumName, setAlbumName]   = useState('私密相册')
  const [password, setPassword]     = useState(['', '', '', '', '', ''])
  const [confirmPin, setConfirmPin] = useState(['', '', '', '', '', ''])
  const [nameError, setNameError]   = useState<string | null>(null)
  const [pinError, setPinError]     = useState<string | null>(null)
  const [pwShake, setPwShake]       = useState(false)
  const [cfShake, setCfShake]       = useState(false)
  const [creating, setCreating]     = useState(false)
  const nameInputRef                = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (step === 'name') {
      setTimeout(() => nameInputRef.current?.focus(), 80)
    }
  }, [step])

  const handlePasswordComplete = useCallback((_pin: string) => {
    setConfirmPin(['', '', '', '', '', ''])
    setPinError(null)
    setStep('confirm')
  }, [])

  const handleConfirmComplete = useCallback((pin: string) => {
    const pw = password.join('')
    if (pin !== pw) {
      setPinError('两次密码不一致，请重试')
      setCfShake(true)
      setTimeout(() => {
        setConfirmPin(['', '', '', '', '', ''])
        setCfShake(false)
        setPinError(null)
      }, 600)
    }
  }, [password])

  usePinInput(step === 'password', 'wizard-pw', password, setPassword, handlePasswordComplete)
  usePinInput(step === 'confirm', 'wizard-cf', confirmPin, setConfirmPin, handleConfirmComplete)

  const handleCreate = useCallback(async () => {
    const name = albumName.trim()
    if (!name) { setNameError('请输入相册名称'); return }
    const pw = password.join('')
    const cf = confirmPin.join('')
    if (pw.length !== 6) { setStep('password'); return }
    if (pw !== cf) { setPinError('两次密码不一致'); return }
    setCreating(true)
    try {
      const album = await api.albums.createPrivate(name, pw)
      onCreated(album.id)
      onClose()
    } catch {
      setPinError('创建失败，请重试')
    } finally {
      setCreating(false)
    }
  }, [albumName, password, confirmPin, onCreated, onClose])

  const pwFilled    = password.every(Boolean)
  const cfFilled    = confirmPin.every(Boolean)
  const cfMatchesPw = cfFilled && confirmPin.join('') === password.join('')
  const canCreate   = pwFilled && cfMatchesPw && !pinError

  const stepLabels = ['相册名称', '设置密码', '确认密码']
  const stepIndex  = step === 'name' ? 0 : step === 'password' ? 1 : 2

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="create-private-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        // v2 保留：遮罩点击不关闭向导
        style={{
          position: 'fixed', inset: 0,
          zIndex: 'var(--la-z-modal)' as unknown as number,
          backgroundColor: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
        }}
      >
        <motion.div
          key="create-private-dialog"
          initial={{ opacity: 0, scale: 0.94, y: 12 }}
          animate={{ opacity: 1, scale: 1,    y: 0  }}
          exit={{   opacity: 0, scale: 0.94, y: 12  }}
          transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
          style={{
            width: '400px',
            backgroundColor: 'var(--la-bg-raised)',
            borderRadius: 'var(--la-radius-xl)',
            border: '1px solid var(--la-border)',
            boxShadow: 'var(--la-shadow-overlay)',
            overflow: 'hidden',
          }}
        >
          {/* 顶部蓝色 Header */}
          <div style={{
            background: 'linear-gradient(160deg, #0A84FF 0%, #0055CC 100%)',
            padding: '28px 28px 24px', textAlign: 'center',
          }}>
            <div style={{
              width: '60px', height: '60px', borderRadius: '17px',
              backgroundColor: 'rgba(255,255,255,0.18)',
              border: '1px solid rgba(255,255,255,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 14px',
            }}>
              <Icon name="shield" size={28} color="#fff" strokeWidth={1.4} />
            </div>
            <h2 style={{
              fontSize: 'var(--la-text-lg)', fontWeight: 'var(--la-weight-semibold)',
              color: '#fff', margin: '0 0 6px',
            }}>
              新建私密相册
            </h2>
            <p style={{ fontSize: 'var(--la-text-xs)', color: 'rgba(255,255,255,0.7)', margin: 0 }}>
              需要密码才能查看其中的照片
            </p>
          </div>

          {/* 内容区 */}
          <div style={{ padding: '24px 28px 28px' }}>

            {/* 步骤指示器 */}
            <div style={{ marginBottom: '24px' }}>
              <StepIndicator currentStep={stepIndex} labels={stepLabels} />
            </div>

            {/* 步骤内容 */}
            <div style={{ minHeight: '140px', position: 'relative' }}>
              <AnimatePresence mode="wait">

                {/* 步骤1：相册名称 */}
                {step === 'name' && (
                  <motion.div
                    key="step-name"
                    initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}
                  >
                    <label style={{
                      display: 'block', fontSize: 'var(--la-text-xs)',
                      color: 'var(--la-text-tertiary)', marginBottom: '8px',
                      letterSpacing: '0.04em', textTransform: 'uppercase',
                    }}>
                      相册名称
                    </label>
                    <input
                      ref={nameInputRef}
                      type="text"
                      data-pin-ignore="true"
                      value={albumName}
                      onChange={(e) => { setAlbumName(e.target.value); setNameError(null) }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && albumName.trim()) {
                          e.preventDefault(); setStep('password')
                        }
                      }}
                      maxLength={32}
                      placeholder="为私密相册取一个名字"
                      style={{
                        width: '100%', height: '44px', padding: '0 14px',
                        borderRadius: 'var(--la-radius-md)',
                        backgroundColor: 'var(--la-bg-overlay)',
                        border: `1.5px solid ${nameError ? 'var(--la-danger)' : 'var(--la-border)'}`,
                        color: 'var(--la-text-primary)', fontSize: 'var(--la-text-sm)',
                        outline: 'none', userSelect: 'text',
                        transition: 'border-color 150ms ease', boxSizing: 'border-box',
                      }}
                      onFocus={(e) => { if (!nameError) e.currentTarget.style.borderColor = 'var(--la-accent)' }}
                      onBlur={(e)  => { e.currentTarget.style.borderColor = nameError ? 'var(--la-danger)' : 'var(--la-border)' }}
                    />
                    {nameError && (
                      <p style={{ fontSize: 'var(--la-text-xs)', color: 'var(--la-danger)', margin: '6px 0 0' }}>
                        {nameError}
                      </p>
                    )}
                    <div style={{
                      display: 'flex', alignItems: 'flex-start', gap: '8px', marginTop: '16px',
                      padding: '10px 12px', borderRadius: 'var(--la-radius-md)',
                      backgroundColor: 'var(--la-accent-subtle)',
                      border: '1px solid rgba(10,132,255,0.2)',
                    }}>
                      <Icon name="info" size={14} color="var(--la-accent)" style={{ marginTop: '1px', flexShrink: 0 }} />
                      <p style={{
                        fontSize: 'var(--la-text-xs)', color: 'var(--la-text-secondary)',
                        margin: 0, lineHeight: '1.5',
                      }}>
                        私密相册中的照片不会出现在「所有照片」等其他视图中，只有输入正确密码才能查看。
                      </p>
                    </div>
                  </motion.div>
                )}

                {/* 步骤2：设置密码 */}
                {step === 'password' && (
                  <motion.div
                    key="step-password"
                    initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}
                  >
                    <p style={{
                      fontSize: 'var(--la-text-sm)', color: 'var(--la-text-secondary)',
                      textAlign: 'center', margin: '0 0 20px',
                    }}>
                      设置 6 位数字密码
                    </p>
                    <PinRow digits={password} hasError={false} shake={pwShake} />
                    <p style={{
                      fontSize: 'var(--la-text-xs)', color: 'var(--la-text-tertiary)',
                      textAlign: 'center', margin: '16px 0 0',
                    }}>
                      请记住您的密码，忘记后将无法恢复
                    </p>
                    <p style={{
                      fontSize: '11px', color: 'var(--la-accent)',
                      textAlign: 'center', margin: '10px 0 0', opacity: 0.8,
                    }}>
                      直接在键盘上输入数字即可
                    </p>
                  </motion.div>
                )}

                {/* 步骤3：确认密码 */}
                {step === 'confirm' && (
                  <motion.div
                    key="step-confirm"
                    initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}
                  >
                    <p style={{
                      fontSize: 'var(--la-text-sm)', color: 'var(--la-text-secondary)',
                      textAlign: 'center', margin: '0 0 20px',
                    }}>
                      再次输入密码确认
                    </p>
                    <PinRow digits={confirmPin} hasError={!!pinError} shake={cfShake} />
                    <div style={{ height: '28px', marginTop: '12px', display: 'flex', alignItems: 'center' }}>
                      <AnimatePresence mode="wait">
                        {pinError && (
                          <motion.p
                            key={pinError}
                            initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
                            style={{
                              fontSize: 'var(--la-text-xs)', color: 'var(--la-danger)',
                              margin: 0, textAlign: 'center',
                            }}
                          >
                            {pinError}
                          </motion.p>
                        )}
                      </AnimatePresence>
                    </div>
                    {!pinError && (
                      <p style={{
                        fontSize: '11px', color: 'var(--la-accent)',
                        textAlign: 'center', margin: '4px 0 0', opacity: 0.8,
                      }}>
                        直接在键盘上输入数字即可
                      </p>
                    )}
                  </motion.div>
                )}

              </AnimatePresence>
            </div>

            {/* 操作按钮 */}
            <div style={{ display: 'flex', gap: '10px', marginTop: '24px' }}>
              {/* 取消 / 上一步 */}
              <button
                onClick={() => {
                  if (step === 'name') { onClose() }
                  if (step === 'password') { setStep('name') }
                  if (step === 'confirm') {
                    setConfirmPin(['', '', '', '', '', ''])
                    setPinError(null)
                    setStep('password')
                  }
                }}
                style={{
                  flex: 1, height: '40px', borderRadius: 'var(--la-radius-md)',
                  backgroundColor: 'var(--la-bg-overlay)',
                  border: '1px solid var(--la-border)',
                  color: 'var(--la-text-secondary)', fontSize: 'var(--la-text-sm)',
                  cursor: 'default', transition: 'all 100ms ease',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--la-bg-hover)'; e.currentTarget.style.color = 'var(--la-text-primary)' }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--la-bg-overlay)'; e.currentTarget.style.color = 'var(--la-text-secondary)' }}
              >
                {step === 'name' ? '取消' : '上一步'}
              </button>

              {/* 步骤1 → 下一步 */}
              {step === 'name' && (
                <button
                  onClick={() => { if (!albumName.trim()) { setNameError('请输入相册名称'); return } setStep('password') }}
                  style={{
                    flex: 1, height: '40px', borderRadius: 'var(--la-radius-md)',
                    backgroundColor: albumName.trim() ? 'var(--la-accent)' : 'var(--la-text-disabled)',
                    border: 'none', color: '#fff',
                    fontSize: 'var(--la-text-sm)', fontWeight: 'var(--la-weight-medium)',
                    cursor: albumName.trim() ? 'default' : 'not-allowed',
                    transition: 'background-color 100ms ease',
                  }}
                  onMouseEnter={(e) => { if (albumName.trim()) e.currentTarget.style.backgroundColor = 'var(--la-accent-hover)' }}
                  onMouseLeave={(e) => { if (albumName.trim()) e.currentTarget.style.backgroundColor = 'var(--la-accent)' }}
                >
                  下一步
                </button>
              )}

              {/* 步骤2 → 下一步 */}
              {step === 'password' && (
                <button
                  onClick={() => {
                    if (pwFilled) {
                      setConfirmPin(['', '', '', '', '', ''])
                      setPinError(null)
                      setStep('confirm')
                    }
                  }}
                  disabled={!pwFilled}
                  style={{
                    flex: 1, height: '40px', borderRadius: 'var(--la-radius-md)',
                    backgroundColor: pwFilled ? 'var(--la-accent)' : 'var(--la-text-disabled)',
                    border: 'none', color: '#fff',
                    fontSize: 'var(--la-text-sm)', fontWeight: 'var(--la-weight-medium)',
                    cursor: pwFilled ? 'default' : 'not-allowed',
                    transition: 'background-color 100ms ease',
                  }}
                  onMouseEnter={(e) => { if (pwFilled) e.currentTarget.style.backgroundColor = 'var(--la-accent-hover)' }}
                  onMouseLeave={(e) => { if (pwFilled) e.currentTarget.style.backgroundColor = pwFilled ? 'var(--la-accent)' : 'var(--la-text-disabled)' }}
                >
                  下一步
                </button>
              )}

              {/* 步骤3 → 创建 */}
              {step === 'confirm' && (
                <button
                  onClick={handleCreate}
                  disabled={!canCreate || creating}
                  style={{
                    flex: 1, height: '40px', borderRadius: 'var(--la-radius-md)',
                    backgroundColor: canCreate ? 'var(--la-accent)' : 'var(--la-text-disabled)',
                    border: 'none', color: '#fff',
                    fontSize: 'var(--la-text-sm)', fontWeight: 'var(--la-weight-medium)',
                    cursor: canCreate && !creating ? 'default' : 'not-allowed',
                    opacity: creating ? 0.7 : 1, transition: 'all 100ms ease',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px',
                  }}
                  onMouseEnter={(e) => { if (canCreate && !creating) e.currentTarget.style.backgroundColor = 'var(--la-accent-hover)' }}
                  onMouseLeave={(e) => { if (canCreate && !creating) e.currentTarget.style.backgroundColor = 'var(--la-accent)' }}
                >
                  {creating ? (
                    <>
                      <div style={{
                        width: 13, height: 13,
                        border: '2px solid rgba(255,255,255,0.5)',
                        borderTopColor: '#fff', borderRadius: '50%',
                        animation: 'la-spin 0.7s linear infinite',
                      }} />
                      创建中…
                    </>
                  ) : (
                    <>
                      <Icon name="lock" size={14} color="#fff" />
                      创建私密相册
                    </>
                  )}
                </button>
              )}
            </div>

          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  )
})
