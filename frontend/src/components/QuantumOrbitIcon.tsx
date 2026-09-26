import React from 'react'

export default function QuantumOrbitIcon({ size = 40, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} fill="none">
      <ellipse cx="50" cy="50" rx="42" ry="16" stroke="#a78bfa" strokeWidth="2" className="orbit-spin" />
      <ellipse cx="50" cy="50" rx="42" ry="16" stroke="#22d3ee" strokeWidth="1.5" transform="rotate(60 50 50)" className="orbit-spin-rev" />
      <ellipse cx="50" cy="50" rx="42" ry="16" stroke="#FF9933" strokeWidth="1.5" transform="rotate(120 50 50)" className="orbit-spin" />
      <circle cx="50" cy="50" r="7" fill="#22d3ee" />
    </svg>
  )
}
