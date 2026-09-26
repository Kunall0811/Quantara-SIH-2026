import React, { useState } from 'react'
import { Search, Loader2, MapPin } from 'lucide-react'
import api from '../api/client'

interface Props {
  onSelect: (lat: number, lon: number, label: string) => void;
  placeholder?: string;
  className?: string;
}

export default function SearchControl({ onSelect, placeholder = 'Search location...', className = '' }: Props) {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<any[]>([])
  const [open, setOpen] = useState(false)

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return
    setLoading(true)
    setOpen(true)
    try {
      const res = await api.get(`/maps/geocode?address=${encodeURIComponent(query)}`)
      if (res.data.success) {
        setResults([res.data])
      } else {
        setResults([])
      }
    } catch {
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  const handleSelect = (r: any) => {
    onSelect(r.lat, r.lon, r.displayName)
    setOpen(false)
    setQuery(r.displayName)
  }

  return (
    <div className={`relative ${className}`}>
      <form onSubmit={handleSearch} className="flex items-center bg-slate-900/80 border border-slate-700 rounded-xl px-3 py-2 shadow-lg backdrop-blur-md">
        <Search size={16} className="text-slate-400 mr-2" />
        <input 
          type="text" 
          value={query} 
          onChange={(e) => { setQuery(e.target.value); if(e.target.value==='') setOpen(false); }}
          placeholder={placeholder}
          className="bg-transparent border-none outline-none text-sm text-slate-200 placeholder-slate-500 w-full min-w-[200px]"
        />
        {loading && <Loader2 size={16} className="animate-spin text-accent ml-2" />}
      </form>
      
      {open && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-slate-900/95 border border-slate-700 rounded-xl shadow-xl overflow-hidden backdrop-blur-xl z-50">
          {results.length === 0 && !loading && <div className="p-3 text-xs text-slate-500 text-center">No results found.</div>}
          {results.map((r, i) => (
            <button 
              key={i} 
              onClick={() => handleSelect(r)}
              className="w-full text-left p-3 hover:bg-slate-800 flex items-start gap-3 transition-colors border-b border-slate-800/50 last:border-0"
            >
              <MapPin size={16} className="text-accent shrink-0 mt-0.5" />
              <div className="text-xs text-slate-300 leading-tight">{r.displayName}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
