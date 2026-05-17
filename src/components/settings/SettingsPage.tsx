/**
 * @file src/components/settings/SettingsPage.tsx
 * @description 设置页面主容器
 *
 * 布局：
 *   左侧固定导航（120px）+ 右侧内容区（flex-1，可滚动）
 *
 * 分类：通用 / 外观 / 导入 / 性能 / 存储 / 关于
 *
 * 数据流：
 *   进入页面 → api.settings.get() → 填充本地 draft state
 *   用户修改 → setDraft(partial) → debounce 500ms → api.settings.update()
 *   即时生效的字段（主题/密度）直接写 store，无需等待 debounce
 */

import { useState, useEffect, useRef, useCallback, memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Icon } from '@/components/common/Icon'
import { GeneralSection }     from './sections/GeneralSection'
import { AppearanceSection }  from './sections/AppearanceSection'
import { ImportSection }      from './sections/ImportSection'
import { PerformanceSection } from './sections/PerformanceSection'
import { StorageSection }     from './sections/StorageSection'
import { AboutSection }       from './sections/AboutSection'
import { api } from '@/services/tauriIpc'
import { useUiStore } from '@/stores/uiStore'
import type { AppSettings } from '@/types/ipc'
import type { IconName } from '@/components/common/Icon'

// ─────────────────────────────────────────────────────────
//  分类配置
// ─────────────────────────────────────────────────────────

export type SettingsSection =
  | 'general'
  | 'appearance'
  | 'import'
  | 'performance'
  | 'storage'
  | 'about'

interface SectionConfig {
  id:    SettingsSection
  label: string
  icon:  IconName
}

const SECTIONS: SectionConfig[] = [
  { id: 'general',     label: '通用',   icon: 'monitor'        },
  { id: 'appearance',  label: '外观',   icon: 'palette'        },
  { id: 'import',      label: '导入',   icon: 'download-cloud' },
  { id: 'performance', label: '性能',   icon: 'cpu'            },
  { id: 'storage',     label: '存储',   icon: 'database'       },
  { id: 'about',       label: '关于',   icon: 'about'          },
]

// ─────────────────────────────────────────────────────────
//  SettingsNavItem
// ─────────────────────────────────────────────────────────

interface SettingsNavItemProps {
  config:   SectionConfig
  active:   boolean
  onClick:  () => void
}

const SettingsNavItem = memo(function SettingsNavItem({
  config, active, onClick,
}: SettingsNavItemProps) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      style={{
        display:         'flex',
        flexDirection:   'column',
        alignItems:      'center',
        justifyContent:  'center',
        gap:             '5px',
        width:           '100%',
        padding:         '10px 4px',
        borderRadius:    'var(--la-radius-md)',
        margin:          '1px 0',
        backgroundColor: active ? 'var(--la-bg-active)' : 'transparent',
        border:          'none',
        color:           active ? 'var(--la-text-primary)' : 'var(--la-text-secondary)',
        cursor:          'default',
        transition:      'all 120ms ease',
        position:        'relative',
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.backgroundColor = 'var(--la-bg-hover)'
          e.currentTarget.style.color = 'var(--la-text-primary)'
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.backgroundColor = 'transparent'
          e.currentTarget.style.color = 'var(--la-text-secondary)'
        }
      }}
    >
      <Icon
        name={config.icon}
        size={20}
        color={active ? 'var(--la-accent)' : 'currentColor'}
      />
      <span style={{
        fontSize:   '10px',
        fontWeight: active ? 'var(--la-weight-medium)' as unknown as number : undefined,
        lineHeight: 1.2,
        textAlign:  'center',
        color:      active ? 'var(--la-text-primary)' : 'var(--la-text-tertiary)',
      }}>
        {config.label}
      </span>
      {/* 左侧活跃指示条 */}
      {active && (
        <div style={{
          position:        'absolute',
          left:            0,
          top:             '25%',
          height:          '50%',
          width:           '3px',
          borderRadius:    '0 2px 2px 0',
          backgroundColor: 'var(--la-accent)',
        }} />
      )}
    </button>
  )
})

// ─────────────────────────────────────────────────────────
//  SettingsPage — 主组件
// ─────────────────────────────────────────────────────────

interface SettingsPageProps {
  onClose: () => void
}

