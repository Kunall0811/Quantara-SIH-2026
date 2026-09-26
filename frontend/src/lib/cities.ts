import { useState, useEffect } from 'react';
import type { LatLon } from './types';

export const CITY_PRESETS: Record<string, Record<string, LatLon>> = {
  Pune: {
    'Pune — Shivajinagar': { lat: 18.5204, lon: 73.8567 },
    'Pune — Hinjewadi': { lat: 18.5912, lon: 73.7389 },
    'Pune — Baner': { lat: 18.5590, lon: 73.7869 },
    'Pune — Kothrud': { lat: 18.5074, lon: 73.8077 },
    'Pune — Hadapsar': { lat: 18.5089, lon: 73.9260 },
    'Pune — Swargate': { lat: 18.5010, lon: 73.8580 },
  },
  Delhi: {
    'Delhi — Connaught Place': { lat: 28.6304, lon: 77.2177 },
    'Delhi — Dwarka': { lat: 28.5921, lon: 77.0460 },
    'Delhi — Vasant Kunj': { lat: 28.5245, lon: 77.1587 },
    'Delhi — Rohini': { lat: 28.7366, lon: 77.0983 },
    'Delhi — Noida Sector 62': { lat: 28.6277, lon: 77.3614 },
    'Delhi — Gurugram Cyber City': { lat: 28.4950, lon: 77.0895 },
  },
  Mumbai: {
    'Mumbai — Andheri': { lat: 19.1136, lon: 72.8697 },
    'Mumbai — Bandra': { lat: 19.0596, lon: 72.8295 },
    'Mumbai — Colaba': { lat: 18.9067, lon: 72.8147 },
    'Mumbai — Powai': { lat: 19.1176, lon: 72.9060 },
    'Mumbai — Borivali': { lat: 19.2307, lon: 72.8567 },
    'Mumbai — Navi Mumbai': { lat: 19.0330, lon: 73.0297 },
  },
  Bangalore: {
    'Bangalore — Koramangala': { lat: 12.9279, lon: 77.6271 },
    'Bangalore — Indiranagar': { lat: 12.9719, lon: 77.6412 },
    'Bangalore — Whitefield': { lat: 12.9698, lon: 77.7499 },
    'Bangalore — Jayanagar': { lat: 12.9299, lon: 77.5824 },
    'Bangalore — Electronic City': { lat: 12.8452, lon: 77.6602 },
    'Bangalore — Hebbal': { lat: 13.0354, lon: 77.5988 },
  },
  Jaipur: {
    'Jaipur — Malviya Nagar': { lat: 26.8530, lon: 75.8047 },
    'Jaipur — Vaishali Nagar': { lat: 26.9061, lon: 75.7369 },
    'Jaipur — C-Scheme': { lat: 26.9075, lon: 75.8008 },
    'Jaipur — Mansarovar': { lat: 26.8643, lon: 75.7601 },
    'Jaipur — Tonk Road': { lat: 26.8368, lon: 75.7958 },
    'Jaipur — Raja Park': { lat: 26.8970, lon: 75.8340 },
  },
  Hyderabad: {
    'Hyderabad — Central': { lat: 17.3850, lon: 78.4867 }, 'Hyderabad — Hitech City': { lat: 17.4483, lon: 78.3915 }, 'Hyderabad — Gachibowli': { lat: 17.4401, lon: 78.3489 },
    'Hyderabad — Secunderabad': { lat: 17.4399, lon: 78.4983 }, 'Hyderabad — Banjara Hills': { lat: 17.4156, lon: 78.4347 },
  },
  Chennai: {
    'Chennai — Central': { lat: 13.0827, lon: 80.2707 }, 'Chennai — T Nagar': { lat: 13.0418, lon: 80.2341 }, 'Chennai — Velachery': { lat: 12.9791, lon: 80.2212 },
    'Chennai — Anna Nagar': { lat: 13.0850, lon: 80.2101 }, 'Chennai — OMR': { lat: 12.9010, lon: 80.2279 },
  },
  Kolkata: {
    'Kolkata — Central': { lat: 22.5726, lon: 88.3639 }, 'Kolkata — Salt Lake': { lat: 22.5800, lon: 88.4180 }, 'Kolkata — Howrah': { lat: 22.5958, lon: 88.2636 }, 'Kolkata — Park Street': { lat: 22.5527, lon: 88.3527 },
  },
  Ahmedabad: {
    'Ahmedabad — Central': { lat: 23.0225, lon: 72.5714 }, 'Ahmedabad — Navrangpura': { lat: 23.0365, lon: 72.5610 }, 'Ahmedabad — Satellite': { lat: 23.0270, lon: 72.5150 }, 'Ahmedabad — Bopal': { lat: 23.0339, lon: 72.4692 },
  },
  Nagpur: {
    'Nagpur — Central': { lat: 21.1458, lon: 79.0882 }, 'Nagpur — Dharampeth': { lat: 21.1394, lon: 79.0669 }, 'Nagpur — Sadar': { lat: 21.1622, lon: 79.0745 },
  },
  Nashik: {
    'Nashik — Central': { lat: 19.9975, lon: 73.7898 }, 'Nashik — College Road': { lat: 20.0059, lon: 73.7784 }, 'Nashik — Gangapur Road': { lat: 19.9975, lon: 73.7500 },
  }
};

export function useCityPresets() {
  const [city, setCity] = useState<string>(() => localStorage.getItem('quantara_city') || 'Pune');

  useEffect(() => {
    const handleCityChange = (e: Event) => {
      const newCity = (e as CustomEvent).detail?.city;
      if (newCity && CITY_PRESETS[newCity]) {
        setCity(newCity);
      }
    };
    window.addEventListener('quantara:city-change', handleCityChange);
    return () => window.removeEventListener('quantara:city-change', handleCityChange);
  }, []);

  return {
    city,
    presets: CITY_PRESETS[city] || CITY_PRESETS['Pune']
  };
}
