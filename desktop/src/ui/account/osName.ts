const OS_NAMES: Record<string, string> = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
  ios: 'iOS',
  android: 'Android',
  freebsd: 'FreeBSD',
}

/** The Rust target OS ("windows") as its product name ("Windows"). */
export function osName(os: string): string {
  return OS_NAMES[os.toLowerCase()] ?? (os ? os.charAt(0).toUpperCase() + os.slice(1) : os)
}
