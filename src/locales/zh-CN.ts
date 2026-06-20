// src/locales/zh-CN.ts
// 所有中文字符串的单一来源（按模块分组）
// 修改字符串时只改此文件，调用方通过 t() 或 locale.* 引用，不受影响

export const zhCN = {
  nav: {
    allPhotos:      '所有照片',
    favorites:      '收藏',
    recentImports:  '最近导入',
    trash:          '回收站',
    settings:       '设置',
  },

  errors: {
    SCAN_IN_PROGRESS:       '正在扫描中，请稍候',
    UNDO_EMPTY:             '没有可撤销的操作',
    PHOTO_NOT_FOUND:        '找不到该照片，可能已被移动或删除',
    ALBUM_NOT_FOUND:        '找不到该相册',
    FOLDER_NOT_FOUND:       '文件夹不存在',
    NOT_FOUND:              '找不到该资源',
    INVALID_PARAMS:         '参数无效',
    LIMIT_EXCEEDED:         '操作数量超出限制（最多 1000 项）',
    FOLDER_ALREADY_WATCHED: '该文件夹已在监听列表中',
    FOLDER_NESTED:          '文件夹不能包含已有监听文件夹',
    DB_ERROR:               '数据库操作失败',
    IO_ERROR:               '文件读写失败',
    THUMBNAIL_ERROR:        '缩略图生成失败',
    SIDECAR_ERROR:          '图片处理服务异常，请重试',
    EXIF_ERROR:             'EXIF 元数据解析失败',
    SERDE_ERROR:            '数据序列化失败',
    TOKEN_REQUIRED:         '请先验证私密相册密码',
    UNKNOWN:                '操作失败，请重试',
  },

  toast: {
    scanComplete: (newCount: number, updatedCount: number, sec: string) =>
      `扫描完成：新增 ${newCount} 张，更新 ${updatedCount} 张（用时 ${sec}s）`,
    deleteSuccess:  (count: number) => `已删除 ${count} 张照片`,
    restoreSuccess: (count: number) => `已恢复 ${count} 张照片`,
  },

  album: {
    create:          '新建相册',
    delete:          '删除相册',
    private:         '私密相册',
    enterPassword:   '请输入密码',
    wrongPassword:   '密码错误',
    noPhotos:        '相册为空',
  },

  preview: {
    exifInfo:   'EXIF 信息',
    close:      '关闭',
    noExif:     '暂无 EXIF 信息',
  },

  settings: {
    title:       '设置',
    theme:       '主题',
    gridDensity: '网格密度',
    appearance:  '外观',
    general:     '通用',
    storage:     '存储',
    performance: '性能',
    about:       '关于',
    import:      '导入',
  },

  grid: {
    empty:       '没有找到照片',
    loadMore:    '加载更多',
    selectAll:   '全选',
    deselectAll: '取消全选',
  },

  common: {
    confirm:  '确定',
    cancel:   '取消',
    delete:   '删除',
    restore:  '恢复',
    close:    '关闭',
    save:     '保存',
  },
} as const
