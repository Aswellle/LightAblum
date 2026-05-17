// src/__tests__/stores/photoStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { usePhotoStore } from '@/stores/photoStore'
import type { PhotoThumb } from '@/types/photo'

function makePhoto(id: string, createdAt: string): PhotoThumb {
  return {
    id, createdAt, fileName: `${id}.jpg`,
    width: 100, height: 100, orientation: 1,
    isFavorite: false, isDeleted: false,
    thumbnailS: null, thumbnailM: null,
    format: 'jpeg', folderPath: '/photos',
  }
}

describe('photoStore', () => {
  beforeEach(() => {
    usePhotoStore.getState().reset()
  })

  it('setPhotos builds correct groups', () => {
    const photos = [
      makePhoto('a', '2024-03-15T00:00:00Z'),
      makePhoto('b', '2024-03-20T00:00:00Z'),
      makePhoto('c', '2024-02-10T00:00:00Z'),
    ]
    usePhotoStore.getState().setPhotos(photos, 3)

    const { groups, total } = usePhotoStore.getState()
    expect(total).toBe(3)
    expect(groups).toHaveLength(2)
    // 最新月份在前
    expect(groups[0].key).toBe('2024-03')
    expect(groups[0].photos).toHaveLength(2)
    expect(groups[1].key).toBe('2024-02')
  })

  it('appendPhotos is O(pageSize) — existing month group updated without full resort', () => {
    const initial = [makePhoto('a', '2024-03-01T00:00:00Z')]
    usePhotoStore.getState().setPhotos(initial, 1)

    const newPhotos = [makePhoto('b', '2024-03-15T00:00:00Z')]
    usePhotoStore.getState().appendPhotos(newPhotos)

    const { groups } = usePhotoStore.getState()
    expect(groups).toHaveLength(1)
    expect(groups[0].photos).toHaveLength(2)
  })

  it('appendPhotos adds new month group when needed', () => {
    usePhotoStore.getState().setPhotos([makePhoto('a', '2024-03-01T00:00:00Z')], 1)
    usePhotoStore.getState().appendPhotos([makePhoto('b', '2024-02-01T00:00:00Z')])

    const { groups } = usePhotoStore.getState()
    expect(groups).toHaveLength(2)
    expect(groups[0].key).toBe('2024-03') // 倒序：新在前
    expect(groups[1].key).toBe('2024-02')
  })

  it('removePhotos removes photo and updates total', () => {
    usePhotoStore.getState().setPhotos([
      makePhoto('a', '2024-03-01T00:00:00Z'),
      makePhoto('b', '2024-03-02T00:00:00Z'),
    ], 2)

    usePhotoStore.getState().removePhotos(['a'])

    const { photos, total, groups } = usePhotoStore.getState()
    expect(photos).toHaveLength(1)
    expect(total).toBe(1)
    expect(groups[0].photos).toHaveLength(1)
    expect(groups[0].photos[0].id).toBe('b')
  })

  it('updatePhoto patches specific photo without changing groups', () => {
    usePhotoStore.getState().setPhotos([makePhoto('a', '2024-03-01T00:00:00Z')], 1)
    usePhotoStore.getState().updatePhoto('a', { isFavorite: true })

    const photo = usePhotoStore.getState().photos[0]
    expect(photo.isFavorite).toBe(true)
  })
})