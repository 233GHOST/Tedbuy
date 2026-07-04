export interface RegionOption {
  name: string;
  cities: string[];
}

export const GHANA_REGIONS: RegionOption[] = [
  {
    name: 'Greater Accra',
    cities: [
      'Accra', 'Tema', 'Legon', 'Madina', 'Spintex',
      'East Legon', 'West Legon', 'Dansoman', 'Osu',
      'Cantonments', 'Labadi', 'Nungua', 'Lashibi',
      'Teshie', 'Ashaiman', 'Gbawe', 'Weija', 'Pokuase',
      'Kwabenya', 'Dome', 'Achimota', 'Adenta', 'Abokobi',
      'Chorkor', 'Jamestown', 'Kokomlemle', 'Airport Residential Area',
      'Dzorwulu', 'Kanda', 'Nima', 'Tesano', 'Lapaz', 'Sowutuom'
    ]
  },
  {
    name: 'Ashanti',
    cities: [
      'Kumasi', 'Obuasi', 'Ejisu', 'Konongo', 'Mampong',
      'Tafo', 'Offinso', 'Bekwai', 'Agogo', 'Nkauanza',
      'Juaben', 'Kwame Danso', 'Tepa', 'Amakom', 'Bantama',
      'Asokwa', 'Suhame', 'Santasi', 'Abuakwa', 'Adum', 'Adugyama'
    ]
  },
  {
    name: 'Western',
    cities: [
      'Sekondi-Takoradi', 'Tarkwa', 'Axim', 'Elubo', 'Prestea',
      'Bibiani', 'Nzema', 'Busua', 'Shama', 'Dixcove', 'Kwesimintsim',
      'Effiakuma', 'Anaji', 'Kojokrom'
    ]
  },
  {
    name: 'Eastern',
    cities: [
      'Koforidua', 'Nkawkaw', 'Akosombo', 'Aburi', 'Oda',
      'Somanya', 'Suhum', 'Kyebi', 'Asamankese', 'Mpraeso',
      'Begoro', 'Kpong', 'Nsawam', 'Larteh', 'Krobo Odumase'
    ]
  },
  {
    name: 'Central',
    cities: [
      'Cape Coast', 'Winneba', 'Elmina', 'Kasoa', 'Swedru',
      'Saltpond', 'Mankessim', 'Komenda', 'Apam', 'Buduburam',
      'Senya Beraku', 'Kasoa Central'
    ]
  },
  {
    name: 'Northern',
    cities: [
      'Tamale', 'Yendi', 'Savelugu', 'Bimbilla', 'Gushiegu',
      'Nanton', 'Saboba'
    ]
  },
  {
    name: 'Volta',
    cities: [
      'Ho', 'Keta', 'Aflao', 'Hohoe', 'Sogakope', 'Tsito',
      'Kpando', 'Peki', 'Anloga', 'Dzodze', 'Adidome', 'Akatsi'
    ]
  },
  {
    name: 'Bono',
    cities: [
      'Sunyani', 'Berekum', 'Dormaa Ahenkro', 'Japekrom',
      'Sampa', 'Nsuatre'
    ]
  },
  {
    name: 'Bono East',
    cities: [
      'Techiman', 'Kintampo', 'Atebubu', 'Nkoranza', 'Yeji',
      'Prang', 'Kajaji'
    ]
  },
  {
    name: 'Upper East',
    cities: [
      'Bolgatanga', 'Navrongo', 'Bawku', 'Paga', 'Sandema',
      'Garusal', 'Zuarungu'
    ]
  },
  {
    name: 'Upper West',
    cities: [
      'Wa', 'Lawra', 'Jirapa', 'Tumu', 'Nandom'
    ]
  },
  {
    name: 'Western North',
    cities: [
      'Wiawso', 'Enchi', 'Bia', 'Sefwi Bekwai', 'Sefwi Akontombra'
    ]
  },
  {
    name: 'Oti',
    cities: [
      'Dambai', 'Nkwanta', 'Jasikan', 'Kadjebi', 'Chinderi'
    ]
  },
  {
    name: 'Savannah',
    cities: [
      'Damongo', 'Salaga', 'Bole', 'Buipe', 'Daboya'
    ]
  },
  {
    name: 'Ahafo',
    cities: [
      'Goaso', 'Bechem', 'Duayaw Nkwanta', 'Mim', 'Hwidiem'
    ]
  },
  {
    name: 'North East',
    cities: [
      'Nalerigu', 'Walewale', 'Gambaga', 'Bunkpurugu', 'Chereponi'
    ]
  }
];

/**
 * Returns the region for a given city/location string by checking substrings.
 * E.g., "East Legon, Accra" -> "Greater Accra Region"
 */
export function getRegionForLocation(location: string): string {
  const norm = location.toLowerCase();
  
  // Quick checks first for dominant cities
  if (norm.includes('accra') || norm.includes('tema') || norm.includes('legon') || norm.includes('madina') || norm.includes('spintex') || norm.includes('dansoman') || norm.includes('adenta') || norm.includes('osu') || norm.includes('airport') || norm.includes('dzorwulu') || norm.includes('teshie') || norm.includes('nungua') || norm.includes('ashaiman')) {
    return 'Greater Accra';
  }
  if (norm.includes('kumasi') || norm.includes('obuasi') || norm.includes('ejisu') || norm.includes('konongo') || norm.includes('tafo') || norm.includes('asokwa') || norm.includes('mampong') || norm.includes('bekwai')) {
    return 'Ashanti';
  }
  if (norm.includes('takoradi') || norm.includes('tarkwa') || norm.includes('axim') || norm.includes('sekondi')) {
    return 'Western';
  }
  if (norm.includes('cape coast') || norm.includes('winneba') || norm.includes('elmina') || norm.includes('kasoa') || norm.includes('swedru') || norm.includes('mankessim')) {
    return 'Central';
  }
  if (norm.includes('koforidua') || norm.includes('nkawkaw') || norm.includes('akosombo') || norm.includes('aburi') || norm.includes('nsawam') || norm.includes('somanya') || norm.includes('suhum')) {
    return 'Eastern';
  }
  if (norm.includes('tamale') || norm.includes('yendi') || norm.includes('savelugu')) {
    return 'Northern';
  }
  if (norm.includes('ho ') || norm.includes('ho,') || norm === 'ho' || norm.includes('keta') || norm.includes('aflao') || norm.includes('hohoe')) {
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
