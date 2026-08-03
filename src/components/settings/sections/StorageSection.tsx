/**
 * @file src/components/settings/sections/StorageSection.tsx
 * @description 存储设置分区（v2 — 修复 @tauri-apps/plugin-fs 依赖错误）
 *
 * BugFix：
 *   原实现在 handleClearCache 和 handleOpenDataDir 中使用了动态 import：
 *     await import("@tauri-apps/plugin-fs")   ← 未安装，Vite 静态分析直接报错
 *     await import("@tauri-apps/api/path")    ← 不必要
 *   Vite 在编译阶段会解析所有 import() 字符串（包括 try 块内的动态 import），
 *   只要包不存在就立即报错，不会等到运行时才触发。
 *
 *   修复方案：
 *   将缩略图缓存清理、数据目录打开全部改为通过已有的 IPC 调用：
 *     api.storage.getInfo()          → storage_get_info（Rust 侧读目录统计）
 *     api.storage.clearThumbnails()  → storage_clear_thumbnails（Rust 侧删文件）
 *     api.storage.openDataDir()      → storage_open_data_dir（Rust 侧 shell.open）
 *   所有文件系统操作移入 Rust，前端完全不接触 plugin-fs。
 */

import { memo, useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  SettingSection,
  SettingRow,
  ActionButton,
  SettingNote,
} from '../SettingsUI'
import { api } from '@/services/tauriIpc'
import { toast } from '@/stores/uiStore'
import type { AppSettings } from '@/types/ipc'

interface StorageSectionProps {
  settings: AppSettings
  onChange: (partial: Partial<AppSettings>) => void
}

// ─────────────────────────────────────────────────────────
//  文件大小格式化
// ─────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes <= 0)          return '0 B'
  if (bytes < 1024)        return `${bytes} B`
  if (bytes < 1048576)     return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1073741824)  return `${(bytes / 1048576).toFixed(1)} MB`
  return `${(bytes / 1073741824).toFixed(2)} GB`
}

// ─────────────────────────────────────────────────────────
//  StorageSection
// ─────────────────────────────────────────────────────────

