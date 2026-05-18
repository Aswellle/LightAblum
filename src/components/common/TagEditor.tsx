/**
 * @file src/components/common/TagEditor.tsx
 * @description 照片标签管理弹窗（Phase-B M-12 | Fix: 弹窗样式对齐项目 token 系统）
 *
 * 功能：
 *   - 展示照片已有标签（带移除按钮）
 *   - 展示所有可选标签，点击切换勾选
 *   - 快捷创建新标签（输入名称 + 选颜色）
 *   - 确认后批量写入 photo_tags
 *
 * 使用方式：
 *   const openTagEditor = useTagEditor()
 *   // 在右键菜单 / 工具栏中：
 *   await openTagEditor(photoId)
 *
 * 通过 Context + Portal 实现全局单例，避免多处挂载。
 */

import {
  useState,
  useCallback,
  useRef,
  useEffect,
  createContext,
  useContext,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/tauriIpc'
import { TagBadge } from './TagBadge'
import type { Tag } from '@/types/ipc'
import { TAG_PRESET_COLORS, type TagColor } from '@/types/album'

// ─────────────────────────────────────────────────────────
//  Context
// ─────────────────────────────────────────────────────────

type OpenTagEditor = (photoId: string) => void

const TagEditorContext = createContext<OpenTagEditor>(() => {})

export function useTagEditor(): OpenTagEditor {
  return useContext(TagEditorContext)
}

// ─────────────────────────────────────────────────────────
//  Provider（挂载在 App 根部）
// ─────────────────────────────────────────────────────────

export function TagEditorProvider({ children }: { children: ReactNode }) {
  const [photoId, setPhotoId] = useState<string | null>(null)

  const openEditor = useCallback((id: string) => setPhotoId(id), [])
  const closeEditor = useCallback(() => setPhotoId(null), [])

  return (
    <TagEditorContext.Provider value={openEditor}>
      {children}
      {createPortal(
        <AnimatePresence>
          {photoId && (
            <TagEditorDialog
              key={photoId}
              photoId={photoId}
              onClose={closeEditor}
            />
          )}
        </AnimatePresence>,
        document.body,
      )}
    </TagEditorContext.Provider>
  )
}

// ─────────────────────────────────────────────────────────
//  TagEditorDialog — 实际弹窗内容
// ─────────────────────────────────────────────────────────

interface TagEditorDialogProps {
  photoId: string
  onClose: () => void
}

function TagEditorDialog({ photoId, onClose }: TagEditorDialogProps) {
  const queryClient = useQueryClient()
  const inputRef    = useRef<HTMLInputElement>(null)

  // 所有标签
  const { data: allTags = [] } = useQuery<Tag[]>({
    queryKey: ['tags'],
    queryFn:  () => api.tags.list(),
    staleTime: 60_000,
  })

  // 照片当前标签
  const { data: photoTags = [] } = useQuery<Tag[]>({
    queryKey: ['photo-tags', photoId],
    queryFn:  () => api.tags.getForPhoto(photoId),
  })

  // 临时选中集合（初始化为照片当前标签）
  // Fix 2b: 只初始化一次，防止 photoTags 延迟返回后覆盖用户已操作的选择
  const initializedRef = useRef(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    if (!initializedRef.current && photoTags.length > 0) {
      initializedRef.current = true
      setSelected(new Set(photoTags.map((t) => t.id)))
    }
  }, [photoTags])

  // 新建标签状态
  const [newName,  setNewName]  = useState('')
  const [newColor, setNewColor] = useState<TagColor>(TAG_PRESET_COLORS[0])
  const [creating, setCreating] = useState(false)

  // 保存变更
  const saveMutation = useMutation({
    mutationFn: async () => {
      const currentIds  = new Set(photoTags.map((t) => t.id))
      const toAdd    = [...selected].filter((id) => !currentIds.has(id))
      const toRemove = [...currentIds].filter((id) => !selected.has(id))
      if (toAdd.length > 0)    await api.tags.addToPhoto(photoId, toAdd)
      if (toRemove.length > 0) await api.tags.removeFromPhoto(photoId, toRemove)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['photo-tags', photoId] })
      queryClient.invalidateQueries({ queryKey: ['tags'] })
      // Fix: refresh tag-photos views so tag sidebar + tag filter view updates
      queryClient.invalidateQueries({ queryKey: ['tag-photos'] })
      onClose()
    },
  })

  // 创建新标签
  const createMutation = useMutation({
    mutationFn: () => api.tags.create(newName.trim(), newColor),
    onSuccess: (tag) => {
      queryClient.invalidateQueries({ queryKey: ['tags'] })
      setSelected((prev) => new Set([...prev, tag.id]))
      setNewName('')
      setCreating(false)
      inputRef.current?.focus()
    },
  })

  const toggleTag = useCallback((tagId: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(tagId)) next.delete(tagId)
      else next.add(tagId)
      return next
    })
  }, [])

  // Esc 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <>
      {/* 遮罩 */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          backgroundColor: 'rgba(0,0,0,0.55)',
          zIndex: 'var(--la-z-modal)' as unknown as number,
        }}
      />

      {/* 弹窗 */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
        style={{
          position:        'fixed',
          top:             '50%',
          left:            '50%',
          transform:       'translate(-50%, -50%)',
          width:           '360px',
          maxWidth:        'calc(100vw - 32px)',
          maxHeight:       '520px',
          backgroundColor: 'var(--la-bg-raised)',
          borderRadius:    'var(--la-radius-lg)',
          border:          '1px solid var(--la-border)',
          boxShadow:       'var(--la-shadow-overlay)',
          zIndex:          'calc(var(--la-z-modal) + 1)' as unknown as number,
          display:         'flex',
          flexDirection:   'column',
          overflow:        'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题 */}
        <div style={{
          padding:      '14px 16px 10px',
          fontWeight:   600,
          fontSize:     '14px',
          color:        'var(--la-text-primary)',
          borderBottom: '1px solid var(--la-border)',
          flexShrink:   0,
        }}>
          管理标签
        </div>

        {/* 标签列表 */}
        <div style={{
          flex:       1,
          overflowY:  'auto',
          padding:    '10px 14px',
          display:    'flex',
          flexWrap:   'wrap',
          gap:        '6px',
          alignContent: 'flex-start',
        }}>
          {allTags.length === 0 && !creating && (
            <p style={{ fontSize: '12px', color: 'var(--la-text-tertiary)', margin: 0 }}>
              暂无标签，点击下方「新建」创建第一个
            </p>
          )}
          {allTags.map((tag) => (
            <TagBadge
              key={tag.id}
              tag={tag}
              size="md"
              selected={selected.has(tag.id)}
              onClick={() => toggleTag(tag.id)}
            />
          ))}
        </div>

        {/* 新建标签区域 */}
        {creating ? (
          <div style={{
            padding:      '10px 14px',
            borderTop:    '1px solid var(--la-border)',
            flexShrink:   0,
            display:      'flex',
            flexDirection: 'column',
            gap:          '8px',
          }}>
            <input
              ref={inputRef}
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newName.trim()) createMutation.mutate()
                if (e.key === 'Escape') setCreating(false)
              }}
              placeholder="标签名称"
              maxLength={50}
              style={{
                padding:       '6px 10px',
                borderRadius:  '6px',
                border:        '1px solid var(--la-border)',
                background:    'var(--la-bg-overlay)',
                color:         'var(--la-text-primary)',
                fontSize:      '13px',
                outline:       'none',
                width:         '100%',
                boxSizing:     'border-box',
              }}
            />
            {/* 颜色选择器 */}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {TAG_PRESET_COLORS.map((c) => (
                <span
                  key={c}
                  onClick={() => setNewColor(c)}
                  role="radio"
                  aria-checked={newColor === c}
                  aria-label={c}
                  style={{
                    width:        '20px',
                    height:       '20px',
                    borderRadius: '50%',
                    backgroundColor: c,
                    cursor:       'pointer',
                    border:       newColor === c ? '2px solid white' : '2px solid transparent',
                    boxShadow:    newColor === c ? `0 0 0 2px ${c}` : 'none',
                    transition:   'box-shadow 100ms',
                  }}
                />
              ))}
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                onClick={() => createMutation.mutate()}
                disabled={!newName.trim() || createMutation.isPending}
                style={{
                  flex:          1,
                  padding:       '6px',
                  borderRadius:  '6px',
                  border:        'none',
                  background:    'var(--la-accent)',
                  color:         'white',
                  fontSize:      '12px',
                  cursor:        newName.trim() ? 'pointer' : 'not-allowed',
                  opacity:       newName.trim() ? 1 : 0.5,
                }}
              >
                {createMutation.isPending ? '创建中…' : '确认创建'}
              </button>
              <button
                onClick={() => setCreating(false)}
                style={{
                  padding:      '6px 12px',
                  borderRadius: '6px',
                  border:       '1px solid var(--la-border)',
                  background:   'transparent',
                  color:        'var(--la-text-secondary)',
                  fontSize:     '12px',
                  cursor:       'pointer',
                }}
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <div style={{
            padding:   '8px 14px',
            borderTop: '1px solid var(--la-border)',
            flexShrink: 0,
          }}>
            <button
              onClick={() => setCreating(true)}
              style={{
                background:   'transparent',
                border:       'none',
                color:        'var(--la-accent)',
                fontSize:     '12px',
                cursor:       'pointer',
                padding:      '2px 0',
              }}
            >
              + 新建标签
            </button>
          </div>
        )}

        {/* 底部操作 */}
        <div style={{
          padding:         '10px 14px',
          borderTop:       '1px solid var(--la-border)',
          backgroundColor: 'var(--la-bg-overlay)',
          display:         'flex',
          justifyContent:  'flex-end',
          gap:             '8px',
          flexShrink:      0,
        }}>
          <button
            onClick={onClose}
            style={{
              padding:      '6px 14px',
              borderRadius: '6px',
              border:       '1px solid var(--la-border)',
              background:   'transparent',
              color:        'var(--la-text-secondary)',
              fontSize:     '13px',
              cursor:       'pointer',
            }}
          >
            取消
          </button>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            style={{
              padding:      '6px 14px',
              borderRadius: '6px',
              border:       'none',
              background:   'var(--la-accent)',
              color:        'white',
              fontSize:     '13px',
              cursor:       'pointer',
            }}
          >
            {saveMutation.isPending ? '保存中…' : '完成'}
          </button>
        </div>
      </motion.div>
    </>
  )
}
