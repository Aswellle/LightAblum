/**
 * @file src/components/settings/sections/AppearanceSection.tsx
 * @description 外观设置分区
 *
 * 包含：
 *   - 网格密度滑块（1~4 档）+ 实时预览示意
 *   - 侧边栏宽度滑块
 */

import { memo, useCallback } from 'react'
import {
  SettingSection,
  SettingRow,
  SettingNote,
} from '../SettingsUI'
import { useLayoutStore } from '@/stores/layoutStore'
import { useUiStore } from '@/stores/uiStore'
import { DENSITY_PRESETS } from '@/types/layout'
import type { AppSettings } from '@/types/ipc'
import type { DensityLevel } from '@/types/layout'

interface AppearanceSectionProps {
  settings: AppSettings
  onChange: (partial: Partial<AppSettings>) => void
}

// ─────────────────────────────────────────────────────────
//  DensityPreview — 网格密度示意图
// ─────────────────────────────────────────────────────────

const DENSITY_LABELS = ['紧凑', '标准', '宽松', '超大'] as const

function DensityPreview({ density }: { density: DensityLevel }) {
  const cols = DENSITY_PRESETS[density].columns
  const displayCols = Math.min(cols, 6)  // 示意图最多显示 6 列

  return (
    <div style={{
      display:  'flex',
      gap:      density === 1 ? 1 : density === 2 ? 2 : density === 3 ? 3 : 4,
      padding:  '6px',
      backgroundColor: 'var(--la-bg-overlay)',
      borderRadius:    'var(--la-radius-sm)',
      border:          '1px solid var(--la-border)',
    }}>
      {Array.from({ length: displayCols }).map((_, i) => {
        const size = density === 1 ? 12 : density === 2 ? 18 : density === 3 ? 24 : 32
        return (
          <div
            key={i}
            style={{
              width:           size,
              height:          size,
              borderRadius:    2,
              backgroundColor: 'var(--la-accent)',
              opacity:         0.3 + (i / displayCols) * 0.4,
            }}
          />
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────
//  AppearanceSection
// ─────────────────────────────────────────────────────────

export const AppearanceSection = memo(function AppearanceSection({
  settings,
  onChange,
}: AppearanceSectionProps) {
  const setDensity     = useLayoutStore((s) => s.setDensity)
  const setSidebarWidth = useUiStore((s) => s.setSidebarWidth)

  const handleDensityChange = useCallback((level: DensityLevel) => {
    setDensity(level)
    onChange({ gridDensity: level })
  }, [setDensity, onChange])

  const handleSidebarWidthChange = useCallback((width: number) => {
    setSidebarWidth(width)
    onChange({ sidebarWidth: width })
  }, [setSidebarWidth, onChange])

  const currentDensity = (settings.gridDensity ?? 2) as DensityLevel

  return (
    <div>
      {/* ── 网格密度 ── */}
      <SettingSection title="网格密度" icon="grid">
        <SettingRow
          label="照片网格密度"
          description="调整照片网格中每行显示的照片数量。也可在照片视图中使用 Ctrl+滚轮 快速调整"
        >
          <DensityPreview density={currentDensity} />
        </SettingRow>

        {/* 密度滑块 */}
        <div style={{ paddingTop: '8px', paddingBottom: '4px' }}>
          {/* 滑块 */}
          <input
            type="range"
            min={1}
            max={4}
            step={1}
            value={currentDensity}
            onChange={(e) => handleDensityChange(Number(e.target.value) as DensityLevel)}
            style={{
              width:     '100%',
              height:    '4px',
              cursor:    'default',
              accentColor: 'var(--la-accent)',
            }}
          />
          {/* 刻度标签 */}
          <div style={{
            display:        'flex',
            justifyContent: 'space-between',
            marginTop:      '6px',
          }}>
            {DENSITY_LABELS.map((label, i) => {
              const level = (i + 1) as DensityLevel
              const isActive = currentDensity === level
              return (
                <button
                  key={label}
                  onClick={() => handleDensityChange(level)}
                  style={{
                    fontSize:        '11px',
                    color:           isActive ? 'var(--la-accent)' : 'var(--la-text-tertiary)',
                    fontWeight:      isActive ? 'var(--la-weight-medium)' as unknown as number : undefined,
                    backgroundColor: 'transparent',
                    border:          'none',
                    cursor:          'default',
                    padding:         '2px 4px',
                    borderRadius:    'var(--la-radius-sm)',
                    transition:      'color 100ms ease',
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        <SettingNote>
          当前：{DENSITY_PRESETS[currentDensity].label}模式 — 约 {DENSITY_PRESETS[currentDensity].columns} 列
          （具体列数根据窗口宽度自适应）
        </SettingNote>
      </SettingSection>

      {/* ── 侧边栏 ── */}
      <SettingSection title="侧边栏" icon="collapse">
        <SettingRow
          label="侧边栏宽度"
          description={`当前宽度：${settings.sidebarWidth ?? 220}px（160 ~ 320px）`}
        >
          <span style={{
            fontSize:   'var(--la-text-sm)',
            color:      'var(--la-accent)',
            fontWeight: 'var(--la-weight-medium)' as unknown as number,
            minWidth:   36,
            textAlign:  'right',
          }}>
            {settings.sidebarWidth ?? 220}px
          </span>
        </SettingRow>

        <div style={{ paddingTop: '8px', paddingBottom: '4px' }}>
          <input
            type="range"
            min={160}
            max={320}
            step={10}
            value={settings.sidebarWidth ?? 220}
            onChange={(e) => handleSidebarWidthChange(Number(e.target.value))}
            style={{
              width:       '100%',
              height:      '4px',
              cursor:      'default',
              accentColor: 'var(--la-accent)',
            }}
          />
          <div style={{
            display:        'flex',
            justifyContent: 'space-between',
            marginTop:      '4px',
          }}>
            {['160px', '220px', '270px', '320px'].map((v) => (
              <span key={v} style={{
                fontSize: '11px',
                color:    'var(--la-text-tertiary)',
              }}>
                {v}
              </span>
            ))}
          </div>
        </div>
      </SettingSection>
    </div>
  )
})
