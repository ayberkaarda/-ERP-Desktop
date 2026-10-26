/** Receding arcade drawn in hairlines; each crown carries a small accent keystone. Static by design. */
export function ArchBackdrop() {
  const arches = [0, 1, 2, 3, 4]
  return (
    <svg
      viewBox="0 0 640 520"
      preserveAspectRatio="xMidYMax slice"
      className="absolute inset-0 size-full"
      aria-hidden="true"
    >
      <g fill="none" stroke="currentColor" strokeWidth="1" className="text-white/12">
        {arches.map((i) => {
          const s = 1 - i * 0.16
          const r = 150 * s
          const band = 26 * s
          const cx = 380 + i * 34
          const base = 520
          const spring = base - 260 * s
          const crown = spring - r
          const inner = r - band
          return (
            <g key={i} opacity={1 - i * 0.15}>
              <path
                d={`M${cx - r} ${base}V${spring}A${r} ${r} 0 0 1 ${cx + r} ${spring}V${base}`}
              />
              <path
                d={`M${cx - inner} ${base}V${spring}A${inner} ${inner} 0 0 1 ${cx + inner} ${spring}V${base}`}
              />
              <path
                className="fill-brand-accent/60 stroke-none"
                d={`M${cx - 7 * s} ${crown + band}L${cx - 11 * s} ${crown - 4 * s}H${cx + 11 * s}L${cx + 7 * s} ${crown + band}Z`}
              />
            </g>
          )
        })}
      </g>
    </svg>
  )
}
