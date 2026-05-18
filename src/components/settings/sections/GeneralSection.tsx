/**
 * @file src/components/settings/sections/GeneralSection.tsx
 * @description 通用设置分区
 *
 * 包含：
 *   - 主题切换（浅色 / 深色 / 跟随系统）→ 即时写 uiStore.setTheme
 *   - 默认排序字段 + 升降序
 *   - 预览行为（单击/双击进入大图、自动隐藏 UI）
 */

import { memo, useCallback } from 'react'
import {
  SettingSection,
  SettingRow,
  SegmentedControl,
  SettingSelect,
  ToggleSwitch,
} from '../SettingsUI'
import { useUiStore } from '@/stores/uiStore'
import { useLayoutStore } from '@/stores/layoutStore'
import type { AppSettings, AppTheme, PhotoSortField } from '@/types/ipc'

// ─────────────────────────────────────────────────────────
//  类型
// ─────────────────────────────────────────────────────────

interface GeneralSectionProps {
  settings: AppSettings
  onChange: (partial: Partial<AppSettings>) => void
}

// ─────────────────────────────────────────────────────────
//  主题选项
// ─────────────────────────────────────────────────────────

const THEME_OPTIONS = [
  { value: 'light'  as AppTheme, label: '浅色', icon: 'sun'     as const, title: '浅色主题' },
  { value: 'dark'   as AppTheme, label: '深色', icon: 'moon'    as const, title: '深色主题' },
  { value: 'system' as AppTheme, label: '跟随', icon: 'monitor' as const, title: '跟随系统' },
]

// ─────────────────────────────────────────────────────────
//  排序选项
// ─────────────────────────────────────────────────────────

const SORT_OPTIONS: { value: PhotoSortField; label: string }[] = [
  { value: 'created_at',  label: '拍摄时间（默认）' },
  { value: 'imported_at', label: '导入时间'         },
  { value: 'file_name',   label: '文件名称'         },
  { value: 'file_size',   label: '文件大小'         },
]

const SORT_DIR_OPTIONS: Array<{ value: 'desc' | 'asc'; label: string }> = [
  { value: 'desc', label: '从新到旧 ↓' },
  { value: 'asc',  label: '从旧到新 ↑' },
]

// ─────────────────────────────────────────────────────────
//  GeneralSection
// ─────────────────────────────────────────────────────────

export const GeneralSection = memo(function GeneralSection({
  settings,
  onChange,
}: GeneralSectionProps) {
  const setTheme   = useUiStore((s) => s.setTheme)
  const setSort    = useLayoutStore((s) => s.setSort)

  // 主题变更：即时写 uiStore（立即生效），同时 debounce 保存
  const handleThemeChange = useCallback((theme: AppTheme) => {
    setTheme(theme)
    onChange({ theme })
  }, [setTheme, onChange])

  // 排序变更：即时写 layoutStore，同时 debounce 保存
  const handleSortByChange = useCallback((sortBy: PhotoSortField) => {
    setSort(sortBy, settings.sortAsc)
    onChange({ sortBy })
  }, [settings.sortAsc, setSort, onChange])

  const handleSortAscChange = useCallback((dir: 'asc' | 'desc') => {
    const sortAsc = dir === 'asc'
    setSort(settings.sortBy, sortAsc)
    onChange({ sortAsc })
  }, [settings.sortBy, setSort, onChange])

  return (
    <div>
      {/* ── 主题 ── */}
      <SettingSection title="主题" icon="monitor">
        <SettingRow
          label="外观主题"
          description="选择应用的颜色主题，「跟随系统」将根据 Windows 主题自动切换"
        >
          <SegmentedControl
            options={THEME_OPTIONS}
            value={settings.theme}
            onChange={handleThemeChange}
          />
        </SettingRow>
      </SettingSection>

      {/* ── 排序 ── */}
      <SettingSection title="默认排序" icon="chevron-down">
        <SettingRow label="排序字段" description="照片网格的默认排序方式">
          <SettingSelect
            options={SORT_OPTIONS}
            value={settings.sortBy}
            onChange={handleSortByChange}
            width={180}
          />
        </SettingRow>

        <SettingRow label="排序方向">
          <SegmentedControl
            options={SORT_DIR_OPTIONS}
            value={settings.sortAsc ? 'asc' : 'desc'}
            onChange={handleSortAscChange}
          />
        </SettingRow>
      </SettingSection>

      {/* ── 预览行为 ── */}
      <SettingSection title="预览行为" icon="eye">
        <SettingRow
          label="双击进入大图预览"
          description="开启后需要双击才能打开大图预览，单击仅选中照片"
        >
          <ToggleSwitch
            checked={settings.previewOnDoubleClick}
            onChange={(v) => onChange({ previewOnDoubleClick: v })}
            label="双击进入大图预览"
          />
        </SettingRow>

        <SettingRow
          label="自动隐藏预览界面"
          description="大图预览模式下，2 秒无操作后自动隐藏工具栏和胶片条"
        >
          <ToggleSwitch
            checked={settings.autoHidePreviewUI}
            onChange={(v) => onChange({ autoHidePreviewUI: v })}
            label="自动隐藏预览界面"
          />
        </SettingRow>
      </SettingSection>
    </div>
  )
})
