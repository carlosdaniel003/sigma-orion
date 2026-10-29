import './dashboard-module-icons.css'

const shapes = {
  files: <path d="M7 4.5h8l4 4V20H7Z M15 4.5v4h4 M4 16.5V3h11" />,
  stock: <path d="m12 3.5 8 4.2v8.6l-8 4.2-8-4.2V7.7Z M4 7.7 12 12l8-4.3 M12 12v8.5 M8.5 5.4l8 4.4" />,
  quality: <path d="M9 4H5a1 1 0 0 0-1 1v4 M15 4h4a1 1 0 0 1 1 1v4 M20 15v4a1 1 0 0 1-1 1h-4 M9 20H5a1 1 0 0 1-1-1v-4 M14.5 11a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0 M13.5 13.5l3.2 3.2" />,
  pending: <path d="M20.5 12a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0 M12 7v5l3.2 2" />,
}

export default function DashboardModuleIcon({ name }) {
  const shape = shapes[name]
  if (!shape) return null
  return <svg className="orion-module-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">{shape}</svg>
}
