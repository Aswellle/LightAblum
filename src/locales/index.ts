// src/locales/index.ts
// 预留 i18n 扩展接口：当前直接返回中文字符串。
// 未来接入 react-i18next 时，只改此文件，调用方签名不变。

import { zhCN } from './zh-CN'

function getNestedValue(obj: Record<string, unknown>, key: string): string {
  const parts = key.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return key
    current = (current as Record<string, unknown>)[part]
  }
  return typeof current === 'string' ? current : key
}

// 模式一：静态字符串 — t('nav.allPhotos') → '所有照片'
export function t(key: string): string {
  return getNestedValue(zhCN as unknown as Record<string, unknown>, key)
}

// 模式二：参数化字符串 — locale.toast.scanComplete(3, 0, '1.2')
export const locale = zhCN
