import type { Page } from '@playwright/test'

export interface NonTextFailure {
  selector: string
  ratio: number
  required: number
}

export async function auditNonText(page: Page): Promise<NonTextFailure[]> {
  return page.evaluate(() => {
    type RGB = { red: number; green: number; blue: number; alpha: number }
    const parse = (value: string): RGB | null => {
      const match = value.match(/rgba?\((\d+),?\s+(\d+),?\s+(\d+)(?:\s*\/\s*([\d.]+)|,?\s+([\d.]+))?\)/)
      if (!match) return null
      return { red: Number(match[1]), green: Number(match[2]), blue: Number(match[3]), alpha: Number(match[4] ?? match[5] ?? 1) }
    }
    const luminance = (color: RGB): number => {
      const channel = (value: number): number => {
        const normalized = value / 255
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * channel(color.red) + 0.7152 * channel(color.green) + 0.0722 * channel(color.blue)
    }
    const ratio = (first: RGB, second: RGB): number => {
      const values = [luminance(first), luminance(second)].sort((left, right) => right - left)
      return (values[0] + 0.05) / (values[1] + 0.05)
    }
    const backdrop = (element: Element): RGB => {
      for (let current = element.parentElement; current; current = current.parentElement) {
        const color = parse(getComputedStyle(current).backgroundColor)
        if (color && color.alpha === 1) return color
      }
      return parse(getComputedStyle(document.documentElement).backgroundColor) ?? { red: 255, green: 255, blue: 255, alpha: 1 }
    }
    const selector = (element: Element): string => {
      if (element.id) return `#${element.id}`
      const classes = [...element.classList].join('.')
      return `${element.tagName.toLowerCase()}${classes ? `.${classes}` : ''}`
    }
    const failures: NonTextFailure[] = []
    const controls = document.querySelectorAll('button:not(:disabled), [tabindex="0"]')
    for (const element of controls) {
      if (!(element as HTMLElement).checkVisibility({ checkVisibilityCSS: true })) continue
      const style = getComputedStyle(element)
      const outside = backdrop(element)
      const fill = parse(style.backgroundColor)
      const fillRatio = fill && fill.alpha === 1 ? ratio(fill, outside) : 1
      const sides = ['Top', 'Right', 'Bottom', 'Left'] as const
      const paintedSides = sides.flatMap((side) => {
        const width = Number.parseFloat(style[`border${side}Width`])
        const borderStyle = style[`border${side}Style`]
        const color = parse(style[`border${side}Color`])
        return width > 0 && borderStyle !== 'none' && borderStyle !== 'hidden' && color && color.alpha > 0 ? [ratio(color, outside)] : []
      })
      const outlinePainted = Number.parseFloat(style.outlineWidth) > 0 && style.outlineStyle !== 'none'
      if ((!fill || fill.alpha === 0) && paintedSides.length === 0 && !outlinePainted) continue
      const measured = Math.max(fillRatio, ...paintedSides, 0)
      if (measured < 3) failures.push({ selector: selector(element), ratio: measured, required: 3 })
    }
    return failures
  })
}