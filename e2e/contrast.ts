export const contrastRatio = (foreground: string, background: string): number => {
  const luminance = (hex: string): number => {
    const channels = hex.match(/[a-f\d]{2}/gi)
    if (!channels || channels.length !== 3) throw new Error(`Expected six-digit hex color, received ${hex}`)
    const [red, green, blue] = channels.map((channel) => {
      const value = Number.parseInt(channel, 16) / 255
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue
  }
  const first = luminance(foreground)
  const second = luminance(background)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}