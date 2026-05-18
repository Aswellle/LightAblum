/**
 * @file src/components/layout/StatusBar.tsx
 * @description 底部状态栏
 *
 * 布局（三段式）：
 *
 *  ┌─ [左] 照片计数 · 选中计数 ─┬─ [中] 扫描进度条 ─┬─ [右] 密度滑块 ─┐
 *  └────────────────────────────┴──────────────────┴─────────────────┘
 *
 * 左侧：
 *   - "12,345 张照片"（来自 photoStore.total）
 *   - 有选中时追加 "· 3 张已选中"
 *   - 搜索视图时追加 "· 搜索结果"
 *
 * 中间（扫描进度，仅扫描时显示）：
 *   - 进度条（0~100%）+ 百分比文字
 *   - "正在扫描 · 已发现 1,234 张"
 *   - 阶段文字：发现文件 / 建立索引 / 生成缩略图 / 完成
 *
 * 右侧：
 *   - 网格密度滑块（4 级）
 *   - 当前布局模式图标（网格/瀑布流）
 *
 * 动画：
 *   - 扫描进度区域：AnimatePresence 滑入/滑出（translateY）
 *   - 进度条：CSS transition width（线性）
 */

import { memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { usePhotoStore, selectTotal } from '@/stores/photoStore'
import { useSelectionStore, selectSelectedCount } from '@/stores/selectionStore'
import { useUiStore, selectIsScanning, selectScanProgress, selectCurrentView, selectIsPrivateAlbumUnlocked } from '@/stores/uiStore'
import { useLayoutStore, selectMode, selectDensity, selectDensityLabel } from '@/stores/layoutStore'
import { DENSITY_PRESETS, type DensityLevel } from '@/types/layout'
import type { ScanPhase } from '@/types/photo'

// ─────────────────────────────────────────────────────────
//  子组件：左侧计数区
// ─────────────────────────────────────────────────────────

const PhotoCountLabel = memo(function PhotoCountLabel() {
  const total                   = usePhotoStore(selectTotal)
  const selectedCount           = useSelectionStore(selectSelectedCount)
  const currentView             = useUiStore(selectCurrentView)
  const isPrivateAlbumUnlocked  = useUiStore(selectIsPrivateAlbumUnlocked)
  // Fix: hide count when in a locked private album
  const isLockedPrivateAlbum    = currentView.type === 'album' && !isPrivateAlbumUnlocked

  const viewLabel = currentView.type === 'search'
    ? ` · 搜索结果`
    : currentView.type === 'favorites'
    ? ` · 收藏`
    : currentView.type === 'recently_imported'
    ? ` · 最近导入`
    : currentView.type === 'trash'
    ? ` · 回收站`
    : ''

  if (isLockedPrivateAlbum) return null

  return (
    <div
      className="flex items-center gap-1"
      style={{
        fontSize: 'var(--la-text-xs)',
        color:    'var(--la-text-secondary)',
      }}
    >
      <span>
        {total.toLocaleString('zh-CN')} 张照片
        {viewLabel}
      </span>

      <AnimatePresence>
        {selectedCount > 0 && (
          <motion.span
            key="selected"
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -4 }}
            transition={{ duration: 0.15 }}
            style={{ color: 'var(--la-accent)' }}
          >
            · {selectedCount} 张已选中
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  )
})

// ─────────────────────────────────────────────────────────
//  扫描阶段文字
// ─────────────────────────────────────────────────────────

const PHASE_LABELS: Record<ScanPhase, string> = {
  discovering:           '正在发现文件',
  indexing:              '正在建立索引',
  generating_thumbnails: '正在生成缩略图',
  completed:             '扫描完成',
  error:                 '扫描出错',
}

// ─────────────────────────────────────────────────────────
//  子组件：中间扫描进度区
// ─────────────────────────────────────────────────────────

const ScanProgressBar = memo(function ScanProgressBar() {
  const isScanning  = useUiStore(selectIsScanning)
  const progress    = useUiStore(selectScanProgress)

  return (
    <AnimatePresence>
      {isScanning && progress && (
        <motion.div
          key="scan-progress"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 6 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="flex items-center gap-2 flex-1 mx-4"
          style={{ minWidth: 0 }}
        >
          {/* 阶段文字 */}
          <span
            style={{
              fontSize:  'var(--la-text-xs)',
              color:     'var(--la-text-secondary)',
              flexShrink: 0,
              whiteSpace: 'nowrap',
            }}
          >
            {PHASE_LABELS[progress.phase]}
          </span>

          {/* 进度条轨道 */}
          <div
            style={{
              flex:            1,
              height:          '3px',
              borderRadius:    '999px',
              backgroundColor: 'var(--la-bg-overlay)',
              overflow:        'hidden',
              minWidth:        '60px',
            }}
          >
            <div
              style={{
                height:          '100%',
                width:           `${progress.percent}%`,
                borderRadius:    '999px',
                backgroundColor: 'var(--la-accent)',
                transition:      'width 300ms linear',
              }}
            />
          </div>

          {/* 百分比 + 已发现数 */}
          <span
            style={{
              fontSize:   'var(--la-text-xs)',
              color:      'var(--la-text-tertiary)',
              flexShrink: 0,
              whiteSpace: 'nowrap',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {progress.percent.toFixed(0)}%
            {progress.discovered > 0 && ` · ${progress.discovered.toLocaleString('zh-CN')} 张`}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  )
})

// ─────────────────────────────────────────────────────────
//  子组件：右侧密度控制
// ─────────────────────────────────────────────────────────

const DensityControl = memo(function DensityControl() {
  const density      = useLayoutStore(selectDensity)
  const densityLabel = useLayoutStore(selectDensityLabel)
  const mode         = useLayoutStore(selectMode)
  const setDensity   = useLayoutStore((s) => s.setDensity)

  const levels = [1, 2, 3, 4] as DensityLevel[]

  return (
    <div className="flex items-center gap-3 flex-shrink-0">
      {/* 布局模式标识 */}
      <span
        style={{
          fontSize: 'var(--la-text-xs)',
          color:    'var(--la-text-tertiary)',
        }}
      >
        {mode === 'grid' ? '网格' : '瀑布流'}
      </span>

      {/* 分隔线 */}
      <div style={{ width: '1px', height: '12px', backgroundColor: 'var(--la-border)' }} />

      {/* 密度标签 */}
      <span
        style={{
          fontSize:   'var(--la-text-xs)',
          color:      'var(--la-text-secondary)',
          minWidth:   '24px',
          textAlign:  'right',
        }}
      >
        {densityLabel}
      </span>

      {/* 密度段式滑块（4 个点） */}
      <div
        className="flex items-center gap-1"
        role="group"
        aria-label="网格密度"
      >
        {levels.map((level) => {
          const preset  = DENSITY_PRESETS[level]
          const active  = density === level
          const colSize = Math.round(16 - (level - 1) * 3)  // 视觉上"紧凑→大"

          return (
            <button
              key={level}
              onClick={() => setDensity(level)}
              title={`${preset.label}（${preset.columns} 列）`}
              aria-label={`密度：${preset.label}`}
              aria-pressed={active}
              style={{
                width:           `${colSize + 4}px`,
                height:          '18px',
                padding:         '2px',
                borderRadius:    '3px',
                border:          `1px solid ${active ? 'var(--la-accent)' : 'var(--la-border)'}`,
                backgroundColor: active ? 'var(--la-accent-subtle)' : 'transparent',
                cursor:          'default',
                transition:      'all 100ms ease',
                display:         'flex',
                alignItems:      'center',
                justifyContent:  'center',
              }}
              onMouseEnter={(e) => {
                if (!active) {
                  e.currentTarget.style.borderColor = 'var(--la-border-strong)'
                  e.currentTarget.style.backgroundColor = 'var(--la-bg-hover)'
                }
              }}
              onMouseLeave={(e) => {
                if (!active) {
                  e.currentTarget.style.borderColor = 'var(--la-border)'
                  e.currentTarget.style.backgroundColor = 'transparent'
                }
              }}
            >
              {/* 迷你网格图标：用小方块矩阵表示密度 */}
              <DensityIcon level={level} active={active} />
            </button>
          )
        })}
      </div>

      {/* Ctrl+滚轮 提示 */}
      <span
        style={{
          fontSize: 'var(--la-text-xs)',
          color:    'var(--la-text-tertiary)',
        }}
        title="按住 Ctrl 并滚动鼠标滚轮调整密度"
      >
        Ctrl+滚轮
      </span>
    </div>
  )
})

/** 密度等级迷你图标（用小圆点矩阵表示列数） */
function DensityIcon({ level, active }: { level: DensityLevel; active: boolean }) {
  // level 1 = 3×3 密集点，level 4 = 2×2 稀疏点
  const gridMap: Record<DensityLevel, number[][]> = {
    1: [[1,1,1],[1,1,1],[1,1,1]],
    2: [[1,1,1],[1,1,1]],
    3: [[1,1],[1,1],[1,1]],
    4: [[1,1],[1,1]],
  }
  const grid = gridMap[level]
  const dotSize = level <= 2 ? 1.5 : 2.5

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
      {grid.map((row, ri) => (
        <div key={ri} style={{ display: 'flex', gap: '1px' }}>
          {row.map((_, ci) => (
            <div
              key={ci}
              style={{
                width:           `${dotSize}px`,
                height:          `${dotSize}px`,
                borderRadius:    '0.5px',
                backgroundColor: active ? 'var(--la-accent)' : 'var(--la-text-tertiary)',
              }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────
//  StatusBar — 主组件
// ─────────────────────────────────────────────────────────

export const StatusBar = memo(function StatusBar() {
  return (
    <footer
      className="flex items-center flex-shrink-0 px-4"
      style={{
        height:          'var(--la-statusbar-h)',
        backgroundColor: 'var(--la-bg-statusbar)',
        borderTop:       '1px solid var(--la-border)',
        gap:             '8px',
        overflow:        'hidden',
      }}
    >
      {/* 左：照片计数 */}
      <div className="flex-shrink-0">
        <PhotoCountLabel />
      </div>

      {/* 中：扫描进度（flex-1 自动撑开，AnimatePresence 控制显隐） */}
      <ScanProgressBar />

      {/* 右：密度控制（始终可见） */}
      <div className="flex-shrink-0 ml-auto">
        <DensityControl />
      </div>
    </footer>
  )
})
