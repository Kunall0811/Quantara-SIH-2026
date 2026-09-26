import React from 'react'

/**
 * Hand-built SVG hero graphic (no external image dependency, no copyright
 * risk, always renders instantly offline): a stylised India silhouette
 * with glowing city nodes and an animated route line threading through
 * them, plus a quantum-particle orbit motif to visually anchor
 * "quantum-inspired optimization" for first-time viewers.
 */
export default function IndiaRouteHero({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 520 560" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="indiaFill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#131c30" />
          <stop offset="100%" stopColor="#0a0f1a" />
        </linearGradient>
        <linearGradient id="routeGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#FF9933" />
          <stop offset="50%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#138808" />
        </linearGradient>
        <radialGradient id="nodeGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Simplified India-esque landmass silhouette */}
      <path
        d="M210 40 C260 35 300 55 320 90 C345 95 365 120 360 150
           C395 165 410 200 400 230 C420 260 415 300 390 320
           C400 350 390 385 360 400 C365 430 345 460 310 465
           C300 495 270 515 240 505 C210 525 175 515 165 485
           C130 480 110 450 120 420 C90 405 80 370 100 345
           C80 320 85 285 110 265 C100 235 115 200 145 190
           C140 155 165 120 200 115 C195 85 195 55 210 40 Z"
        fill="url(#indiaFill)" stroke="rgba(148,163,184,0.25)" strokeWidth="1.5"
      />

      {/* Quantum orbit motif, top-right */}
      <g transform="translate(390,90)" opacity="0.8">
        <ellipse cx="0" cy="0" rx="46" ry="18" stroke="#a78bfa" strokeWidth="1.2" className="orbit-spin" />
        <ellipse cx="0" cy="0" rx="46" ry="18" stroke="#22d3ee" strokeWidth="1" transform="rotate(60)" className="orbit-spin-rev" />
        <ellipse cx="0" cy="0" rx="46" ry="18" stroke="#FF9933" strokeWidth="1" transform="rotate(120)" className="orbit-spin" />
        <circle cx="0" cy="0" r="5" fill="#22d3ee" />
      </g>

      {/* City nodes (roughly Delhi, Mumbai, Bengaluru, Kolkata, Chennai, Pune) */}
      {[
        [230, 150, 'Delhi'], [175, 300, 'Mumbai'], [230, 420, 'Bengaluru'],
        [330, 230, 'Kolkata'], [255, 450, 'Chennai'], [195, 330, 'Pune'],
      ].map(([x, y, label], i) => (
        <g key={i}>
          <circle cx={x as number} cy={y as number} r="16" fill="url(#nodeGlow)" />
          <circle cx={x as number} cy={y as number} r="4" fill="#e2e8f0" />
        </g>
      ))}

      {/* Animated route line connecting the nodes */}
      <path
        d="M230 150 C 210 220, 190 260, 175 300 S 185 320, 195 330 S 260 380, 230 420 S 250 440, 255 450"
        stroke="url(#routeGrad)" strokeWidth="2.5" strokeLinecap="round" fill="none" className="route-flow"
      />
      <path
        d="M230 150 L 330 230"
        stroke="url(#routeGrad)" strokeWidth="2" strokeLinecap="round" fill="none" strokeDasharray="4 6" opacity="0.6"
      />
    </svg>
  )
}
