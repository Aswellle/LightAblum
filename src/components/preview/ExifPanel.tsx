/**
 * @file src/components/preview/ExifPanel.tsx
 * @description 大图预览右侧 EXIF 信息面板（v2 — 修复两处 Bug + 非相机照片信息展示）
 *
 * BugFix 1 — enabled: isOpen 导致首次打开面板时查询不触发
 *   根因：ExifPanel 被 PhotoPreview 持久挂载（非条件渲染）。
 *   isExifOpen 默认 false，enabled=false → 查询从不注册。
 *   用户点击「信息」按钮打开面板时，AnimatePresence 让 isOpen 变 true，
 *   但同一渲染帧内 useQuery 仍读到旧 isOpen=false（React 批处理时序），
 *   导致 enabled=false，查询不触发，photo=undefined，所有字段空白。
 *   修复：移除 enabled gate，始终启用查询（PhotoPreview 打开时即后台拉取），
 *   面板可见性由外层 AnimatePresence {isOpen && <motion.aside>} 控制。
 *
 * BugFix 2 — photo.exposureComp !== undefined 判断错误
 *   根因：Rust Option<f64>=None → JSON null。
 *   JavaScript 中 null !== undefined 为 TRUE，导致相机参数区块守卫条件
 *   永远为 true（即使没有任何相机参数），区块始终渲染（但内容全空）。
 *   修复：改用 != null（宽松不等，同时排除 null 和 undefined）。
 *
 * v2 改进 — 非相机照片（截图/社交媒体保存图）的信息展示
 *   对于没有 EXIF 相机参数的照片，面板仍完整展示：
 *   - 文件区：文件名、格式、分辨率、文件大小、文件路径
 *   - 时间区：导入时间、文件修改时间
 *   - 相机区：仅当至少一个相机参数存在时才显示
 *   同时在面板顶部显示「无拍摄信息」提示标签（截图/保存图）。
 */

import { memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/services/tauriIpc'
import { usePreviewStore, selectIsExifOpen } from '@/stores/previewStore'
import { Icon } from '@/components/common/Icon'
import { FORMAT_LABELS } from '@/types/photo'

// ─────────────────────────────────────────────────────────
//  信息行组件
// ─────────────────────────────────────────────────────────

interface InfoRowProps {
  label:  string
  value:  string | null | undefined
  mono?:  boolean
}

const InfoRow = memo(function InfoRow({ label, value, mono }: InfoRowProps) {
  if (!value) return null
  return (
    <div style={{ marginBottom: '10px' }}>
      <dt style={{
        fontSize:      'var(--la-text-xs)',
        color:         'var(--la-text-tertiary)',
        marginBottom:  '2px',
        letterSpacing: '0.03em',
      }}>
        {label}
      </dt>
      <dd style={{
        fontSize:   mono ? 'var(--la-text-xs)' : 'var(--la-text-sm)',
        color:      'var(--la-text-primary)',
        lineHeight: 'var(--la-leading-normal)',
        wordBreak:  'break-all',
        fontFamily: mono ? 'var(--la-font-mono)' : undefined,
        margin:     0,
      } as React.CSSProperties}>
        {value}
      </dd>
    </div>
  )
})

// ─────────────────────────────────────────────────────────
//  分组标题
// ─────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{
      fontSize:      'var(--la-text-xs)',
      fontWeight:    'var(--la-weight-semibold)' as unknown as number,
      color:         'var(--la-text-tertiary)',
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      margin:        '16px 0 8px',
      paddingBottom: '4px',
      borderBottom:  '1px solid var(--la-divider)',
    }}>
      {children}
    </h3>
  )
}

// ─────────────────────────────────────────────────────────
//  格式化工具
// ─────────────────────────────────────────────────────────

function formatDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null
  try {
    const d = new Date(iso)
    return d.toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
  } catch { return iso }
}

