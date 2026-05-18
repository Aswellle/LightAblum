/**
 * @file src/components/settings/sections/ImportSection.tsx
 * @description 导入设置分区
 *
 * 包含：
 *   - 监听文件夹列表管理（路径 + 照片数 + 最后扫描时间 + 操作按钮）
 *   - 重新扫描 / 移除监听 / 移除并删除照片（三选项确认）
 *   - 添加新文件夹入口
 */

import { memo, useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  SettingSection,
  ActionButton,
  SettingNote,
} from '../SettingsUI'
import { Icon } from '@/components/common/Icon'
import { api } from '@/services/tauriIpc'
import { toast } from '@/stores/uiStore'
import type { AppSettings } from '@/types/ipc'
import type { WatchedFolder } from '@/types/album'

interface ImportSectionProps {
  settings:    AppSettings
  onChange:    (partial: Partial<AppSettings>) => void
  queryClient: QueryClient
}

// ─────────────────────────────────────────────────────────
//  RemoveFolderDialog — 三选项确认弹窗
// ─────────────────────────────────────────────────────────

interface RemoveDialogProps {
  folder:   WatchedFolder
  onCancel: () => void
  onRemoveOnly:        () => void
  onRemoveAndDelete:   () => void
  loading: boolean
}

function RemoveFolderDialog({
  folder, onCancel, onRemoveOnly, onRemoveAndDelete, loading,
}: RemoveDialogProps) {
  const name = folder.path.split(/[/\\]/).filter(Boolean).pop() ?? folder.path

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{    opacity: 0 }}
      transition={{ duration: 0.12 }}
      style={{
        position:        'fixed',
        inset:           0,
        zIndex:          1000,
        backgroundColor: 'rgba(0,0,0,0.5)',
        display:         'flex',
        alignItems:      'center',
        justifyContent:  'center',
      }}
      onClick={onCancel}
    >
      <motion.div
        initial={{ scale: 0.94, y: 8 }}
        animate={{ scale: 1,    y: 0 }}
        exit={{    scale: 0.94, y: 8 }}
        transition={{ duration: 0.15 }}
        onClick={(e) => e.stopPropagation()}
        style={{
          width:           380,
          backgroundColor: 'var(--la-bg-raised)',
          border:          '1px solid var(--la-border)',
          borderRadius:    'var(--la-radius-xl)',
          boxShadow:       'var(--la-shadow-xl)',
          padding:         '20px',
        }}
      >
        <h3 style={{
          fontSize:  'var(--la-text-base)',
          fontWeight: 'var(--la-weight-semibold)' as unknown as number,
          color:     'var(--la-text-primary)',
          margin:    '0 0 8px',
        }}>
          移除文件夹「{name}」
        </h3>
        <p style={{
          fontSize:  'var(--la-text-sm)',
          color:     'var(--la-text-secondary)',
          margin:    '0 0 4px',
          lineHeight: '1.5',
        }}>
          移除监听后，LightAlbum 将不再跟踪此文件夹的变化。
        </p>
        <p style={{
          fontSize:  'var(--la-text-sm)',
          color:     'var(--la-text-tertiary)',
          margin:    '0 0 20px',
          lineHeight: '1.5',
        }}>
          已导入的 <strong style={{ color: 'var(--la-text-secondary)' }}>{folder.photoCount} 张</strong>照片数据默认保留在库中。
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {/* 取消 */}
          <button
            onClick={onCancel}
            disabled={loading}
            style={{
              height:          '36px',
              borderRadius:    'var(--la-radius-md)',
              backgroundColor: 'var(--la-bg-overlay)',
              border:          '1px solid var(--la-border)',
              color:           'var(--la-text-primary)',
              fontSize:        'var(--la-text-sm)',
              cursor:          'default',
              transition:      'all 100ms ease',
            }}
          >
            取消
          </button>

          {/* 仅移除监听 */}
          <button
            onClick={onRemoveOnly}
            disabled={loading}
            style={{
              height:          '36px',
              borderRadius:    'var(--la-radius-md)',
              backgroundColor: 'var(--la-bg-overlay)',
              border:          '1px solid var(--la-border)',
              color:           'var(--la-text-primary)',
              fontSize:        'var(--la-text-sm)',
              cursor:          'default',
              transition:      'all 100ms ease',
              display:         'flex',
              alignItems:      'center',
              justifyContent:  'center',
              gap:             '6px',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--la-bg-hover)' }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--la-bg-overlay)' }}
          >
            <Icon name="folder" size={14} color="currentColor" />
            仅移除监听（保留 {folder.photoCount} 张照片数据）
          </button>

          {/* 移除并删除 */}
          <button
            onClick={onRemoveAndDelete}
            disabled={loading}
            style={{
              height:          '36px',
              borderRadius:    'var(--la-radius-md)',
              backgroundColor: 'rgba(255,59,48,0.08)',
              border:          '1px solid rgba(255,59,48,0.2)',
              color:           'var(--la-danger, #FF3B30)',
              fontSize:        'var(--la-text-sm)',
              cursor:          'default',
              transition:      'all 100ms ease',
              display:         'flex',
              alignItems:      'center',
              justifyContent:  'center',
              gap:             '6px',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255,59,48,0.16)' }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255,59,48,0.08)' }}
          >
            <Icon name="trash" size={14} color="currentColor" />
            移除监听并删除 {folder.photoCount} 张照片数据（不可撤销）
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────
//  FolderRow — 单个监听文件夹行
// ─────────────────────────────────────────────────────────

