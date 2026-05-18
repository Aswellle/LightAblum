import { useLayoutStore } from '@/stores/layoutStore'
import type { DensityLevel } from '@/types/layout'

export function DensitySlider() {
  const { density, setDensity } = useLayoutStore()
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-[var(--color-muted)]">密度</span>
      <input
        type="range"
        min={1} max={4}
        value={density}
        onChange={(e) => setDensity(Number(e.target.value) as DensityLevel)}
        className="w-24 accent-[var(--color-accent)]"
      />
    </div>
  )
}
