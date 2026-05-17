/**
 * @file src/types/photo.ts
 * @description 照片相关核心类型定义
 *
 * 覆盖范围：
 *  - Photo          完整照片实体（对应 DB photos 表）
 *  - PhotoThumb     网格视图精简版（仅加载必要字段，节省内存）
 *  - PhotoDetail    大图预览扩展版（含全部 EXIF）
 *  - PhotoPage      分页响应信封
 *  - PhotoGroup     按日期分组后的数据结构（网格视图用）
 *  - ScanProgress   扫描进度
 */

// ─────────────────────────────────────────────────────────
//  基础枚举
// ─────────────────────────────────────────────────────────

/** 支持的图片格式（来自 DB format 字段） */
export type PhotoFormat =
  | 'jpeg'
  | 'png'
  | 'webp'
  | 'heic'
  | 'bmp'
  | 'tiff'
  | 'cr2'
  | 'nef'
  | 'arw'
  | 'dng'
  | string  // 允许未来扩展，不做 exhaustive check

/** 缩略图尺寸等级 */
export type ThumbSize = 's' | 'm' | 'l'

/** 照片排序字段 */
export type PhotoSortField = 'created_at' | 'imported_at' | 'file_name' | 'file_size'

// ─────────────────────────────────────────────────────────
//  核心实体
// ─────────────────────────────────────────────────────────

/**
 * 完整照片实体
 * 对应 SQLite photos 表的完整行，所有字段均从 Rust 后端反序列化
 */
export interface Photo {
  /** UUID v4，主键 */
  id: string

  // ── 文件信息 ──
  filePath: string          // 绝对路径
  fileName: string          // 含扩展名
  fileSize: number          // bytes
  fileHash: string          // xxHash64 hex

  // ── 图片尺寸 ──
  width: number             // 像素宽（EXIF 校正后）
  height: number            // 像素高（EXIF 校正后）
  /** EXIF Orientation 1-8，1=正常，6=顺时针90°，3=180°，8=逆时针90° */
  orientation: number

  // ── 格式 ──
  format: PhotoFormat

  // ── 时间 ──
  createdAt: string         // ISO 8601，EXIF DateTimeOriginal 优先
  modifiedAt: string        // 文件 mtime
  importedAt: string        // 导入到 LightAlbum 的时间

  // ── 归属 ──
  folderPath: string        // 所属 watched_folder 路径

  // ── EXIF 拍摄参数（均 nullable）──
  gpsLat: number | null
  gpsLng: number | null
  cameraMake: string | null
  cameraModel: string | null
  lensModel: string | null
  focalLength: number | null     // mm
  aperture: number | null        // f 值，如 2.8
  shutterSpeed: string | null    // 原始字符串，如 '1/250'、'30"'
  iso: number | null
  exposureComp: number | null    // 曝光补偿 EV

  // ── 状态 ──
  isFavorite: boolean
  isDeleted: boolean
  deletedAt: string | null
  rating: number                 // 0-5，0=未评分

  // ── 缩略图路径（可能尚未生成，值为 null）──
  thumbnailS: string | null      // 200×200 WEBP
  thumbnailM: string | null      // 600×600 WEBP
  thumbnailL: string | null      // 1600×1600 WEBP（按需生成）
}

/**
 * 网格视图精简型
 * 仅包含网格渲染和排版所需字段，减少 IPC 传输体积。
 * 通过 `photos_list` 命令返回，避免加载 EXIF 等大字段。
 */
export interface PhotoThumb {
  id: string
  fileName: string
  width: number
  height: number
  orientation: number
  createdAt: string
  isFavorite: boolean
  isDeleted: boolean
  thumbnailS: string | null
  thumbnailM: string | null
  format: PhotoFormat
  folderPath: string
}

/**
 * 大图预览扩展型
 * 在 PhotoThumb 基础上附加完整 EXIF，按需通过 `photos_get` 加载
 */
export interface PhotoDetail extends Photo {
  /** 所属相册 ID 列表（按需加载时附加） */
  albumIds?: string[]
}

