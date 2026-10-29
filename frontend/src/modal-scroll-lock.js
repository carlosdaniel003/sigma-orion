/*
 * Isolamento da rolagem da página enquanto um dialog operacional está aberto.
 * Referência compartilhada evita desbloquear a página se dois overlays coincidirem.
 */
let activeLocks = 0
let previous = null

export function acquirePageScrollLock() {
  if (activeLocks === 0) {
    const root = document.documentElement
    const body = document.body
    const scrollX = window.scrollX
    const scrollY = window.scrollY
    const scrollbarWidth = Math.max(0, window.innerWidth - root.clientWidth)

    previous = {
      scrollX,
      scrollY,
      rootOverflow: root.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyLeft: body.style.left,
      bodyWidth: body.style.width,
    }

    // position:fixed bloqueia inclusive o movimento de fundo em Safari móvel.
    // Preservar a largura original evita o deslocamento quando a scrollbar some.
    root.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.left = `-${scrollX}px`
    body.style.width = scrollbarWidth ? `calc(100% - ${scrollbarWidth}px)` : '100%'
  }

  activeLocks += 1
  let released = false

  return () => {
    if (released) return
    released = true
    activeLocks -= 1
    if (activeLocks > 0 || !previous) return

    const { scrollX, scrollY, rootOverflow, bodyOverflow, bodyPosition,
      bodyTop, bodyLeft, bodyWidth } = previous

    document.documentElement.style.overflow = rootOverflow
    document.body.style.overflow = bodyOverflow
    document.body.style.position = bodyPosition
    document.body.style.top = bodyTop
    document.body.style.left = bodyLeft
    document.body.style.width = bodyWidth
    previous = null
    window.scrollTo(scrollX, scrollY)
  }
}
