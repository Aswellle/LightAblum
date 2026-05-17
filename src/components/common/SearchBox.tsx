/**
 * @file src/components/common/SearchBox.tsx
 * @description 顶部搜索框组件
 *
 * 交互规格（PRD §4.1 M-8）：
 *   - 默认收起态：胶囊形图标+占位符，宽度 200px
 *   - 聚焦展开态：宽度 320px（动画），显示最近搜索历史
 *   - 输入时 debounce 200ms 触发搜索
 *   - Esc 清空 + 失焦收起
 *   - Ctrl+F 全局快捷键聚焦（由本组件自身监听）
 *   - 有内容时显示清除按钮 ×
 *   - 搜索中显示加载 spinner
 *
 * 对 uiStore 的影响：
 *   - setSearchQuery(q)  → 写入搜索关键词
 *   - setSearchOpen(v)   → 控制展开/收起
 *   - setView({ type: 'search', query: q }) → 切换到搜索视图
 *   - 清空搜索 → setView({ type: 'all_photos' }) 回到主视图
 *
 * 最近搜索历史：
 *   存储在 localStorage（key: 'la:search-history'），最多 8 条
 *
 * Phase-C（搜索增强）：
 *   用户开始输入时，调用 api.search.suggestions() 获取三路补全：
 *     - 文件名匹配列表（fileNames）
 *     - 相机型号列表（cameras）
 *     - 标签名称列表（tags，来自 tags 表，按 usage_count 降序）
 *   历史下拉和建议下拉互斥显示：
 *     - 无输入 + 聚焦 → 历史下拉
 *     - 有输入 + 建议非空 → 建议下拉（替代历史）
 *   debounce 300ms 后触发建议请求，与 200ms 搜索触发共存互不干扰。
 */

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  memo,
} from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useUiStore, selectIsSearchOpen, selectSearchQuery } from '@/stores/uiStore'
import { Icon } from '@/components/common/Icon'
import { api } from '@/services/tauriIpc'
import type { TagSuggestion } from '@/types/ipc'

// ─────────────────────────────────────────────────────────
//  搜索历史工具
// ─────────────────────────────────────────────────────────

const HISTORY_KEY    = 'la:search-history'
const HISTORY_LIMIT  = 8

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

function saveHistory(query: string): void {
  try {
    const prev = loadHistory().filter((h) => h !== query)
    const next = [query, ...prev].slice(0, HISTORY_LIMIT)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
  } catch { /* quota exceeded, ignore */ }
}

function clearHistory(): void {
  try { localStorage.removeItem(HISTORY_KEY) } catch { /* */ }
}

// ─────────────────────────────────────────────────────────
//  Debounce Hook
// ─────────────────────────────────────────────────────────

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

// ─────────────────────────────────────────────────────────
//  HistoryDropdown
// ─────────────────────────────────────────────────────────

interface HistoryDropdownProps {
  history:     string[]
  onSelect:    (q: string) => void
  onClearAll:  () => void
  visible:     boolean
}