// ─────────────────────────────────────────────────────────
//  分页与分组
// ─────────────────────────────────────────────────────────

/**
 * 分页响应信封
 * `nextCursor` 为 null 表示已到最后一页
 */
export interface PhotoPage {
  items: PhotoThumb[]
  nextCursor: string | null
  total: number               // 当前筛选条件下的总数
}

/**
 * 按日期分组的照片组
 * 网格视图按"年-月"或"年-月-日"归组后的数据结构
 */
export interface PhotoGroup {
  /** 分组键，格式 'YYYY-MM' 或 'YYYY-MM-DD' */
  key: string
  /** 展示用标题，如 '2025年3月' */
  label: string
  photos: PhotoThumb[]
}

// ─────────────────────────────────────────────────────────
//  扫描相关
// ─────────────────────────────────────────────────────────

export type ScanPhase =
  | 'discovering'
  | 'indexing'
  | 'generating_thumbnails'
  | 'completed'
  | 'error'

export interface ScanProgress {
  taskId: string
  folder: string
  phase: ScanPhase
  discovered: number
  indexed: number
  thumbnailsDone: number
  errors: number
  currentFile?: string
  speedPerSec: number
  etaSeconds: number | null
  percent: number   // 0-100
}

export interface ScanStatus {
  isScanning: boolean
  total: number
  done: number
  newPhotos: number
  progress?: ScanProgress
}

// ─────────────────────────────────────────────────────────
//  帮助函数类型
// ─────────────────────────────────────────────────────────

/** 判断格式是否为 RAW 格式 */
export const RAW_FORMATS: ReadonlySet<PhotoFormat> = new Set([
  'cr2', 'nef', 'arw', 'dng',
])

/** 判断格式是否需要 Sharp sidecar 处理 */
export const SIDECAR_FORMATS: ReadonlySet<PhotoFormat> = new Set([
  'heic', 'cr2', 'nef', 'arw', 'dng', 'tiff',
])

/** 格式显示名称映射 */
export const FORMAT_LABELS: Record<string, string> = {
  jpeg: 'JPEG',
  png:  'PNG',
  webp: 'WEBP',
  heic: 'HEIC',
  bmp:  'BMP',
  tiff: 'TIFF',
  cr2:  'CR2 (RAW)',
  nef:  'NEF (RAW)',
  arw:  'ARW (RAW)',
  dng:  'DNG (RAW)',
}

/**
 * 将 Photo 转换为 PhotoThumb（前端内存精简）
 * 当 IPC 返回完整 Photo 但只需要 Thumb 字段时使用
 */
export function toPhotoThumb(photo: Photo): PhotoThumb {
  return {
    id:          photo.id,
    fileName:    photo.fileName,
    width:       photo.width,
    height:      photo.height,
    orientation: photo.orientation,
    createdAt:   photo.createdAt,
    isFavorite:  photo.isFavorite,
    isDeleted:   photo.isDeleted,
    thumbnailS:  photo.thumbnailS,
    thumbnailM:  photo.thumbnailM,
    format:      photo.format as PhotoFormat,
    folderPath:  photo.folderPath,
  }
}

/**
 * 计算照片的显示宽高比（考虑 EXIF Orientation）
 * orientation 5/6/7/8 表示旋转了 90° 或 270°，需交换宽高
 */
export function getDisplayAspectRatio(photo: PhotoThumb | Photo): number {
  const { width, height, orientation } = photo
  if (orientation >= 5 && orientation <= 8) {
    return height / width   // 旋转后宽高互换
  }
  return width / height
}

/**
 * 按月分组照片列表
 */
export function groupPhotosByMonth(photos: PhotoThumb[]): PhotoGroup[] {
  const map = new Map<string, PhotoThumb[]>()

  for (const photo of photos) {
    const date = new Date(photo.createdAt)
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(photo)
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => b.localeCompare(a))   // 倒序：最新在前
    .map(([key, items]) => {
      const [year, month] = key.split('-')
      const d = new Date(Number(year), Number(month) - 1)
      const label = d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' })
      return { key, label, photos: items }
    })
}
