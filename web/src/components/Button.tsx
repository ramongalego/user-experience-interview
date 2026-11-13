import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary'

const VARIANT: Record<Variant, string> = {
  primary: 'bg-ink text-white hover:bg-ink/85 disabled:bg-ink/50',
  secondary:
    'border border-line bg-surface text-ink hover:bg-ground disabled:text-ink-soft',
}

/** Shared button. Use `primary` for the main action of a screen or card and
 *  `secondary` for everything else. */
export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...props}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150 disabled:cursor-not-allowed ${VARIANT[variant]} ${className}`}
    />
  )
}
