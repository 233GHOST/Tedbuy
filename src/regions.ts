export interface RegionOption {
  name: string;
  cities: string[];
}

export const GHANA_REGIONS: RegionOption[] = [
  {
    name: 'Greater Accra',
    cities: ['Accra', 'Tema', 'Legon', 'Madina', 'Spintex', 'East Legon', 'West Legon', 'Dansoman']
  },
  {
    name: 'Ashanti',
    cities: ['Kumasi', 'Obuasi', 'Ejisu', 'Konongo', 'Mampong', 'Tafo']
  },
  {
    name: 'Western',
    cities: ['Sekondi-Takoradi', 'Tarkwa', 'Axim', 'Elubo', 'Prestea']
  },
  {
    name: 'Eastern',
    cities: ['Koforidua', 'Nkawkaw', 'Akosombo', 'Aburi', 'Oda']
  },
  {
    name: 'Central',
    cities: ['Cape Coast', 'Winneba', 'Elmina', 'Kasoa_Central', 'Swedru']
  },
  {
    name: 'Northern',
    cities: ['Tamale', 'Yendi', 'Savelugu']
  },
  {
    name: 'Volta',
    cities: ['Ho', 'Keta', 'Aflao', 'Hohoe']
  },
  {
    name: 'Bono',
    cities: ['Sunyani', 'Berekum']
  },
  {
    name: 'Bono East',
    cities: ['Techiman', 'Kintampo']
  },
  {
    name: 'Upper East',
    cities: ['Bolgatanga', 'Navrongo']
  },
  {
    name: 'Upper West',
    cities: ['Wa']
  },
  {
    name: 'Western North',
    cities: ['Wiawso']
  },
  {
    name: 'Oti',
    cities: ['Dambai']
  },
  {
    name: 'Savannah',
    cities: ['Damongo']
  },
  {
    name: 'Ahafo',
    cities: ['Goaso']
  },
  {
    name: 'North East',
    cities: ['Nalerigu']
  }
];

/**
 * Returns the region for a given city/location string by checking substrings.
 * E.g., "East Legon, Accra" -> "Greater Accra Region"
 */
export function getRegionForLocation(location: string): string {
  const norm = location.toLowerCase();
  
  // Quick checks first
  if (norm.includes('accra') || norm.includes('tema') || norm.includes('legon') || norm.includes('madina') || norm.includes('spintex') || norm.includes('dansoman')) {
    return 'Greater Accra';
  }
  if (norm.includes('kumasi') || norm.includes('obuasi') || norm.includes('ejisu') || norm.includes('konongo') || norm.includes('tafo')) {
    return 'Ashanti';
  }
  if (norm.includes('takoradi') || norm.includes('tarkwa')) {
    return 'Western';
  }
  if (norm.includes('cape coast') || norm.includes('winneba') || norm.includes('elmina') || norm.includes('kasoa')) {
    return 'Central';
  }
  if (norm.includes('koforidua') || norm.includes('nkawkaw') || norm.includes('akosombo') || norm.includes('aburi')) {
    return 'Eastern';
  }
  if (norm.includes('tamale')) {
    return 'Northern';
  }
  if (norm.includes('ho ') || norm.includes('ho,') || norm === 'ho' || norm.includes('keta') || norm.includes('aflao')) {
    return 'Volta';
  }

  // Fallback search through all configured values
  for (const reg of GHANA_REGIONS) {
    if (norm.includes(reg.name.toLowerCase())) {
      return reg.name;
    }
    for (const city of reg.cities) {
      if (norm.includes(city.toLowerCase())) {
        return reg.name;
      }
    }
  }

  return 'Other Region';
}