const HistoryDropdown = memo(function HistoryDropdown({
  history, onSelect, onClearAll, visible,
}: HistoryDropdownProps) {
  if (!visible || history.length === 0) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: -4, scaleY: 0.96 }}
      animate={{ opacity: 1, y: 0,  scaleY: 1    }}
      exit={{    opacity: 0, y: -4, scaleY: 0.96 }}
      transition={{ duration: 0.14, ease: 'easeOut' }}
      style={{
        position:        'absolute',
        top:             'calc(100% + 6px)',
        left:            0,
        right:           0,
        backgroundColor: 'var(--la-bg-raised)',
        border:          '1px solid var(--la-border)',
        borderRadius:    'var(--la-radius-lg)',
        boxShadow:       'var(--la-shadow-lg)',
        overflow:        'hidden',
        zIndex:          'var(--la-z-dropdown)' as unknown as number,
        transformOrigin: 'top center',
      }}
    >
      {/* 标题行 */}
      <div style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        padding:        '8px 12px 4px',
      }}>
        <span style={{
          fontSize:   'var(--la-text-xs)',
          color:      'var(--la-text-tertiary)',
          fontWeight: 'var(--la-weight-medium)',
        }}>
          最近搜索
        </span>
        <button
          onClick={onClearAll}
          style={{
            fontSize:        'var(--la-text-xs)',
            color:           'var(--la-text-tertiary)',
            backgroundColor: 'transparent',
            border:          'none',
            cursor:          'default',
            padding:         '2px 4px',
            borderRadius:    'var(--la-radius-sm)',
            transition:      'color 100ms ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--la-danger)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--la-text-tertiary)' }}
        >
          清除历史
        </button>
      </div>

      {/* 历史条目 */}
      <ul style={{ listStyle: 'none', padding: '4px 0 6px' }}>
        {history.map((item) => (
          <li key={item}>
            <button
              onClick={() => onSelect(item)}
              style={{
                display:         'flex',
                alignItems:      'center',
                gap:             '8px',
                width:           '100%',
                padding:         '7px 12px',
                textAlign:       'left',
                backgroundColor: 'transparent',
                border:          'none',
                cursor:          'default',
                color:           'var(--la-text-secondary)',
                fontSize:        'var(--la-text-sm)',
                transition:      'background-color 80ms ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--la-bg-hover)'
                e.currentTarget.style.color = 'var(--la-text-primary)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent'
                e.currentTarget.style.color = 'var(--la-text-secondary)'
              }}
            >
              <Icon name="clock" size={13} color="var(--la-text-tertiary)" />
              <span style={{ flex: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                {item}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </motion.div>
  )
})

// ─────────────────────────────────────────────────────────
//  Phase-C：SuggestionsDropdown — 三路自动补全下拉
// ─────────────────────────────────────────────────────────

interface SuggestionsDropdownProps {
  fileNames:  string[]
  cameras:    string[]
  tags:       TagSuggestion[]
  onSelect:   (q: string) => void
  visible:    boolean
}

const SuggestionsDropdown = memo(function SuggestionsDropdown({
  fileNames, cameras, tags, onSelect, visible,
}: SuggestionsDropdownProps) {
  const hasAny = fileNames.length > 0 || cameras.length > 0 || tags.length > 0
  if (!visible || !hasAny) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: -4, scaleY: 0.96 }}
      animate={{ opacity: 1, y: 0,  scaleY: 1    }}
      exit={{    opacity: 0, y: -4, scaleY: 0.96 }}
      transition={{ duration: 0.14, ease: 'easeOut' }}
      style={{
        position:        'absolute',
        top:             'calc(100% + 6px)',
        left:            0,
        right:           0,
        backgroundColor: 'var(--la-bg-raised)',
        border:          '1px solid var(--la-border)',
        borderRadius:    'var(--la-radius-lg)',
        boxShadow:       'var(--la-shadow-lg)',
        overflow:        'hidden',
        zIndex:          'var(--la-z-dropdown)' as unknown as number,
        transformOrigin: 'top center',
        maxHeight:       '280px',
        overflowY:       'auto',
      }}
    >
      {/* 标签建议 */}
      {tags.length > 0 && (
        <SuggSection
          label="标签"
          items={tags.map((t) => ({
            key:   t.id,
            text:  t.name,
            icon:  (
              <span style={{
                width:           '8px',
                height:          '8px',
                borderRadius:    '50%',
                backgroundColor: t.color,
                display:         'inline-block',
                flexShrink:      0,
              }} />
            ),
            query: `#${t.name}`,
          }))}
          onSelect={onSelect}
        />
      )}

      {/* 文件名建议 */}
      {fileNames.length > 0 && (
        <SuggSection
          label="文件名"
          items={fileNames.map((n) => ({
            key:   n,
            text:  n,
            icon:  <Icon name="images" size={12} color="var(--la-text-tertiary)" />,
            query: n,
          }))}
          onSelect={onSelect}
        />
      )}

      {/* 相机型号建议 */}
      {cameras.length > 0 && (
        <SuggSection
          label="相机"
          items={cameras.map((c) => ({
            key:   c,
            text:  c,
            icon:  <Icon name="camera" size={12} color="var(--la-text-tertiary)" />,
            query: c,
          }))}
          onSelect={onSelect}
        />
      )}
    </motion.div>
  )
})

interface SuggItem {
  key:   string
  text:  string
  icon:  React.ReactNode
  query: string
}

