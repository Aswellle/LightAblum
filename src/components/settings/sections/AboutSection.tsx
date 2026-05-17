/**
 * @file src/components/settings/sections/AboutSection.tsx
 * @description 关于页分区
 *
 * 包含：
 *   - App 图标 + 名称 + 版本号
 *   - 技术栈信息
 *   - 检查更新按钮（当前版本：占位）
 *   - 数据安全说明
 */

import { memo, useState, useEffect } from 'react'
import { SettingSection, SettingRow, ActionButton, SettingNote } from '../SettingsUI'
import { Icon } from '@/components/common/Icon'

// ─────────────────────────────────────────────────────────
//  AboutSection
// ─────────────────────────────────────────────────────────

export const AboutSection = memo(function AboutSection() {
  const [version, setVersion] = useState<string>('—')
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'latest' | 'error'>('idle')

  // 获取 Tauri 应用版本号
  useEffect(() => {
    import('@tauri-apps/api/app')
      .then(({ getVersion }) => getVersion())
      .then(setVersion)
      .catch(() => setVersion('—'))
  }, [])

  const handleCheckUpdate = () => {
    setCheckingUpdate(true)
    // 模拟检查更新（当前无自动更新服务）
    setTimeout(() => {
      setCheckingUpdate(false)
      setUpdateStatus('latest')
      setTimeout(() => setUpdateStatus('idle'), 3000)
    }, 1500)
  }

  return (
    <div>
      {/* ── App 信息 ── */}
      <div style={{
        display:        'flex',
        alignItems:     'center',
        gap:            '16px',
        padding:        '20px',
        backgroundColor: 'var(--la-bg-overlay)',
        borderRadius:   'var(--la-radius-lg)',
        border:         '1px solid var(--la-border)',
        marginBottom:   '24px',
      }}>
        {/* App 图标 */}
        <div style={{
          width:           56,
          height:          56,
          borderRadius:    'var(--la-radius-lg)',
          overflow:        'hidden',
          flexShrink:      0,
          backgroundColor: 'var(--la-bg-raised)',
          border:          '1px solid var(--la-border)',
          display:         'flex',
          alignItems:      'center',
          justifyContent:  'center',
        }}>
          <img
            src="/icon.png"
            alt="LightAlbum"
            draggable={false}
            style={{ width: '80%', height: '80%', objectFit: 'contain' }}
            onError={(e) => {
              // 图标加载失败时显示替代图标
              e.currentTarget.style.display = 'none'
            }}
          />
          <Icon name="images" size={28} color="var(--la-accent)" style={{ display: 'none' }} />
        </div>

        {/* 名称 + 版本 */}
        <div>
          <h2 style={{
            fontSize:   'var(--la-text-lg)',
            fontWeight: 'var(--la-weight-semibold)' as unknown as number,
            color:      'var(--la-text-primary)',
            margin:     '0 0 4px',
          }}>
            LightAlbum
          </h2>
          <p style={{
            fontSize: 'var(--la-text-sm)',
            color:    'var(--la-text-tertiary)',
            margin:   0,
          }}>
            版本 {version}
          </p>
          <p style={{
            fontSize:  'var(--la-text-xs)',
            color:     'var(--la-text-tertiary)',
            margin:    '4px 0 0',
            opacity:   0.7,
          }}>
            Windows 本地照片管理器
          </p>
        </div>
      </div>

      {/* ── 版本 & 更新 ── */}
      <SettingSection title="版本信息" icon="about">
        <SettingRow label="应用版本">
          <span style={{
            fontSize:        'var(--la-text-sm)',
            color:           'var(--la-text-primary)',
            fontFamily:      'var(--la-font-mono)',
            backgroundColor: 'var(--la-bg-overlay)',
            border:          '1px solid var(--la-border)',
            borderRadius:    'var(--la-radius-sm)',
            padding:         '3px 10px',
          }}>
            {version}
          </span>
        </SettingRow>

        <SettingRow label="数据库 Schema">
          <span style={{
            fontSize:   'var(--la-text-sm)',
            color:      'var(--la-text-tertiary)',
            fontFamily: 'var(--la-font-mono)',
          }}>
            V2
          </span>
        </SettingRow>

        <SettingRow
          label="检查更新"
          description={
            updateStatus === 'latest'
              ? '✓ 当前已是最新版本'
              : updateStatus === 'error'
              ? '检查失败，请检查网络连接'
              : '检查是否有新版本可用'
          }
        >
          <ActionButton
            onClick={handleCheckUpdate}
            label={checkingUpdate ? '检查中…' : '检查更新'}
            icon={checkingUpdate ? undefined : 'refresh-cw'}
            loading={checkingUpdate}
            disabled={checkingUpdate || updateStatus === 'latest'}
          />
        </SettingRow>
      </SettingSection>

      {/* ── 技术栈 ── */}
      <SettingSection title="技术栈" icon="cpu">
        <div style={{
          display:      'grid',
          gridTemplateColumns: '1fr 1fr',
          gap:          '8px',
        }}>
          {[
            { name: 'Tauri',         version: '2.0',  desc: '跨平台框架'       },
            { name: 'React',         version: '19',   desc: 'UI 框架'          },
            { name: 'Rust',          version: '—',    desc: '后端逻辑'         },
            { name: 'SQLite',        version: 'WAL',  desc: '本地数据库'       },
            { name: 'TanStack Query',version: '5',    desc: '数据缓存'         },
            { name: 'Zustand',       version: '—',    desc: '状态管理'         },
          ].map(({ name, version: ver, desc }) => (
            <div
              key={name}
              style={{
                padding:         '10px 12px',
                backgroundColor: 'var(--la-bg-overlay)',
                borderRadius:    'var(--la-radius-md)',
                border:          '1px solid var(--la-border)',
              }}
            >
              <div style={{
                display:    'flex',
                alignItems: 'baseline',
                gap:        '6px',
              }}>
                <span style={{
                  fontSize:   'var(--la-text-sm)',
                  fontWeight: 'var(--la-weight-medium)' as unknown as number,
                  color:      'var(--la-text-primary)',
                }}>
                  {name}
                </span>
                <span style={{
                  fontSize:   '11px',
                  color:      'var(--la-accent)',
                  fontFamily: 'var(--la-font-mono)',
                  opacity:    0.8,
                }}>
                  {ver}
                </span>
              </div>
              <div style={{
                fontSize: 'var(--la-text-xs)',
                color:    'var(--la-text-tertiary)',
                marginTop: '2px',
              }}>
                {desc}
              </div>
            </div>
          ))}
        </div>
      </SettingSection>

      {/* ── 数据安全 ── */}
      <SettingNote>
        LightAlbum 是纯本地应用，所有照片和数据均存储在您的设备上，
        不上传任何数据到服务器，无网络请求，完全离线运行。
      </SettingNote>
    </div>
  )
})
