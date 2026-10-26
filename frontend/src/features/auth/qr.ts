/** Server QR is rendered as an image so any markup inside it can never run as page script. */
export function qrImageSrc(svg: string): string {
  if (svg.startsWith('data:image/svg+xml')) return svg
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
