/**
 * @file src/main.tsx
 * @description React 应用入口
 *
 * 职责：
 *   1. 导入全局样式（顺序关键：tokens → animations → global）
 *   2. 在 #root 挂载 React 树
 *   3. 开发模式下挂载 TanStack Query DevTools（可选）
 *
 * StrictMode 说明：
 *   保留 React.StrictMode，它在开发模式下会：
 *   - 双调用 effects（帮助发现副作用问题）
 *   - 检测废弃 API 使用
 *   生产构建中 StrictMode 无性能损耗。
 *
 * 样式导入顺序（不可颠倒）：
 *   1. global.css  → @import tailwindcss + tokens.css + animations.css
 *      （global.css 内部通过 @import 引入其他两个，这里只需一个入口）
 */

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './app/App'

// 全局样式（一个入口 import，内部已按正确顺序 @import 其他文件）
import './styles/global.css'

// ── 挂载 React 树 ──────────────────────────────────────────

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error(
    '[LightAlbum] 未找到 #root 挂载点。请检查 index.html 中是否存在 <div id="root">。',
  )
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
