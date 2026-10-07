import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import '@fontsource-variable/geist'
import '../../src/shadcn.css'
import '../../src/styles.css'
import { TrackArtwork } from '../../src/components/TrackArtwork'

document.documentElement.classList.add('dark')

const images = {
  A: '/tests/artwork-qol-harness/art/a.svg',
  B: '/tests/artwork-qol-harness/art/b.svg',
  C: '/tests/artwork-qol-harness/art/c.svg',
  Slow: '/tests/artwork-qol-harness/art/slow.svg',
  Broken: '/tests/artwork-qol-harness/art/broken.svg',
  Missing: '',
}
const lifetime = { mounts: 0, unmounts: 0 }
Object.assign(window, { artworkQolTest: lifetime })

// A neighboring lifetime sentinel confirms decorative replacement does not remount its sibling.
// Actual provider behavior is exercised independently by the playback component harness.
function ProviderLifetimeSentinel() {
  useEffect(() => { lifetime.mounts++; return () => { lifetime.unmounts++ } }, [])
  return <div data-testid="provider-lifetime" />
}

function Harness() {
  const [source, setSource] = useState(images.A)
  const [compact, setCompact] = useState(false)
  const track = { provider: 'spotify' as const, providerId: 'decorative-artwork', artworkUrl: source }
  return <main style={{ padding: 16, color: 'var(--foreground)', background: 'var(--background)', minHeight: '100dvh' }}>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
      {Object.entries(images).map(([label, image]) => <button key={label} onClick={() => setSource(image)}>Set {label}</button>)}
      <button onClick={() => setCompact((value) => !value)}>Toggle compact</button>
      <button onClick={() => document.documentElement.classList.toggle('reduced-motion')}>Toggle motion</button>
    </div>
    <section className={`now-playing${compact ? ' compact' : ''}`} style={{ maxWidth: 640, marginInline: 'auto' }}>
      <div className="track-stage" data-testid="artwork-stage">
        <TrackArtwork track={track} compact={compact} className="ambient-artwork" />
        <TrackArtwork track={track} src={source} className="album-art-preview" alt="Current track artwork" />
        <ProviderLifetimeSentinel />
      </div>
    </section>
  </main>
}
createRoot(document.getElementById('root')!).render(<Harness />)
