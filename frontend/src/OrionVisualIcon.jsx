/** Ícones SVG somente para navegação funcional do DPP. */
export default function OrionVisualIcon({ name, size = 16 }) {
  const paths = {
    stock: (
      <>
        <path d="m3 9 9-5 9 5v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9Z" />
        <path d="M3 9h18M9 21v-8h6v8" />
      </>
    ),
    quality: (
      <>
        <rect x="5" y="4" width="14" height="17" rx="2" />
        <path d="M9 4.5V3h6v1.5M9 12l2 2 4-4M9 18h6" />
      </>
    ),
    up: <path d="m6 14 6-6 6 6M12 8v12" />,
  }

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false">
      {paths[name] || null}
    </svg>
  )
}
