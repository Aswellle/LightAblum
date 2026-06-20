/**
 * @file src/components/album/CoverPicker.tsx
 * @description 相册封面选择器 — 从相册照片中选择一张作为封面
 */

import { useCallback, memo } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/tauriIpc'
import { toAssetUrl } from '@/services/assetUrl'
import { Icon } from '@/components/common/Icon'
import { toast } from '@/stores/uiStore'
import type { PhotoThumb } from '@/types/photo'

interface CoverPickerProps {
  albumId:        string
  currentCoverId: string | null
  onClose:        () => void
}

// ─────────────────────────────────────────────────────────
//  CoverPhotoItem — 单张照片项
// ─────────────────────────────────────────────────────────

interface CoverPhotoItemProps {
  photo:          PhotoThumb
  isSelected:     boolean
  onPhotoSelect:  (photoId: string) => void
}

const CoverPhotoItem = memo(function CoverPhotoItem({
  photo,
  isSelected,
  onPhotoSelect,
}: CoverPhotoItemProps) {
  return (
    <button
      onClick={() => onPhotoSelect(photo.id)}
      title={photo.fileName}
      style={{
        position:       'relative',
        aspectRatio:    '1',
        borderRadius:   'var(--la-radius-md)',
        overflow:       'hidden',
        backgroundColor: 'var(--la-bg-overlay)',
        border:          isSelected ? '2px solid var(--la-accent)' : '2px solid transparent',
        cursor:          'default',
        padding:         0,
        outline:         'none',
        transition:      'border-color 150ms ease',
      }}
      onMouseEnter={(e) => {
        if (!isSelected) e.currentTarget.style.borderColor = 'var(--la-border-strong)'
      }}
      onMouseLeave={(e) => {
        if (!isSelected) e.currentTarget.style.borderColor = '2px solid transparent'
      }}
    >
      {/* 缩略图 */}
      {photo.thumbnailM ? (
        <img
          src={toAssetUrl(photo.thumbnailM)}
          alt={photo.fileName}
          draggable={false}
          style={{
            width:           '100%',
            height:          '100%',
            objectFit:       'cover',
            display:         'block',
            pointerEvents:    'none',
          }}
        />
      ) : (
        <div style={{
          width:      '100%',
          height:     '100%',
          display:    'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <Icon name="images" size={24} color="var(--la-text-tertiary)" />
        </div>
      )}

      {/* 当前封面标记 */}
      {isSelected && (
        <div style={{
          position:      'absolute',
          bottom:        '4px',
          right:         '4px',
          width:         '20px',
          height:        '20px',
          borderRadius:  '50%',
          backgroundColor: 'var(--la-accent)',
          display:       'flex',
          alignItems:    'center',
          justifyContent: 'center',
        }}>
          <Icon name="check" size={12} color="#fff" strokeWidth={3} />
        </div>
      )}
    </button>
  )
})

// ─────────────────────────────────────────────────────────
//  CoverPicker — 封面选择器弹窗
// ─────────────────────────────────────────────────────────

export const CoverPicker = memo(function CoverPicker({
  albumId,
  currentCoverId,
  onClose,
}: CoverPickerProps) {
  const queryClient = useQueryClient()

  // 获取相册内所有照片（上限 200 张，足够选封面）
  const { data, isLoading } = useQuery({
    queryKey: ['album-cover-photos', albumId],
    queryFn:  () => api.albums.photos(albumId, undefined, 200),
    staleTime: 30_000,
  })

  const photos: PhotoThumb[] = data?.items ?? []

  // 选中后写入 cover_photo_id
  const { mutate: selectCover, isPending: isSelecting } = useMutation({
    mutationFn: (photoId: string) =>
      api.albums.update({ id: albumId, coverPhotoId: photoId }),
    onSuccess: (updatedAlbum) => {
      // 直接更新缓存，避免 staleTime:Infinity 导致封面不刷新
      queryClient.setQueryData(['album', albumId], updatedAlbum)
      queryClient.invalidateQueries({ queryKey: ['albums'] })
      toast.success('封面已更新')
      onClose()
    },
    onError: () => toast.error('设置封面失败'),
  })

  const handlePhotoSelect = useCallback((photoId: string) => {
    if (photoId === currentCoverId) { onClose(); return }
    selectCover(photoId)
  }, [currentCoverId, selectCover, onClose])

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={onClose}
        style={{
          position:          'fixed',
          inset:              0,
          zIndex:             'var(--la-z-modal)' as unknown as number,
          backgroundColor:    'rgba(0,0,0,0.65)',
          display:            'flex',
          alignItems:         'center',
          justifyContent:     'center',
          backdropFilter:     'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
        }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 8 }}
          animate={{ opacity: 1, scale: 1,    y: 0 }}
          exit={{   opacity: 0, scale: 0.95, y: 8 }}
          transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
          onClick={(e) => e.stopPropagation()}
          style={{
            width:           '520px',
            maxHeight:       '80vh',
            backgroundColor: 'var(--la-bg-raised)',
            borderRadius:    'var(--la-radius-xl)',
            border:          '1px solid var(--la-border)',
            boxShadow:       'var(--la-shadow-overlay)',
            overflow:        'hidden',
            display:         'flex',
            flexDirection:   'column',
          }}
        >
          {/* 标题栏 */}
          <div style={{
            display:         'flex',
            alignItems:      'center',
            justifyContent:  'space-between',
            padding:         '16px 20px',
            borderBottom:    '1px solid var(--la-border)',
            flexShrink:      0,
          }}>
            <h2 style={{
              fontSize:    'var(--la-text-base)',
              fontWeight: 'var(--la-weight-semibold)',
              color:      'var(--la-text-primary)',
              margin:      0,
            }}>
              选择封面照片
            </h2>
            <button
              onClick={onClose}
              aria-label="关闭"
              style={{
                display:         'flex',
                alignItems:      'center',
                justifyContent:  'center',
                width:           '28px',
                height:          '28px',
                borderRadius:    'var(--la-radius-md)',
                backgroundColor: 'transparent',
                border:          'none',
                color:           'var(--la-text-tertiary)',
                cursor:          'default',
                transition:      'all 100ms ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--la-bg-hover)'
                e.currentTarget.style.color = 'var(--la-text-primary)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent'
                e.currentTarget.style.color = 'var(--la-text-tertiary)'
              }}
            >
              <Icon name="x" size={16} strokeWidth={2} />
            </button>
          </div>

          {/* 照片网格 */}
          <div style={{
            flex:       1,
            overflowY:  'auto',
            padding:    '16px 20px',
          }}>
            {isLoading ? (
              <div style={{
                display:         'flex',
                alignItems:      'center',
                justifyContent:  'center',
                height:          '200px',
                color:           'var(--la-text-tertiary)',
                fontSize:        'var(--la-text-sm)',
              }}>
                加载中…
              </div>
            ) : photos.length === 0 ? (
              <div style={{
                display:         'flex',
                flexDirection:   'column',
                alignItems:      'center',
                justifyContent:  'center',
                height:          '200px',
                gap:             '8px',
                color:           'var(--la-text-tertiary)',
              }}>
                <Icon name="images" size={32} color="var(--la-text-tertiary)" />
                <p style={{ fontSize: 'var(--la-text-sm)', margin: 0 }}>
                  相册中没有照片
                </p>
              </div>
            ) : (
              <div style={{
                display:              'grid',
                gridTemplateColumns:  'repeat(4, 1fr)',
                gap:                  '8px',
              }}>
                {photos.map((photo) => (
                  <CoverPhotoItem
                    key={photo.id}
                    photo={photo}
                    isSelected={photo.id === currentCoverId}
                    onPhotoSelect={handlePhotoSelect}
                  />
                ))}
              </div>
            )}
          </div>

          {/* 底部提示 */}
          <div style={{
            padding:     '12px 20px',
            borderTop:    '1px solid var(--la-border)',
            flexShrink:   0,
            display:      'flex',
            alignItems:   'center',
            justifyContent: 'space-between',
          }}>
            <p style={{
              fontSize: 'var(--la-text-xs)',
              color:   'var(--la-text-tertiary)',
              margin:  0,
            }}>
              {isSelecting ? '设置中…' : '点击照片即可设为封面'}
            </p>
            {isSelecting && (
              <div style={{
                width:        12,
                height:       12,
                border:       '2px solid var(--la-text-tertiary)',
                borderTopColor: 'var(--la-accent)',
                borderRadius: '50%',
                animation:    'la-spin 0.7s linear infinite',
              }} />
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  )
})
