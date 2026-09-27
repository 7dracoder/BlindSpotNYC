import type { ButtonHTMLAttributes, ReactNode } from 'react'

// Adapted from Watermelon UI's Shimmer Button.
// https://registry.watermelon.sh/r/shimmer-button.json
// MIT license: see frontend/THIRD_PARTY_NOTICES.md.
type ShimmerButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }

export function ShimmerButton({ children, className = '', ...props }: ShimmerButtonProps) {
  return (
    <button
      type="button"
      className={[
        'group relative overflow-hidden rounded-full bg-[#f59e0b] px-4 py-2.5 font-semibold text-[#1a1408]',
        'transition duration-300 hover:bg-[#fbbf24] hover:shadow-[0_4px_24px_#f59e0b30] active:scale-[0.98]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#fbbf24] focus-visible:ring-offset-2 focus-visible:ring-offset-[#141210]',
        'disabled:pointer-events-none disabled:opacity-60 motion-reduce:transition-none motion-reduce:active:scale-100',
        className,
      ].join(' ')}
      {...props}
    >
      <span className="relative z-10 flex items-center justify-center gap-2.5">{children}</span>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -translate-x-full bg-linear-to-r from-transparent via-white/35 to-transparent transition-transform duration-700 group-hover:translate-x-full group-focus-visible:translate-x-full motion-reduce:hidden"
      />
    </button>
  )
}