interface FolderRowProps {
  folder:    WatchedFolder
  onRescan:  (path: string) => void
  onRemove:  (folder: WatchedFolder) => void
  scanning?: boolean
}

const FolderRow = memo(function FolderRow({
  folder, onRescan, onRemove, scanning,
}: FolderRowProps) {
  const name = folder.path.split(/[/\\]/).filter(Boolean).pop() ?? folder.path

  const formatDate = (iso: string | null) => {
    if (!iso) return '从未扫描'
    try {
      return new Date(iso).toLocaleString('zh-CN', {
        month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
      })
    } catch { return iso }
  }

  return (
    <div style={{
      display:         'flex',
      alignItems:      'center',
      gap:             '12px',
      padding:         '10px 12px',
      backgroundColor: 'var(--la-bg-overlay)',
      borderRadius:    'var(--la-radius-md)',
      border:          '1px solid var(--la-border)',
      marginBottom:    '6px',
    }}>
      {/* 文件夹图标 */}
      <Icon name="folder" size={18} color="var(--la-accent)" style={{ flexShrink: 0 }} />

      {/* 路径信息 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize:    'var(--la-text-sm)',
          color:       'var(--la-text-primary)',
          fontWeight:  'var(--la-weight-medium)' as unknown as number,
          overflow:    'hidden',
          whiteSpace:  'nowrap',
          textOverflow: 'ellipsis',
        }} title={folder.path}>
          {name}
        </div>
        <div style={{
          fontSize:  'var(--la-text-xs)',
          color:     'var(--la-text-tertiary)',
          marginTop: '2px',
          display:   'flex',
          gap:       '10px',
        }}>
          <span>{folder.photoCount} 张照片</span>
          <span>上次扫描：{formatDate(folder.lastScanAt)}</span>
        </div>
        <div style={{
          fontSize:    'var(--la-text-xs)',
          color:       'var(--la-text-tertiary)',
          marginTop:   '2px',
          overflow:    'hidden',
          whiteSpace:  'nowrap',
          textOverflow: 'ellipsis',
          opacity:     0.7,
        }} title={folder.path}>
          {folder.path}
        </div>
      </div>

      {/* 操作按钮 */}
      <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
        <ActionButton
          onClick={() => onRescan(folder.path)}
          label={scanning ? '扫描中…' : '重新扫描'}
          icon="scan"
          loading={scanning}
          disabled={scanning}
        />
        <ActionButton
          onClick={() => onRemove(folder)}
          label="移除"
          icon="x"
          variant="danger"
          disabled={scanning}
        />
      </div>
    </div>
  )
})

// ─────────────────────────────────────────────────────────
//  ImportSection
// ─────────────────────────────────────────────────────────