function formatFileSize(bytes: number | null | undefined): string | null {
  if (bytes == null) return null
  if (bytes < 1024)       return `${bytes} B`
  if (bytes < 1048576)    return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(2)} MB`
  return `${(bytes / 1073741824).toFixed(2)} GB`
}

// ─────────────────────────────────────────────────────────
//  ExifPanel — 主组件
// ─────────────────────────────────────────────────────────

interface ExifPanelProps {
  photoId: string
}

export const ExifPanel = memo(function ExifPanel({ photoId }: ExifPanelProps) {
  const isOpen     = usePreviewStore(selectIsExifOpen)
  const toggleExif = usePreviewStore((s) => s.toggleExif)

  // BugFix 1：移除 enabled: isOpen，始终启用查询。
  // 原来 enabled=false（isExifOpen 默认 false）导致查询从不注册，
  // 面板打开后 React 批处理时序问题导致同帧内 enabled 仍为 false，
  // photo 始终为 undefined，所有字段空白。
  // 现在 PhotoPreview 打开时即在后台拉取，面板打开时数据已就绪。
  const { data: photo, isLoading, isError } = useQuery({
    queryKey:  ['photo', photoId],
    queryFn:   () => api.photos.get(photoId),
    staleTime: 30 * 1000,
    gcTime:    0,
    retry:     1,
  })

  // BugFix 2：判断是否有相机参数
  // 原来用 !== undefined，Rust None → JSON null，
  // null !== undefined 为 TRUE → 相机区块即使全空也强制渲染。
  // 修复：用 != null（同时排除 null 和 undefined）。
  const hasCamera = photo && (
    photo.cameraMake   != null ||
    photo.cameraModel  != null ||
    photo.lensModel    != null ||
    photo.aperture     != null ||
    photo.shutterSpeed != null ||
    photo.iso          != null ||
    photo.focalLength  != null ||
    photo.exposureComp != null
  )

  // v2：判断是否为无相机 EXIF 的截图/保存图
  const isNonCameraPhoto = photo && !hasCamera

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.aside
          key="exif-panel"
          initial={{ x: '100%', opacity: 0 }}
          animate={{ x: 0,      opacity: 1 }}
          exit={{    x: '100%', opacity: 0 }}
          transition={{ duration: 0.25, ease: [0, 0, 0.2, 1] }}
          style={{
            width:           'var(--la-exif-panel-w)',
            flexShrink:      0,
            height:          '100%',
            backgroundColor: 'rgba(28,28,30,0.92)',
            backdropFilter:  'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            borderLeft:      '1px solid rgba(255,255,255,0.1)',
            display:         'flex',
            flexDirection:   'column',
            overflow:        'hidden',
            // 修复：面板背景始终为深色，强制子树使用深色模式文字颜色
            // 在浅色主题下 --la-text-primary = #1D1D1F（深色），
            // 与深色面板背景叠加导致文字不可见。
            // CSS 自定义属性可在任意元素上内联覆盖，作用域限于子树。
            '--la-text-primary':    '#F5F5F7',
            '--la-text-secondary':  '#98989D',
            '--la-text-tertiary':   '#636366',
            '--la-text-disabled':   '#48484A',
            '--la-divider':         'rgba(255,255,255,0.1)',
            '--la-bg-overlay':      'rgba(255,255,255,0.06)',
            '--la-bg-hover':        'rgba(255,255,255,0.1)',
          } as React.CSSProperties}
        >
          {/* 面板标题栏 */}
          <div style={{
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'space-between',
            padding:        '14px 16px 10px',
            borderBottom:   '1px solid var(--la-divider)',
            flexShrink:     0,
          }}>
            <h2 style={{
              fontSize:   'var(--la-text-sm)',
              fontWeight: 'var(--la-weight-semibold)' as unknown as number,
              color:      'var(--la-text-primary)',
              margin:     0,
            }}>
              照片信息
            </h2>
            <button
              onClick={toggleExif}
              aria-label="关闭信息面板"
              style={{
                display:         'flex',
                alignItems:      'center',
                justifyContent:  'center',
                width:           '24px',
                height:          '24px',
                borderRadius:    'var(--la-radius-sm)',
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

          {/* 内容区（滚动）*/}
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 16px 20px' }}>

            {isLoading ? (
              // 加载骨架
              <div style={{ paddingTop: '16px' }}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} style={{ marginBottom: '12px' }}>
                    <div style={{
                      height: '10px', width: '40%', borderRadius: '4px',
                      backgroundColor: 'var(--la-bg-overlay)', marginBottom: '4px',
                      animation: 'la-shimmer 1.5s linear infinite',
                      backgroundImage: 'linear-gradient(90deg,var(--la-bg-overlay) 0%,var(--la-bg-hover) 50%,var(--la-bg-overlay) 100%)',
                      backgroundSize: '200% 100%',
                    }} />
                    <div style={{
                      height: '13px', width: '75%', borderRadius: '4px',
                      backgroundColor: 'var(--la-bg-overlay)',
                      animation: 'la-shimmer 1.5s linear infinite',
                      animationDelay: '0.1s',
                      backgroundImage: 'linear-gradient(90deg,var(--la-bg-overlay) 0%,var(--la-bg-hover) 50%,var(--la-bg-overlay) 100%)',
                      backgroundSize: '200% 100%',
                    }} />
                  </div>
                ))}
              </div>

            ) : isError ? (
              <div style={{
                paddingTop:  '24px',
                textAlign:   'center',
                color:       'var(--la-text-tertiary)',
                fontSize:    'var(--la-text-sm)',
                lineHeight:  '1.5',
              }}>
                <Icon name="x" size={20} color="var(--la-text-tertiary)" style={{ marginBottom: '8px' }} />
                <p style={{ margin: 0 }}>照片信息加载失败</p>
                <p style={{ margin: '4px 0 0', fontSize: 'var(--la-text-xs)', opacity: 0.7 }}>
                  请重新打开预览
                </p>
              </div>

            ) : photo ? (
              <dl style={{ margin: 0, padding: 0, listStyle: 'none' }}>

                {/* v2 改进：非相机照片提示标签 */}
                {isNonCameraPhoto && (
                  <div style={{
                    display:         'inline-flex',
                    alignItems:      'center',
                    gap:             '5px',
                    marginTop:       '12px',
                    marginBottom:    '4px',
                    padding:         '4px 10px',
                    borderRadius:    'var(--la-radius-full)',
                    backgroundColor: 'rgba(255,255,255,0.07)',
                    border:          '1px solid var(--la-border)',
                  }}>
                    <Icon name="info" size={11} color="var(--la-text-tertiary)" />
                    <span style={{ fontSize: '11px', color: 'var(--la-text-tertiary)', letterSpacing: '0.02em' }}>
                      截图 / 保存图片（无拍摄信息）
                    </span>
                  </div>
                )}

                {/* ── 文件信息 ── */}
                <SectionTitle>文件</SectionTitle>
                <InfoRow label="文件名" value={photo.fileName} />
                <InfoRow
                  label="格式"
                  value={FORMAT_LABELS[photo.format] ?? photo.format.toUpperCase()}
                />
                <InfoRow
                  label="尺寸"
                  value={photo.width && photo.height
                    ? `${photo.width} × ${photo.height} 像素`
                    : null
                  }
                />
                <InfoRow label="大小"   value={formatFileSize(photo.fileSize)} />
                <InfoRow label="路径"   value={photo.filePath} mono />

                {/* ── 时间信息 ── */}
                <SectionTitle>时间</SectionTitle>
                <InfoRow label="拍摄时间" value={formatDateTime(photo.createdAt)} />
                <InfoRow label="修改时间" value={formatDateTime(photo.modifiedAt)} />
                <InfoRow label="导入时间" value={formatDateTime(photo.importedAt)} />

                {/* ── 相机参数（BugFix 2：!= null 替代 !== undefined）── */}
                {hasCamera && (
                  <>
                    <SectionTitle>相机</SectionTitle>
                    <InfoRow
                      label="相机"
                      value={[photo.cameraMake, photo.cameraModel].filter(Boolean).join(' ') || null}
                    />
                    <InfoRow label="镜头"   value={photo.lensModel} />
                    <InfoRow label="光圈"   value={photo.aperture ? `f/${photo.aperture}` : null} />
                    <InfoRow label="快门"   value={photo.shutterSpeed} />
                    <InfoRow label="ISO"    value={photo.iso?.toString()} />
                    <InfoRow label="焦距"   value={photo.focalLength ? `${photo.focalLength} mm` : null} />
                    <InfoRow
                      label="曝光补偿"
                      value={photo.exposureComp != null
                        ? `${photo.exposureComp >= 0 ? '+' : ''}${photo.exposureComp} EV`
                        : null
                      }
                    />
                  </>
                )}

                {/* ── GPS（若有）── */}
                {photo.gpsLat != null && photo.gpsLng != null && (
                  <>
                    <SectionTitle>位置</SectionTitle>
                    <InfoRow
                      label="GPS 坐标"
                      value={`${photo.gpsLat.toFixed(6)}, ${photo.gpsLng.toFixed(6)}`}
                      mono
                    />
                  </>
                )}

              </dl>

            ) : null}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
})
