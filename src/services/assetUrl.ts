/**
 * @file src/services/assetUrl.ts
 * @description 本地文件路径 → Tauri asset URL 转换工具
 *
 * 问题根因：
 *   DB 中存储的 thumbnail_m / thumbnail_s 等字段是原始磁盘绝对路径，
 *   如 "C:\\Users\\...\\thumbnails\\b8\\file.webp"。
 *   前端直接用作 <img src> 时，浏览器将其解析为 file:///C:/... 协议，
 *   WebView2 默认禁止加载 file:// 资源（安全策略），控制台报错：
 *   "Not allowed to load local resource: file:///..."
 *
 * 修复：
 *   使用 Tauri 官方 convertFileSrc() API 将路径转换为 asset 协议 URL：
 *   - Windows (WebView2): http://asset.localhost/C%3A%2F.../file.webp
 *   - macOS/Linux (WKWebView): asset://localhost/.../file.webp
 *   该协议由 tauri.conf.json assetProtocol.enable=true 开启，scope=["**"] 允许所有路径。
 *
 * 使用方式：
 *   import { toAssetUrl } from '@/services/assetUrl'
 *
 *   // 在组件中：
 *   <img src={toAssetUrl(album.coverThumbnail)} />
 *
 * 安全性：
 *   - null/undefined/空字符串直接返回 undefined（不产生无效 URL）
 *   - 已经是 http:// 或 asset:// 协议的 URL 直接透传（幂等）
 *   - convertFileSrc 内部处理平台差异，无需手动判断
 */

import { convertFileSrc } from '@tauri-apps/api/core'

/**
 * 将原始本地文件路径转换为 Tauri asset 协议 URL
 *
 * @param filePath  原始磁盘路径（如 "C:\\Users\\...\\file.webp"）
 *                  或 null/undefined（返回 undefined）
 * @returns         可直接用于 <img src> 的 URL，或 undefined（路径无效时）
 */
export function toAssetUrl(filePath: string | null | undefined): string | undefined {
  if (!filePath) return undefined

  // 已经是网络协议 URL（http/https/asset）→ 直接返回，避免重复转换
  if (
    filePath.startsWith('http://') ||
    filePath.startsWith('https://') ||
    filePath.startsWith('asset://')
  ) {
    return filePath
  }

  try {
    return convertFileSrc(filePath)
  } catch {
    // convertFileSrc 在极少数情况下可能抛出，降级返回 undefined（显示占位符）
    return undefined
  }
}
