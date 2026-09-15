import React, { useEffect, useRef } from 'react'
import './GradientBackground.css'

const GradientBackground = () => {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    let animationId

    // Set canvas size
    const setCanvasSize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    setCanvasSize()
    window.addEventListener('resize', setCanvasSize)

    // Single-accent teal particles — taste-skill compliant
    const particles = Array.from({ length: 12 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.15,
      vy: (Math.random() - 0.5) * 0.15,
      radius: Math.random() * 1.0 + 0.3,
      color: 'rgba(0, 212, 160'
    }))

    const animate = () => {
      ctx.fillStyle = 'rgba(13, 13, 15, 0.08)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      // Update particles
      particles.forEach(p => {
        p.x += p.vx
        p.y += p.vy

        // Bounce off walls with damping
        if (p.x < 0 || p.x > canvas.width) p.vx *= -1
        if (p.y < 0 || p.y > canvas.height) p.vy *= -1

        // Keep particles in bounds
        p.x = Math.max(0, Math.min(canvas.width, p.x))
        p.y = Math.max(0, Math.min(canvas.height, p.y))

        // Draw particle with vibrant glow
        ctx.shadowBlur = 25
        ctx.shadowColor = p.color + ', 0.6)'
        ctx.fillStyle = p.color + ', 0.7)'
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2)
        ctx.fill()
      })

      ctx.strokeStyle = 'rgba(0, 212, 160, 0.05)'
      ctx.lineWidth = 1
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x
          const dy = particles[i].y - particles[j].y
          const distance = Math.sqrt(dx * dx + dy * dy)
          if (distance < 200) {
            ctx.globalAlpha = (1 - distance / 200) * 0.4
            ctx.shadowBlur = 10
            ctx.shadowColor = 'rgba(59, 130, 246, 0.5)'
            ctx.beginPath()
            ctx.moveTo(particles[i].x, particles[i].y)
            ctx.lineTo(particles[j].x, particles[j].y)
            ctx.stroke()
            ctx.globalAlpha = 1
            ctx.shadowBlur = 0
          }
        }
      }

      ctx.shadowBlur = 0
      animationId = requestAnimationFrame(animate)
    }

    animate()

    return () => {
      cancelAnimationFrame(animationId)
      window.removeEventListener('resize', setCanvasSize)
    }
  }, [])

  return (
    <div className="gradient-background">
      <canvas ref={canvasRef} className="gradient-canvas" />
      <div className="gradient-overlay"></div>
    </div>
  )
}

export default GradientBackground
