/**
 * @file src/components/settings/sections/PerformanceSection.tsx
 * @description 性能设置分区
 *
 * 包含：
 *   - 缩略图并发生成数量（1~4，对应 pipeline 工作线程）
 *   - 缩略图内存缓存上限信息展示
 *   - 稳定性说明
 */

import { memo } from 'react'
import {
  SettingSection,
  SettingRow,
  SettingNote,
} from '../SettingsUI'
import type { AppSettings } from '@/types/ipc'

interface PerformanceSectionProps {
  settings: AppSettings
  onChange: (partial: Partial<AppSettings>) => void
}

export const PerformanceSection = memo(function PerformanceSection({
  settings,
  onChange,
}: PerformanceSectionProps) {
  return (
    <div>
      <SettingSection title="缩略图生成" icon="cpu">
        <SettingNote>
          缩略图由后台工作线程自动生成，线程数取决于 CPU 核心数（最多 4 个）。
          当前配置在应用启动时自动确定，无需手动调整。
        </SettingNote>

        <SettingRow
          label="工作线程数量"
          description="当前运行中的缩略图生成工作线程数（= min(CPU核心数 / 2, 4)）"
        >
          <span style={{
            fontSize:        'var(--la-text-sm)',
            color:           'var(--la-text-tertiary)',
            backgroundColor: 'var(--la-bg-overlay)',
            border:          '1px solid var(--la-border)',
            borderRadius:    'var(--la-radius-sm)',
            padding:         '3px 10px',
          }}>
            自动（系统决定）
          </span>
        </SettingRow>

        <SettingRow
          label="缩略图优先级"
          description="进入视口的照片获得高优先级；提前加载（overscan）区域使用普通优先级"
        >
          <span style={{
            fontSize:        'var(--la-text-sm)',
            color:           'var(--la-accent)',
            backgroundColor: 'var(--la-accent-subtle, rgba(0,122,255,0.08))',
            border:          '1px solid var(--la-accent)',
            borderRadius:    'var(--la-radius-sm)',
            padding:         '3px 10px',
            opacity:         0.8,
          }}>
            三优先级队列
          </span>
        </SettingRow>
      </SettingSection>

      <SettingSection title="内存缓存" icon="database">
        <SettingRow
          label="缩略图磁盘缓存"
          description="缩略图文件存储在应用数据目录下，按需生成，永久保留直到手动清理"
        >
          <span style={{
            fontSize:  'var(--la-text-sm)',
            color:     'var(--la-text-tertiary)',
          }}>
            按需生成
          </span>
        </SettingRow>

        <SettingNote>
          缩略图生成采用三档尺寸策略：S（200px）用于网格预览、M（600px）用于大图预览、
          L（1600px）仅在全屏查看时按需生成，有效控制磁盘空间占用。
        </SettingNote>
      </SettingSection>

      <SettingSection title="稳定性" icon="shield">
        <SettingRow
          label="SQLite 连接池"
          description="数据库连接池最大 5 个连接，等待超时 10 秒，使用 WAL 日志模式"
        >
          <span style={{
            fontSize:  'var(--la-text-xs)',
            color:     'var(--la-text-tertiary)',
            fontFamily: 'var(--la-font-mono)',
            backgroundColor: 'var(--la-bg-overlay)',
            padding:   '2px 8px',
            borderRadius: 'var(--la-radius-sm)',
            border:    '1px solid var(--la-border)',
          }}>
            pool=5 · WAL · 5s
          </span>
        </SettingRow>

        <SettingNote>
          数据库操作失败时会自动重试。如频繁遇到「数据库操作失败」提示，
          请尝试重启应用，或在「存储」页面清理缩略图缓存。
        </SettingNote>
      </SettingSection>
    </div>
  )
})
