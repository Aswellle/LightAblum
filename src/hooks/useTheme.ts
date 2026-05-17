/**
 * @file src/hooks/useTheme.ts
 * @description 主题管理 + 布局偏好初始化 Hook
 *
 * v2 变更（Technical Debt T-04）：
 *   在 settings_get 返回时，同时将 sortBy / sortAsc 写入 layoutStore，
 *   避免需要新增独立的 init hook。
 *
 * 职责：
 *   1. 读取 uiStore 中的 theme 偏好
 *   2. 监听系统深色模式变化
 *   3. 向 <html> 注入 'dark' / 'light' 类名
 *   4. 从 AppSettings 恢复 theme + sortBy + sortAsc + density + mode
 *   5. 用户切换主题时 debounce 保存到 AppSettings
 */

import { useEffect, useRef, useCallback } from 'react'
import { useUiStore, selectTheme } from '@/stores/uiStore'
import { useLayoutStore } from '@/stores/layoutStore'
import { api } from '@/services/tauriIpc'
import type { AppTheme } from '@/types/ipc'

// ─────────────────────────────────────────────────────────
//  内部工具
// ─────────────────────────────────────────────────────────

const systemDarkMQ = typeof window !== 'undefined'
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : null

function resolveTheme(theme: AppTheme): 'light' | 'dark' {
  if (theme === 'system') return systemDarkMQ?.matches ? 'dark' : 'light'
  return theme
}

function applyThemeClass(resolved: 'light' | 'dark'): void {
  const root = document.documentElement
  root.classList.remove('light', 'dark')
  root.classList.add(resolved)
}

// ─────────────────────────────────────────────────────────
//  useTheme — App 根挂载一次
// ─────────────────────────────────────────────────────────

export function useTheme(): void {
  const theme        = useUiStore(selectTheme)
  const setTheme     = useUiStore((s) => s.setTheme)
  const setResolved  = useUiStore((s) => s.setResolvedTheme)
  const initLayout   = useLayoutStore((s) => s.init)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── 启动：从 AppSettings 恢复所有持久化偏好 ──
  useEffect(() => {
    api.settings.get()
      .then((settings) => {
        // 主题
        setTheme(settings.theme)
        // 布局偏好（T-04 新增：排序参数）
        initLayout({
          mode:    'grid',                     // 布局模式不持久化，每次启动默认网格
          density: settings.gridDensity,
          sortBy:  settings.sortBy,
          sortAsc: settings.sortAsc,
        })
      })
      .catch(() => {
        // 读取失败：使用默认值，不中断启动流程
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── 主题变化：更新 DOM + resolvedTheme ──
  useEffect(() => {
    const applyAndSync = () => {
      const resolved = resolveTheme(theme)
      applyThemeClass(resolved)
      setResolved(resolved)
    }

    applyAndSync()

    if (theme === 'system' && systemDarkMQ) {
      systemDarkMQ.addEventListener('change', applyAndSync)
      return () => systemDarkMQ.removeEventListener('change', applyAndSync)
    }
  }, [theme, setResolved])

  // ── 主题变化：debounce 持久化 ──
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      api.settings.update({ theme }).catch(() => {})
    }, 500)
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [theme])
}

// ─────────────────────────────────────────────────────────
//  useThemeToggle — 供 UI 控件使用
// ─────────────────────────────────────────────────────────

export interface ThemeToggleResult {
  theme:         AppTheme
  resolvedTheme: 'light' | 'dark'
  isDark:        boolean
  setTheme:      (t: AppTheme) => void
  toggle:        () => void
}

export function useThemeToggle(): ThemeToggleResult {
  const theme        = useUiStore(selectTheme)
  const resolvedTheme = useUiStore((s) => s.resolvedTheme)
  const setTheme     = useUiStore((s) => s.setTheme)

  const toggle = useCallback(() => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
  }, [resolvedTheme, setTheme])

  return { theme, resolvedTheme, isDark: resolvedTheme === 'dark', setTheme, toggle }
}
