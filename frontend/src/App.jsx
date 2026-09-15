import React from 'react'
import './App.css'
import GradientBackground from './components/GradientBackground'
import CinematicPosterWall from './components/CinematicPosterWall'
import SubtitleGenerator from './components/SubtitleGenerator'

function App() {
  return (
    <div className="app-container">
      {/* Particle canvas — sits behind everything */}
      <GradientBackground />

      {/* Fixed cinematic poster wall — position:fixed, z-index:0 */}
      <CinematicPosterWall />

      {/*
        Transparent spacer: gives 100vh of scroll room for the poster
        wall animation to play before the workspace enters the viewport.
        The spacer itself is invisible — the fixed wall shows through it.
      */}
      <div id="cinematic-spacer" className="cpw-spacer" aria-hidden="true" />

      {/*
        Studio workspace: position:relative, z-index:1, solid background.
        As the user scrolls, this naturally slides UP OVER the fixed poster
        wall — no special clip/mask needed, just normal document flow.
      */}
      <main id="studio-workspace" tabIndex="-1" className="studio-main">
        <SubtitleGenerator />
      </main>
    </div>
  )
}

export default App
