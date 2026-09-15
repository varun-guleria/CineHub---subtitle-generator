import React, { useEffect, useRef } from 'react'
import './CinematicPosterWall.css'

/**
 * CinematicPosterWall — Ultra-Smooth 120Hz Hardware-Accelerated Scroll Engine
 */
const CinematicPosterWall = () => {
  const stageRef       = useRef(null)
  const viewportRef    = useRef(null)
  const layerBaseRef   = useRef(null)
  const layerLeftRef   = useRef(null)
  const layerRightRef  = useRef(null)
  const layerTopRef    = useRef(null)
  const layerBottomRef = useRef(null)
  const layerCenterRef = useRef(null)
  const darkOverlayRef = useRef(null)
  const vignetteRef    = useRef(null)
  const heroOverlayRef = useRef(null)
  const tickerFillRef  = useRef(null)
  const tickerTextRef  = useRef(null)

  useEffect(() => {
    // Reduced motion check
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReduced) return

    let spacerH = 0
    const cacheLayout = () => {
      const el = document.getElementById('cinematic-spacer')
      spacerH = el ? el.offsetHeight : window.innerHeight
    }
    cacheLayout()

    let targetP  = 0
    let currentP = 0
    let rafId    = null
    let lastTime = performance.now()

    const PHASE_LABELS = [
      'Phase 1 · Stable Wall',
      'Phase 2 · Parallax Drift',
      'Phase 3 · Camera Push',
      'Phase 4 · Wall Opening',
      'Phase 5 · Cinematic Darkening',
      'Phase 6 · Studio Reveal',
    ]
    let lastPhaseIdx = -1

    const smoothstep = (t) => t * t * (3 - 2 * t)
    const clamp01    = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

    const applyProgress = (p) => {
      const isMobile = window.innerWidth <= 768
      const isTablet = window.innerWidth > 768 && window.innerWidth <= 1024
      const mult     = isMobile ? 0.45 : isTablet ? 0.72 : 1.0

      if (p >= 1.0) {
        if (stageRef.current) stageRef.current.style.visibility = 'hidden'
        return
      }
      if (stageRef.current && stageRef.current.style.visibility === 'hidden') {
        stageRef.current.style.visibility = 'visible'
      }

      // Camera push
      const zoomT    = clamp01((p - 0.10) / 0.62)
      const zoomE    = smoothstep(zoomT)
      const camScale = 1.0 + 0.22 * zoomE * mult

      // Parallax drift & Wall separation
      let lx = 0, rx = 0, ty = 0, by = 0, rotY = 0
      if (p > 0.10) {
        const dT = clamp01((p - 0.10) / 0.36)
        lx = -3.5 * dT * mult
        rx =  3.5 * dT * mult
        ty = -2.0 * dT * mult
        by =  2.0 * dT * mult

        if (p > 0.50) {
          const pT   = clamp01((p - 0.50) / 0.36)
          const pE   = smoothstep(pT)
          const maxX = isMobile ? 34 : 48
          const maxY = isMobile ? 18 : 28
          lx  -= maxX * pE * mult
          rx  += maxX * pE * mult
          ty  -= maxY * pE * mult
          by  += maxY * pE * mult
          rotY = (isMobile ? 3 : 8) * pE
        }
      }

      // Center core scale & fade
      const centerScale   = 1.0 + 0.18 * zoomE
      let   centerOpacity = 1.0
      if (p > 0.56) centerOpacity = clamp01(1.0 - ((p - 0.56) / 0.28) * 1.25)

      // Cinematic darkening
      let darkOverlayOpacity = 0
      let vigOpacity         = 0.55
      if (p > 0.64) {
        const dkT          = clamp01((p - 0.64) / 0.30)
        darkOverlayOpacity = 0.75 * dkT
        vigOpacity         = 0.55 + 0.40 * dkT
      }

      // Master fade
      const masterOpacity = p > 0.88 ? clamp01(1.0 - (p - 0.88) / 0.12) : 1.0

      // Hero overlay fade & drift
      let heroOpacity = 1.0, heroTY = 0
      if (p > 0.05) {
        const hT    = clamp01((p - 0.05) / 0.24)
        heroOpacity = clamp01(1.0 - hT * 1.15)
        heroTY      = -42 * hT
      }

      // DOM Mutations
      const viewport = viewportRef.current
      if (viewport) {
        viewport.style.transform = `scale3d(${camScale.toFixed(5)},${camScale.toFixed(5)},1)`
        viewport.style.opacity   = masterOpacity.toFixed(4)
      }

      const base = layerBaseRef.current
      if (base) base.style.opacity = clamp01(0.88 - p * 0.42).toFixed(4)

      const left = layerLeftRef.current
      if (left) {
        left.style.transform = `translate3d(${lx.toFixed(3)}vw,0,0) rotateY(${rotY.toFixed(3)}deg)`
      }

      const right = layerRightRef.current
      if (right) {
        right.style.transform = `translate3d(${rx.toFixed(3)}vw,0,0) rotateY(${(-rotY).toFixed(3)}deg)`
      }

      const topL = layerTopRef.current
      if (topL) {
        topL.style.transform = `translate3d(0,${ty.toFixed(3)}vh,0)`
      }

      const botL = layerBottomRef.current
      if (botL) {
        botL.style.transform = `translate3d(0,${by.toFixed(3)}vh,0)`
      }

      const center = layerCenterRef.current
      if (center) {
        center.style.transform = `scale3d(${centerScale.toFixed(5)},${centerScale.toFixed(5)},1)`
        center.style.opacity   = centerOpacity.toFixed(4)
      }

      const darkOv = darkOverlayRef.current
      if (darkOv) darkOv.style.opacity = darkOverlayOpacity.toFixed(4)

      const vig = vignetteRef.current
      if (vig) vig.style.opacity = vigOpacity.toFixed(4)

      const hero = heroOverlayRef.current
      if (hero) {
        hero.style.opacity       = heroOpacity.toFixed(4)
        hero.style.transform     = `translate3d(0,${heroTY.toFixed(2)}px,0)`
        hero.style.pointerEvents = heroOpacity < 0.04 ? 'none' : ''
      }

      const fill = tickerFillRef.current
      if (fill) fill.style.width = `${Math.round(p * 100)}%`

      const phaseIdx = p >= 0.88 ? 5 : p >= 0.72 ? 4 : p >= 0.50 ? 3 : p >= 0.28 ? 2 : p >= 0.10 ? 1 : 0
      if (phaseIdx !== lastPhaseIdx) {
        lastPhaseIdx = phaseIdx
        if (tickerTextRef.current) tickerTextRef.current.textContent = PHASE_LABELS[phaseIdx]
      }
    }

    const tick = (now) => {
      const dt = Math.min((now - lastTime) / 1000, 0.08)
      lastTime = now

      const lerpFactor = 1 - Math.exp(-15 * dt)
      const diff       = targetP - currentP

      if (Math.abs(diff) > 0.0001) {
        currentP += diff * lerpFactor
        applyProgress(currentP)
        rafId = requestAnimationFrame(tick)
      } else {
        currentP = targetP
        applyProgress(currentP)
        rafId = null
      }
    }

    const scheduleTick = () => {
      if (!rafId) {
        lastTime = performance.now()
        rafId    = requestAnimationFrame(tick)
      }
    }

    const onScroll = () => {
      targetP = clamp01(window.scrollY / spacerH)
      scheduleTick()
    }

    const onResize = () => {
      cacheLayout()
      targetP = clamp01(window.scrollY / spacerH)
      scheduleTick()
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize, { passive: true })

    onScroll()

    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [])

  const handleSkip = () => {
    const spacer = document.getElementById('cinematic-spacer')
    if (spacer) window.scrollTo({ top: spacer.offsetHeight, behavior: 'smooth' })
  }

  return (
    <div ref={stageRef} className="cpw-fixed-stage" aria-hidden="true">
      {/* 6-layer GPU poster wall */}
      <div ref={viewportRef} className="poster-wall-viewport">
        <div ref={layerBaseRef}   className="poster-layer layer-base"   />
        <div ref={layerLeftRef}   className="poster-layer layer-left"   />
        <div ref={layerRightRef}  className="poster-layer layer-right"  />
        <div ref={layerTopRef}    className="poster-layer layer-top"    />
        <div ref={layerBottomRef} className="poster-layer layer-bottom" />
        <div ref={layerCenterRef} className="poster-layer layer-center" />
      </div>

      {/* Composite-only Dark Overlay */}
      <div ref={darkOverlayRef} className="cinematic-dark-overlay" />

      {/* Atmosphere */}
      <div ref={vignetteRef} className="cinematic-vignette" />
      <div className="cinematic-letterbox-top" />
      <div className="cinematic-letterbox-bottom" />

      {/* Quick skip */}
      <div className="hero-quick-skip">
        <button type="button" className="quick-skip-btn" onClick={handleSkip}>
          Enter Studio ↓
        </button>
      </div>

      {/* Clean high-contrast Hero overlay with CineHub branding */}
      <div ref={heroOverlayRef} className="cinematic-hero-overlay">
        <div className="hero-glass-card">
          <h1 className="hero-editorial-title">
            Cine<span>Hub</span>
          </h1>
          <p className="hero-editorial-tagline">
            Real-time AI Subtitle Synthesis & Translation
          </p>
        </div>

        <button
          type="button"
          className="hero-scroll-indicator"
          onClick={handleSkip}
          aria-label="Scroll to studio"
        >
          <span className="scroll-indicator-text">Scroll to Enter Studio</span>
          <div className="scroll-indicator-mouse">
            <span className="scroll-indicator-wheel" />
          </div>
        </button>
      </div>

      {/* Phase ticker */}
      <div className="hero-phase-ticker">
        <div className="phase-ticker-bar">
          <div ref={tickerFillRef} className="phase-ticker-fill" />
        </div>
        <span ref={tickerTextRef}>Phase 1 · Stable Wall</span>
      </div>
    </div>
  )
}

export default CinematicPosterWall
