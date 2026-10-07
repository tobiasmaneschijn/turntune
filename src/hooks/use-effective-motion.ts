import { useEffect, useState } from 'react'

export function readEffectiveReducedMotion() {
  return typeof window !== 'undefined' && (
    document.documentElement.classList.contains('reduced-motion') ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

export function effectiveScrollBehavior(behavior: ScrollBehavior, reducedMotion: boolean): ScrollBehavior {
  return reducedMotion ? 'auto' : behavior
}

/** OS and the saved app preference apply equally to CSS and imperative scrolling. */
export function useEffectiveMotion() {
  const [reducedMotion, setReducedMotion] = useState(readEffectiveReducedMotion)
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(readEffectiveReducedMotion())
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    preference.addEventListener('change', update)
    update()
    return () => { preference.removeEventListener('change', update); observer.disconnect() }
  }, [])
  return reducedMotion
}
