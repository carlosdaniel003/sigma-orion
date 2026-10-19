/**
 * Ícones SVG discretos de navegação e contexto para o Dashboard do DPP.
 * Não representam aprovação, divergência ou outra decisão operacional.
 */
export default function OrionVisualIcon({ name, size = 20 }) {
  const paths = {
    overview: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <path d="M14 17h7M17.5 13.5v7" />
      </>
    ),
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
    action: (
      <>
        <path d="M8 4h8M7 8h10M7 12h6" />
        <path d="M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" />
        <path d="m13 17 2 2 4-4" />
      </>
    ),
    gap: (
      <>
        <path d="M4 19V5M4 19h17" />
        <path d="m7 14 4-5 3 3 6-7" />
      </>
    ),
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    up: <path d="m6 14 6-6 6 6M12 8v12" />,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5" /></>,
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false">
      {paths[name] || paths.overview}
    </svg>
  )
}
