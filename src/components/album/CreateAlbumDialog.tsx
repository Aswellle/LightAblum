/**
 * @file src/components/album/CreateAlbumDialog.tsx
 * @description 新建相册对话框（v2 — 支持 onCreated 回调，用于「新建并加入」场景）
 *
 * v2 变更：
 *   新增可选 prop：onCreated?: (albumId: string) => void
 *   - 未提供 onCreated（原有用法）：创建成功后跳转到新相册视图（行为不变）
 *   - 提供 onCreated（BatchActionBar「新建相册并加入」场景）：
 *     创建成功后调用 onCreated(albumId)，由调用方负责后续操作
 *     （将已选照片加入新相册），不自动跳转视图
 */

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { api } from '@/services/tauriIpc'
import { useUiStore } from '@/stores/uiStore'
import { Icon } from '@/components/common/Icon'

interface CreateAlbumDialogProps {
  onClose:     () => void
  /** 可选：创建成功后调用，参数为新相册 ID。提供此回调时不自动跳转视图 */
  onCreated?:  (albumId: string) => void
}

export function CreateAlbumDialog({ onClose, onCreated }: CreateAlbumDialogProps) {
  const [name, setName]  = useState('')
  const inputRef         = useRef<HTMLInputElement>(null)
  const queryClient      = useQueryClient()
  const setView          = useUiStore((s) => s.setView)

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const { mutate, isPending } = useMutation({
    mutationFn: () => api.albums.create(name.trim()),
    onSuccess: (album) => {
      queryClient.invalidateQueries({ queryKey: ['albums'] })
      if (onCreated) {
        // 「新建并加入」场景：通知调用方，不跳转视图
        onCreated(album.id)
      } else {
        // 普通「新建相册」场景：跳转到新相册视图
        setView({ type: 'album', albumId: album.id })
      }
      onClose()
    },
  })

  const canSubmit = name.trim().length > 0 && !isPending

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 'var(--la-z-modal)', backgroundColor: 'rgba(0,0,0,0.55)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1,    y: 0 }}
        exit={{   opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
        style={{
          width:           '320px',
          backgroundColor: 'var(--la-bg-raised)',
          borderRadius:    'var(--la-radius-lg)',
          border:          '1px solid var(--la-border)',
          boxShadow:       'var(--la-shadow-overlay)',
          padding:         '20px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{
          fontSize: 'var(--la-text-base)', fontWeight: 'var(--la-weight-semibold)',
          color: 'var(--la-text-primary)', marginBottom: '16px',
        }}>
          {onCreated ? '新建相册并加入' : '新建相册'}
        </h2>

        <input
          ref={inputRef} type="text" value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit) mutate() }}
          placeholder="相册名称" maxLength={64}
          style={{
            width: '100%', backgroundColor: 'var(--la-bg-overlay)',
            border: '1px solid var(--la-border)', borderRadius: 'var(--la-radius-md)',
            padding: '8px 12px', fontSize: 'var(--la-text-sm)', color: 'var(--la-text-primary)',
            outline: 'none', transition: 'border-color 150ms ease', userSelect: 'text',
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--la-accent)' }}
          onBlur={(e)  => { e.currentTarget.style.borderColor = 'var(--la-border)' }}
        />

        {onCreated && (
          <p style={{ fontSize: 'var(--la-text-xs)', color: 'var(--la-text-tertiary)', marginTop: '8px' }}>
            创建后将自动把已选照片加入此相册
          </p>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
          <button
            onClick={onClose}
            style={{
              padding: '6px 14px', borderRadius: 'var(--la-radius-md)',
              fontSize: 'var(--la-text-sm)', color: 'var(--la-text-secondary)',
              backgroundColor: 'transparent', border: '1px solid var(--la-border)',
              cursor: 'default', transition: 'all 100ms ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--la-bg-hover)'; e.currentTarget.style.color = 'var(--la-text-primary)' }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--la-text-secondary)' }}
          >
            取消
          </button>
          <button
            onClick={() => canSubmit && mutate()} disabled={!canSubmit}
            style={{
              padding: '6px 16px', borderRadius: 'var(--la-radius-md)',
              fontSize: 'var(--la-text-sm)', fontWeight: 'var(--la-weight-medium)',
              color: '#fff',
              backgroundColor: canSubmit ? 'var(--la-accent)' : 'var(--la-text-disabled)',
              border: 'none', cursor: canSubmit ? 'default' : 'not-allowed',
              transition: 'background-color 100ms ease',
            }}
            onMouseEnter={(e) => { if (canSubmit) e.currentTarget.style.backgroundColor = 'var(--la-accent-hover)' }}
            onMouseLeave={(e) => { if (canSubmit) e.currentTarget.style.backgroundColor = 'var(--la-accent)' }}
          >
            {isPending ? '创建中…' : '创建'}
          </button>
        </div>
      </motion.div>
    </div>,
    document.body,
  )
}