export function SettingsPage({ onClose }: SettingsPageProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>('general')
  const queryClient = useQueryClient()

  // ── 加载 AppSettings ──
  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn:  api.settings.get,
    staleTime: 30 * 1000,
    gcTime:    0,
  })

  // ── 本地 draft（立即响应用户操作，防抖保存）──
  const [draft, setDraft] = useState<Partial<AppSettings>>({})
  const saveTimerRef      = useRef<ReturnType<typeof setTimeout> | null>(null)

  // settings 加载完成后初始化 draft
  useEffect(() => {
    if (settings) setDraft(settings)
  }, [settings])

  // 合并后的当前值（draft 覆盖 settings）
  const current: AppSettings | null = settings
    ? { ...settings, ...draft }
    : null

  // ── debounce 保存到后端 ──
  const updateSetting = useCallback((partial: Partial<AppSettings>) => {
    setDraft((prev) => ({ ...prev, ...partial }))
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      try {
        const updated = await api.settings.update(partial)
        queryClient.setQueryData(['settings'], updated)
      } catch {
        // 保存失败：静默，下次操作会重试
      }
    }, 500)
  }, [queryClient])

  // Esc 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // 清理 timer
  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
  }, [])

  // ── 渲染对应分区 ──
  const renderSection = () => {
    if (isLoading || !current) {
      return (
        <div style={{
          flex:            1,
          display:         'flex',
          alignItems:      'center',
          justifyContent:  'center',
          color:           'var(--la-text-tertiary)',
          fontSize:        'var(--la-text-sm)',
        }}>
          加载中…
        </div>
      )
    }

    const props = { settings: current, onChange: updateSetting }

    switch (activeSection) {
      case 'general':     return <GeneralSection     {...props} />
      case 'appearance':  return <AppearanceSection  {...props} />
      case 'import':      return <ImportSection      {...props} queryClient={queryClient} />
      case 'performance': return <PerformanceSection {...props} />
      case 'storage':     return <StorageSection     {...props} />
      case 'about':       return <AboutSection />
      default:            return null
    }
  }

  return (
    <motion.div
      key="settings-page"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{    opacity: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      style={{
        position:        'fixed',
        inset:           0,
        zIndex:          'var(--la-z-modal)' as unknown as number,
        backgroundColor: 'rgba(0,0,0,0.55)',
        backdropFilter:  'blur(4px)',
        display:         'flex',
        alignItems:      'center',
        justifyContent:  'center',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1,    y: 0  }}
        exit={{    opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.2, ease: [0, 0, 0.2, 1] }}
        style={{
          width:           760,
          height:          540,
          backgroundColor: 'var(--la-bg-raised)',
          border:          '1px solid var(--la-border)',
          borderRadius:    'var(--la-radius-xl)',
          boxShadow:       'var(--la-shadow-xl)',
          display:         'flex',
          flexDirection:   'column',
          overflow:        'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── 标题栏 ── */}
        <div style={{
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'space-between',
          padding:        '14px 16px 12px',
          borderBottom:   '1px solid var(--la-divider)',
          flexShrink:     0,
        }}>
          <h1 style={{
            fontSize:   'var(--la-text-base)',
            fontWeight: 'var(--la-weight-semibold)' as unknown as number,
            color:      'var(--la-text-primary)',
            margin:     0,
          }}>
            设置
          </h1>
          <button
            onClick={onClose}
            aria-label="关闭设置"
            title="关闭（Esc）"
            style={{
              display:         'flex',
              alignItems:      'center',
              justifyContent:  'center',
              width:           28,
              height:          28,
              borderRadius:    'var(--la-radius-md)',
              backgroundColor: 'transparent',
              border:          'none',
              color:           'var(--la-text-tertiary)',
              cursor:          'default',
              transition:      'all 100ms ease',
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
            <Icon name="x" size={14} strokeWidth={2} />
          </button>
        </div>

        {/* ── 主体（左导航 + 右内容）── */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>

          {/* 左侧导航 */}
          <nav
            aria-label="设置分类"
            style={{
              width:           110,
              flexShrink:      0,
              borderRight:     '1px solid var(--la-divider)',
              padding:         '8px 6px',
              display:         'flex',
              flexDirection:   'column',
              gap:             '2px',
              overflowY:       'auto',
            }}
          >
            {SECTIONS.map((sec) => (
              <SettingsNavItem
                key={sec.id}
                config={sec}
                active={activeSection === sec.id}
                onClick={() => setActiveSection(sec.id)}
              />
            ))}
          </nav>

          {/* 右侧内容区 */}
          <div style={{
            flex:      1,
            minWidth:  0,
            overflowY: 'auto',
            padding:   '20px 28px',
          }}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={activeSection}
                initial={{ opacity: 0, x: 8  }}
                animate={{ opacity: 1, x: 0  }}
                exit={{    opacity: 0, x: -8 }}
                transition={{ duration: 0.14, ease: 'easeOut' }}
              >
                {renderSection()}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