export const StorageSection = memo(function StorageSection({
  settings: _settings,
}: StorageSectionProps) {
  const [clearingCache, setClearingCache] = useState(false)
  const [openingDir, setOpeningDir]       = useState(false)
  const queryClient = useQueryClient()

  // ── 存储信息查询（调用 Rust storage_get_info）──
  // BugFix：原来用 @tauri-apps/plugin-fs 读取目录，改为 IPC 调用
  const {
    data: storageInfo,
    isLoading: infoLoading,
    refetch: refetchInfo,
  } = useQuery({
    queryKey: ['storage', 'info'],
    queryFn:  api.storage.getInfo,
    staleTime: 30 * 1000,
    gcTime:    0,
  })

  // 库统计（照片总数、大小等）
  const { data: stats } = useQuery({
    queryKey: ['search', 'stats'],
    queryFn:  api.search.stats,
    staleTime: 30 * 1000,
  })

  // ── 在资源管理器中打开数据目录 ──
  // BugFix：原来用 @tauri-apps/api/path + plugin-shell，
  // 改为 Rust 命令 storage_open_data_dir 内部调用 tauri-plugin-shell
  const handleOpenDataDir = useCallback(async () => {
    if (openingDir) return
    setOpeningDir(true)
    try {
      await api.storage.openDataDir()
    } catch {
      toast.error('无法打开数据目录，请手动导航至应用数据目录')
    } finally {
      setOpeningDir(false)
    }
  }, [openingDir])

  // ── 清理缩略图缓存 ──
  // BugFix：原来用 @tauri-apps/plugin-fs 遍历删除文件，
  // 改为 Rust 命令 storage_clear_thumbnails 在后端完成文件删除
  const handleClearCache = useCallback(async () => {
    if (clearingCache) return
    setClearingCache(true)
    try {
      const deletedCount = await api.storage.clearThumbnails()
      // 刷新存储信息显示
      await refetchInfo()
      // 使缩略图查询缓存失效（强制重新生成）
      queryClient.removeQueries({ queryKey: ['thumb'] })
      toast.success(`已清理缩略图缓存（${deletedCount} 个文件）`)
    } catch {
      toast.error('清理失败，请重试')
    } finally {
      setClearingCache(false)
    }
  }, [clearingCache, refetchInfo, queryClient])

  return (
    <div>
      {/* ── 数据目录 ── */}
      <SettingSection title="数据目录" icon="database">
        <SettingRow
          label="应用数据目录"
          description={
            storageInfo
              ? storageInfo.dataDir
              : infoLoading
              ? '加载中…'
              : '读取目录路径失败'
          }
        >
          <ActionButton
            onClick={handleOpenDataDir}
            label={openingDir ? '正在打开…' : '在资源管理器中打开'}
            icon="external-link"
            loading={openingDir}
            disabled={openingDir}
          />
        </SettingRow>

        <SettingRow
          label="数据库版本"
          description="SQLite 数据库的 Schema 版本"
        >
          <span style={{
            fontSize:        'var(--la-text-xs)',
            color:           'var(--la-text-tertiary)',
            backgroundColor: 'var(--la-bg-overlay)',
            border:          '1px solid var(--la-border)',
            borderRadius:    'var(--la-radius-sm)',
            padding:         '3px 10px',
            fontFamily:      'var(--la-font-mono)',
          }}>
            V2
          </span>
        </SettingRow>
      </SettingSection>

      {/* ── 照片库 ── */}
      <SettingSection title="照片库" icon="images">
        {stats ? (
          <>
            <SettingRow label="照片总数">
              <span style={{
                fontSize:   'var(--la-text-sm)',
                color:      'var(--la-text-primary)',
                fontWeight: 'var(--la-weight-medium)' as unknown as number,
              }}>
                {(stats.totalPhotos ?? 0).toLocaleString()} 张
              </span>
            </SettingRow>

            <SettingRow label="收藏照片">
              <span style={{ fontSize: 'var(--la-text-sm)', color: 'var(--la-text-secondary)' }}>
                {(stats.totalFavorites ?? 0).toLocaleString()} 张
              </span>
            </SettingRow>

            <SettingRow label="相册数量">
              <span style={{ fontSize: 'var(--la-text-sm)', color: 'var(--la-text-secondary)' }}>
                {stats.totalAlbums ?? 0} 个
              </span>
            </SettingRow>

            <SettingRow label="照片文件总大小">
              <span style={{ fontSize: 'var(--la-text-sm)', color: 'var(--la-text-secondary)' }}>
                {formatBytes(stats.totalSizeBytes ?? 0)}
              </span>
            </SettingRow>
          </>
        ) : (
          <div style={{
            padding: '16px',
            textAlign: 'center',
            color:    'var(--la-text-tertiary)',
            fontSize: 'var(--la-text-sm)',
          }}>
            加载统计信息中…
          </div>
        )}
      </SettingSection>

      {/* ── 缩略图缓存 ── */}
      <SettingSection title="缩略图缓存" icon="refresh-cw">
        {/* 缓存大小统计行 */}
        <SettingRow
          label="缓存大小"
          description="已生成的缩略图文件（WEBP 格式）占用的磁盘空间"
        >
          {infoLoading ? (
            <span style={{ fontSize: 'var(--la-text-sm)', color: 'var(--la-text-tertiary)' }}>
              统计中…
            </span>
          ) : storageInfo ? (
            <span style={{
              fontSize:   'var(--la-text-sm)',
              color:      'var(--la-text-secondary)',
              fontWeight: 'var(--la-weight-medium)' as unknown as number,
            }}>
              {formatBytes(storageInfo.thumbnailSizeBytes ?? 0)}
              <span style={{
                fontSize: 'var(--la-text-xs)',
                color:    'var(--la-text-tertiary)',
                marginLeft: '6px',
              }}>
                （{(storageInfo.thumbnailCount ?? 0).toLocaleString()} 个文件）
              </span>
            </span>
          ) : (
            <span style={{ fontSize: 'var(--la-text-sm)', color: 'var(--la-text-tertiary)' }}>
              —
            </span>
          )}
        </SettingRow>

        {/* 缓存路径 */}
        <SettingRow
          label="缓存位置"
          description="缩略图文件存储在应用数据目录的 thumbnails/ 子目录中"
        >
          <span style={{
            fontSize:   'var(--la-text-xs)',
            color:      'var(--la-text-tertiary)',
            fontFamily: 'var(--la-font-mono)',
            maxWidth:   160,
            overflow:   'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={storageInfo?.dataDir ?? 'thumbnails/'}
          >
            {storageInfo?.dataDir
              ? storageInfo.dataDir.split(/[/\\]/).slice(-2).join('/')
              : 'thumbnails/'}
          </span>
        </SettingRow>

        {/* 清理按钮 */}
        <SettingRow
          label="清理缩略图缓存"
          description="删除所有已生成的缩略图文件。清理后打开应用时将自动重新生成"
        >
          <ActionButton
            onClick={handleClearCache}
            label={clearingCache ? '清理中…' : '清理缓存'}
            icon={clearingCache ? undefined : 'trash'}
            variant="danger"
            loading={clearingCache}
            disabled={clearingCache || (storageInfo?.thumbnailCount === 0)}
          />
        </SettingRow>

        <SettingNote variant="warning">
          清理缩略图缓存后，所有已生成的预览图将被删除。
          重新打开应用时缩略图将在后台自动重新生成，大量照片的场景下可能需要几分钟。
        </SettingNote>
      </SettingSection>
    </div>
  )
})
