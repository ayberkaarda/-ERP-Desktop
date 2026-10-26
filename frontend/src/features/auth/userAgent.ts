export interface AgentSummary {
  browser: string | null
  os: string | null
  mobile: boolean
}

// Order matters: Edge and Opera also announce Chrome, Chrome also announces Safari.
const BROWSERS: [RegExp, string][] = [
  [/Edg\//, 'Edge'],
  [/OPR\//, 'Opera'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
]

const SYSTEMS: [RegExp, string][] = [
  [/Windows/, 'Windows'],
  [/Android/, 'Android'],
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/Linux/, 'Linux'],
]

/** Coarse, display-only reading of a User-Agent string. */
export function describeAgent(ua: string | null): AgentSummary {
  if (!ua) return { browser: null, os: null, mobile: false }
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1] ?? null
  const os = SYSTEMS.find(([re]) => re.test(ua))?.[1] ?? null
  return { browser, os, mobile: /Mobi|Android|iPhone|iPad/.test(ua) }
}