function SuggSection({ label, items, onSelect }: {
  label:    string
  items:    SuggItem[]
  onSelect: (q: string) => void
}) {
  return (
    <div>
      <div style={{
        padding:      '6px 12px 2px',
        fontSize:     'var(--la-text-xs)',
        color:        'var(--la-text-tertiary)',
        fontWeight:   'var(--la-weight-medium)',
        letterSpacing:'0.04em',
        textTransform:'uppercase',
      }}>
        {label}
      </div>
      <ul style={{ listStyle: 'none', padding: '0 0 4px' }}>
        {items.map((item) => (
          <li key={item.key}>
            <button
              onClick={() => onSelect(item.query)}
              style={{
                display:         'flex',
                alignItems:      'center',
                gap:             '8px',
                width:           '100%',
                padding:         '6px 12px',
                textAlign:       'left',
                backgroundColor: 'transparent',
                border:          'none',
                cursor:          'default',
                color:           'var(--la-text-secondary)',
                fontSize:        'var(--la-text-sm)',
                transition:      'background-color 80ms ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--la-bg-hover)'
                e.currentTarget.style.color = 'var(--la-text-primary)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent'
                e.currentTarget.style.color = 'var(--la-text-secondary)'
              }}
            >
              {item.icon}
              <span style={{
                flex: 1, overflow: 'hidden',
                whiteSpace: 'nowrap', textOverflow: 'ellipsis',
              }}>
                {item.text}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ─────────────────────────────────────────────────────────
//  SearchBox — 主组件
// ─────────────────────────────────────────────────────────

export const SearchBox = memo(function SearchBox() {
  const isOpen      = useUiStore(selectIsSearchOpen)
  const query       = useUiStore(selectSearchQuery)
  const setOpen     = useUiStore((s) => s.setSearchOpen)
  const setQuery    = useUiStore((s) => s.setSearchQuery)
  const setView     = useUiStore((s) => s.setView)

  const inputRef    = useRef<HTMLInputElement>(null)
  const wrapperRef  = useRef<HTMLDivElement>(null)
  const [history, setHistory] = useState<string[]>([])
  const [showHistory, setShowHistory] = useState(false)

  // Phase-C：建议状态
  const [suggestions, setSuggestions] = useState<{
    fileNames: string[]
    cameras:   string[]
    tags:      TagSuggestion[]
  }>({ fileNames: [], cameras: [], tags: [] })
  const [showSuggestions, setShowSuggestions] = useState(false)

  const debouncedQuery = useDebounce(query, 200)
  // Phase-C：建议请求使用 300ms debounce（略长于搜索触发，避免竞争）
  const debouncedSuggQuery = useDebounce(query, 300)

  // ── debounce 后触发视图切换 ──────────────────────────
  useEffect(() => {
    const q = debouncedQuery.trim()
    if (q.length === 0) return
    setView({ type: 'search', query: q })
  }, [debouncedQuery, setView])

  // ── Phase-C：debounce 后获取建议 ────────────────────
  useEffect(() => {
    const q = debouncedSuggQuery.trim()
    if (q.length < 1) {
      setSuggestions({ fileNames: [], cameras: [], tags: [] })
      setShowSuggestions(false)
      return
    }
    let cancelled = false
    api.search.suggestions(q, 5).then((res) => {
      if (cancelled) return
      const hasAny = res.fileNames.length > 0 || res.cameras.length > 0 || res.tags.length > 0
      setSuggestions({ fileNames: res.fileNames, cameras: res.cameras, tags: res.tags })
      setShowSuggestions(hasAny)
      // 有建议时隐藏历史
      if (hasAny) setShowHistory(false)
    }).catch(() => { /* 建议失败静默 */ })
    return () => { cancelled = true }
  }, [debouncedSuggQuery])

  // ── Ctrl+F 全局聚焦 ──────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'f') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // ── 点击外部收起下拉 ─────────────────────────────────
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowHistory(false)
        setShowSuggestions(false)
        if (!query.trim()) setOpen(false)
      }
    }
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [query, setOpen])

  // ── 聚焦：展开 + 加载历史（若无输入内容）──────────────
  const handleFocus = useCallback(() => {
    setOpen(true)
    if (!query.trim()) {
      setHistory(loadHistory())
      setShowHistory(true)
      setShowSuggestions(false)
    }
  }, [setOpen, query])

  // ── 输入变化 ─────────────────────────────────────────
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    setQuery(v)
    if (v.trim().length === 0) {
      setShowSuggestions(false)
      setHistory(loadHistory())
      setShowHistory(true)
    } else {
      setShowHistory(false)
      // 建议由 debouncedSuggQuery effect 异步加载
    }
  }, [setQuery])

  // ── 键盘处理 ─────────────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      handleClear()
      inputRef.current?.blur()
    }
    if (e.key === 'Enter' && query.trim()) {
      saveHistory(query.trim())
      setHistory(loadHistory())
      setShowHistory(false)
      setShowSuggestions(false)
    }
  }, [query])

  // ── 清除 ─────────────────────────────────────────────
  const handleClear = useCallback(() => {
    setQuery('')
    setOpen(false)
    setShowHistory(false)
    setShowSuggestions(false)
    setSuggestions({ fileNames: [], cameras: [], tags: [] })
    setView({ type: 'all_photos' })
  }, [setQuery, setOpen, setView])

  // ── 选择历史条目 ─────────────────────────────────────
  const handleHistorySelect = useCallback((item: string) => {
    setQuery(item)
    setShowHistory(false)
    setView({ type: 'search', query: item })
    saveHistory(item)
  }, [setQuery, setView])

  // ── 清除全部历史 ─────────────────────────────────────
  const handleClearHistory = useCallback(() => {
    clearHistory()
    setHistory([])
    setShowHistory(false)
  }, [])

  // ── Phase-C：选择建议条目 ────────────────────────────
  const handleSuggestionSelect = useCallback((q: string) => {
    setQuery(q)
    setShowSuggestions(false)
    setShowHistory(false)
    setView({ type: 'search', query: q })
    saveHistory(q)
  }, [setQuery, setView])

  const hasContent = query.length > 0

  return (
    <div
      ref={wrapperRef}
      style={{ position: 'relative', flexShrink: 0 }}
    >
      {/* 搜索框主体 */}
      <motion.div
        animate={{ width: isOpen ? 320 : 200 }}
        transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
        style={{
          display:         'flex',
          alignItems:      'center',
          gap:             '7px',
          height:          '32px',
          padding:         '0 10px 0 12px',
          borderRadius:    'var(--la-radius-full)',
          backgroundColor: isOpen
            ? 'var(--la-bg-overlay)'
            : 'var(--la-bg-hover)',
          border:          `1px solid ${isOpen ? 'var(--la-border-strong)' : 'transparent'}`,
          transition:      'background-color 150ms ease, border-color 150ms ease',
        }}
      >
        {/* 搜索图标 */}
        <Icon
          name="search"
          size={14}
          color={isOpen ? 'var(--la-text-secondary)' : 'var(--la-text-tertiary)'}
        />

        {/* 输入框 */}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleChange}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          placeholder="搜索照片…"
          aria-label="搜索照片"
          style={{
            flex:            1,
            backgroundColor: 'transparent',
            border:          'none',
            outline:         'none',
            fontSize:        'var(--la-text-sm)',
            color:           'var(--la-text-primary)',
            caretColor:      'var(--la-accent)',
            userSelect:      'text',
            minWidth:        0,
          }}
        />

        {/* 右侧：清除按钮 或 Ctrl+F 提示 */}
        <AnimatePresence mode="wait">
          {hasContent ? (
            <motion.button
              key="clear"
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1   }}
              exit={{    opacity: 0, scale: 0.7 }}
              transition={{ duration: 0.1 }}
              onClick={handleClear}
              aria-label="清除搜索"
              style={{
                display:         'flex',
                alignItems:      'center',
                justifyContent:  'center',
                width:           '18px',
                height:          '18px',
                borderRadius:    '50%',
                backgroundColor: 'var(--la-text-tertiary)',
                border:          'none',
                cursor:          'default',
                flexShrink:      0,
                transition:      'background-color 100ms ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--la-text-secondary)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--la-text-tertiary)'
              }}
            >
              <Icon name="x" size={10} color="#fff" strokeWidth={2.5} />
            </motion.button>
          ) : !isOpen ? (
            <motion.span
              key="hint"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{    opacity: 0 }}
              transition={{ duration: 0.1 }}
              style={{
                fontSize:        '11px',
                color:           'var(--la-text-tertiary)',
                backgroundColor: 'var(--la-bg-overlay)',
                borderRadius:    'var(--la-radius-sm)',
                padding:         '1px 5px',
                flexShrink:      0,
                letterSpacing:   '0.01em',
                fontFamily:      'var(--la-font-mono)',
              }}
            >
              ⌃F
            </motion.span>
          ) : null}
        </AnimatePresence>
      </motion.div>

      {/* Phase-C：建议下拉（优先于历史下拉显示）*/}
      <AnimatePresence>
        {showSuggestions && (
          <SuggestionsDropdown
            key="suggestions"
            fileNames={suggestions.fileNames}
            cameras={suggestions.cameras}
            tags={suggestions.tags}
            onSelect={handleSuggestionSelect}
            visible={showSuggestions}
          />
        )}
      </AnimatePresence>

      {/* 历史下拉（无建议时显示）*/}
      <AnimatePresence>
        {!showSuggestions && showHistory && history.length > 0 && (
          <HistoryDropdown
            key="history"
            history={history}
            onSelect={handleHistorySelect}
            onClearAll={handleClearHistory}
            visible={showHistory}
          />
        )}
      </AnimatePresence>
    </div>
  )
})