export const ImportSection = memo(function ImportSection({
  settings: _settings,
  onChange: _onChange,
  queryClient,
}: ImportSectionProps) {
  const [removingFolder, setRemovingFolder] = useState<WatchedFolder | null>(null)
  const [removeLoading, setRemoveLoading]   = useState(false)
  const [scanningPaths, setScanningPaths]   = useState<Set<string>>(new Set())
  const [addingFolder, setAddingFolder]     = useState(false)

  // 文件夹列表
  const { data: folders = [] } = useQuery({
    queryKey: ['folders'],
    queryFn:  api.folders.list,
    staleTime: 30 * 1000,
  })

  // 重新扫描
  const handleRescan = useCallback(async (path: string) => {
    if (scanningPaths.has(path)) return
    setScanningPaths((prev) => new Set([...prev, path]))
    try {
      await api.folders.add(path)
      toast.success(`开始重新扫描：${path.split(/[/\\]/).pop()}`)
    } catch {
      toast.error('扫描启动失败')
    } finally {
      setScanningPaths((prev) => {
        const next = new Set(prev)
        next.delete(path)
        return next
      })
    }
  }, [scanningPaths])

  // 添加文件夹
  const handleAddFolder = useCallback(async () => {
    if (addingFolder) return
    setAddingFolder(true)
    try {
      const path = await api.folders.pick()
      if (!path) return
      await api.folders.add(path)
      queryClient.invalidateQueries({ queryKey: ['folders'] })
      queryClient.invalidateQueries({ queryKey: ['photos'] })
      toast.success(`已添加文件夹，正在扫描…`)
    } catch {
      toast.error('添加文件夹失败')
    } finally {
      setAddingFolder(false)
    }
  }, [addingFolder, queryClient])

  // 移除：仅移除监听
  const handleRemoveOnly = useCallback(async () => {
    if (!removingFolder) return
    setRemoveLoading(true)
    try {
      await api.folders.remove(removingFolder.path, false)
      queryClient.invalidateQueries({ queryKey: ['folders'] })
      toast.success('已移除文件夹监听')
    } catch {
      toast.error('移除失败')
    } finally {
      setRemoveLoading(false)
      setRemovingFolder(null)
    }
  }, [removingFolder, queryClient])

  // 移除：同时删除照片数据
  const handleRemoveAndDelete = useCallback(async () => {
    if (!removingFolder) return
    setRemoveLoading(true)
    try {
      await api.folders.remove(removingFolder.path, true)
      queryClient.invalidateQueries({ queryKey: ['folders'] })
      queryClient.resetQueries({ queryKey: ['photos'] })
      toast.success(`已移除文件夹并删除 ${removingFolder.photoCount} 张照片数据`)
    } catch {
      toast.error('操作失败')
    } finally {
      setRemoveLoading(false)
      setRemovingFolder(null)
    }
  }, [removingFolder, queryClient])

  return (
    <>
      {/* ── 监听文件夹 ── */}
      <SettingSection title="监听文件夹" icon="download-cloud">
        {folders.length === 0 ? (
          <div style={{
            padding:         '24px',
            textAlign:       'center',
            backgroundColor: 'var(--la-bg-overlay)',
            borderRadius:    'var(--la-radius-md)',
            border:          '1px dashed var(--la-border)',
            marginBottom:    '8px',
          }}>
            <Icon name="folder" size={28} color="var(--la-text-tertiary)" style={{ marginBottom: '8px' }} />
            <p style={{ fontSize: 'var(--la-text-sm)', color: 'var(--la-text-tertiary)', margin: 0 }}>
              暂无监听文件夹
            </p>
            <p style={{ fontSize: 'var(--la-text-xs)', color: 'var(--la-text-tertiary)', margin: '4px 0 0', opacity: 0.7 }}>
              添加文件夹后，LightAlbum 将自动索引其中的照片
            </p>
          </div>
        ) : (
          folders.map((folder) => (
            <FolderRow
              key={folder.path}
              folder={folder}
              onRescan={handleRescan}
              onRemove={setRemovingFolder}
              scanning={scanningPaths.has(folder.path)}
            />
          ))
        )}

        {/* 添加文件夹按钮 */}
        <button
          onClick={handleAddFolder}
          disabled={addingFolder}
          style={{
            display:         'flex',
            alignItems:      'center',
            justifyContent:  'center',
            gap:             '6px',
            width:           '100%',
            height:          '36px',
            borderRadius:    'var(--la-radius-md)',
            backgroundColor: 'transparent',
            border:          '1px dashed var(--la-border)',
            color:           addingFolder ? 'var(--la-text-tertiary)' : 'var(--la-accent)',
            fontSize:        'var(--la-text-sm)',
            cursor:          addingFolder ? 'wait' : 'default',
            transition:      'all 100ms ease',
            marginTop:       '4px',
          }}
          onMouseEnter={(e) => {
            if (!addingFolder) {
              e.currentTarget.style.borderColor = 'var(--la-accent)'
              e.currentTarget.style.backgroundColor = 'var(--la-accent-subtle, rgba(0,122,255,0.06))'
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--la-border)'
            e.currentTarget.style.backgroundColor = 'transparent'
          }}
        >
          {addingFolder ? (
            <>
              <div style={{
                width: 14, height: 14,
                border: '1.5px solid currentColor',
                borderTopColor: 'transparent',
                borderRadius: '50%',
                animation: 'la-spin 0.7s linear infinite',
              }} />
              正在打开文件夹选择器…
            </>
          ) : (
            <>
              <Icon name="plus" size={14} color="currentColor" strokeWidth={2} />
              添加照片文件夹
            </>
          )}
        </button>
      </SettingSection>

      {/* ── 扫描行为 ── */}
      <SettingSection title="扫描行为" icon="scan">
        <SettingNote>
          文件系统监听器在应用运行时实时检测照片变化（新增/删除/修改），
          无需手动触发重新扫描。
        </SettingNote>
      </SettingSection>

      {/* 移除确认弹窗 */}
      <AnimatePresence>
        {removingFolder && (
          <RemoveFolderDialog
            key="remove-dialog"
            folder={removingFolder}
            onCancel={() => setRemovingFolder(null)}
            onRemoveOnly={handleRemoveOnly}
            onRemoveAndDelete={handleRemoveAndDelete}
            loading={removeLoading}
          />
        )}
      </AnimatePresence>
    </>
  )
})
