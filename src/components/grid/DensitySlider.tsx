import { useLayoutStore } from '@/stores/layoutStore'

export function DensitySlider() {
  const { columns, setColumns } = useLayoutStore()
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-[var(--color-muted)]">密度</span>
      <input
        type="range"
        min={2} max={8}
        value={columns}
        onChange={(e) => setColumns(Number(e.target.value))}
        className="w-24 accent-[var(--color-accent)]"
      />
    </div>
  )
}
