import type { ClassKey, PrimaryClass, Region, RiskLevel } from './types';

export const PRIMARY_CLASSES: Record<PrimaryClass, { label: string; color: string; bg: string }> = {
  industrial: { label: 'Industrial', color: '#dc2626', bg: '#fee2e2' },
  non_industrial: { label: 'Non-Industrial', color: '#16a34a', bg: '#dcfce7' },
  uncertain: { label: 'Other / Uncertain', color: '#64748b', bg: '#f1f5f9' },
};

export const CLASSES: Record<ClassKey, { label: string; short: string; color: string; bg: string; primary: PrimaryClass }> = {
  // Industrial Event Categories
  normal_industrial: { label: 'Normal Industrial Heat', short: 'Normal Industrial Heat', color: '#c026d3', bg: '#fae8ff', primary: 'industrial' },
  persistent: { label: 'Persistent Thermal Source', short: 'Persistent Thermal Source', color: '#7c3aed', bg: '#ede9fe', primary: 'industrial' },
  gas_flare: { label: 'Gas Flare / Refinery Heat', short: 'Gas Flare / Refinery Heat', color: '#ea580c', bg: '#ffedd5', primary: 'industrial' },
  industrial: { label: 'Potential Industrial Fire — Requires Ground Verification', short: 'Potential Industrial Fire', color: '#dc2626', bg: '#fee2e2', primary: 'industrial' },
  major_industrial: { label: 'Major Industrial Incident Candidate — Requires Ground Verification', short: 'Major Industrial Incident', color: '#b91c1c', bg: '#fecaca', primary: 'industrial' },

  // Non-Industrial Event Categories
  forest: { label: 'Forest / Natural Fire', short: 'Forest / Natural Fire', color: '#16a34a', bg: '#dcfce7', primary: 'non_industrial' },
  agriculture: { label: 'Agricultural Burning', short: 'Agricultural Burning', color: '#d97706', bg: '#fef3c7', primary: 'non_industrial' },
  waste: { label: 'Waste Burning', short: 'Waste Burning', color: '#0891b2', bg: '#cffafe', primary: 'non_industrial' },
  offshore: { label: 'Offshore / Water Thermal Anomaly', short: 'Offshore Thermal Anomaly', color: '#0284c7', bg: '#e0f2fe', primary: 'non_industrial' },

  // Uncertain Event Categories
  uncertain: { label: 'Other / Uncertain', short: 'Other / Uncertain', color: '#64748b', bg: '#f1f5f9', primary: 'uncertain' },
  unclassified: { label: 'Provisional / Unclassified', short: 'Provisional', color: '#94a3b8', bg: '#f1f5f9', primary: 'uncertain' },

  // Backward-compatibility aliases
  vegetation: { label: 'Forest / Natural Fire', short: 'Forest / Natural Fire', color: '#16a34a', bg: '#dcfce7', primary: 'non_industrial' },
  static: { label: 'Persistent Thermal Source', short: 'Persistent Thermal Source', color: '#7c3aed', bg: '#ede9fe', primary: 'industrial' },
};

export const RISK_LEVELS: Record<RiskLevel, { label: string; color: string; bg: string }> = {
  low: { label: 'Low Risk', color: '#10b981', bg: '#d1fae5' },
  medium: { label: 'Medium Risk', color: '#f59e0b', bg: '#fef3c7' },
  high: { label: 'High Priority', color: '#f97316', bg: '#ffedd5' },
  critical: { label: 'Critical Priority', color: '#ef4444', bg: '#fee2e2' },
};

export const REGIONS: Region[] = [
  { id: 'india', name: 'India region', bbox: [68, 6, 98, 37], center: [22.2, 80.7], zoom: 4.5 },
  { id: 'maharashtra', name: 'Maharashtra area', bbox: [72, 15.5, 81, 22.5], center: [19.5, 76.5], zoom: 6 },
  { id: 'central', name: 'Central India', bbox: [73, 19, 87, 27], center: [23, 80], zoom: 5.5 },
  { id: 'east', name: 'Eastern corridor', bbox: [82, 19, 93, 28], center: [23, 86], zoom: 5.5 },
  { id: 'north', name: 'Northern plains', bbox: [72, 26, 85, 33], center: [29.5, 78.5], zoom: 5.5 },
  { id: 'south', name: 'Southern peninsula', bbox: [73, 7, 83, 19], center: [13, 78], zoom: 5.5 },
];

export const formatNumber = (value: number, digits = 0) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: digits }).format(value);
export const formatDate = (value: string | null | undefined, options: Intl.DateTimeFormatOptions = {}) => value ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC', ...options }).format(new Date(value)) : 'Not available';
export const formatTime = (value: string) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false }).format(new Date(value));
export const coordinates = (lat: number, lon: number, digits = 3) => `${Math.abs(lat).toFixed(digits)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(digits)}°${lon >= 0 ? 'E' : 'W'}`;
export const satelliteName = (value: string) => ({ N: 'Suomi NPP', N20: 'NOAA-20', N21: 'NOAA-21', '1': 'NOAA-20', '2': 'NOAA-21' }[value] || value);

export interface IndustrialSite {
  name: string;
  lat: number;
  lon: number;
  type: 'refinery' | 'petrochemical' | 'power_plant' | 'gas_flare' | 'industrial';
  radius_m: number;
}

export const GENUINE_INDUSTRIAL_SITES: IndustrialSite[] = [
  { name: 'Jamnagar Refinery Complex (Reliance)', lat: 22.3556, lon: 69.8667, type: 'refinery', radius_m: 4500 },
  { name: 'Jamnagar Vadinar Refinery (Nayara)', lat: 22.3986, lon: 69.6917, type: 'refinery', radius_m: 3500 },
  { name: 'Dahej PCPIR & Petrochemical Complex', lat: 21.7050, lon: 72.5850, type: 'petrochemical', radius_m: 4000 },
  { name: 'Hazira Industrial & Petrochemical Hub', lat: 21.1400, lon: 72.6450, type: 'petrochemical', radius_m: 4000 },
  { name: 'BPCL Kochi Refinery (Ambalamugal)', lat: 9.9575, lon: 76.3683, type: 'refinery', radius_m: 2500 },
  { name: 'MRPL Mangalore Refinery', lat: 12.9967, lon: 74.8389, type: 'refinery', radius_m: 3000 },
  { name: 'BPCL Mumbai Refinery (Mahul/Trombay)', lat: 19.0069, lon: 72.8986, type: 'refinery', radius_m: 2500 },
  { name: 'HPCL Mumbai Refinery (Mahul)', lat: 19.0142, lon: 72.8950, type: 'refinery', radius_m: 2500 },
  { name: 'CPCL Manali Refinery (Chennai)', lat: 13.1678, lon: 80.2644, type: 'refinery', radius_m: 2500 },
  { name: 'HPCL Visakh Refinery (Visakhapatnam)', lat: 17.6975, lon: 83.2597, type: 'refinery', radius_m: 2500 },
  { name: 'IOCL Paradip Refinery', lat: 20.2789, lon: 86.6433, type: 'refinery', radius_m: 3500 },
  { name: 'IOCL Haldia Refinery', lat: 22.0622, lon: 88.0833, type: 'refinery', radius_m: 2500 },
  { name: 'IOCL Barauni Refinery (Begusarai)', lat: 25.4056, lon: 86.0289, type: 'refinery', radius_m: 2500 },
  { name: 'IOCL Mathura Refinery', lat: 27.3917, lon: 77.6889, type: 'refinery', radius_m: 2500 },
  { name: 'IOCL Panipat Refinery & Petrochemical Complex', lat: 29.4750, lon: 76.8833, type: 'refinery', radius_m: 3500 },
  { name: 'BORL Bina Refinery (Madhya Pradesh)', lat: 24.1850, lon: 78.1889, type: 'refinery', radius_m: 3000 },
  { name: 'HMEL Guru Gobind Singh Refinery (Bathinda)', lat: 29.9889, lon: 75.0167, type: 'refinery', radius_m: 3000 },
  { name: 'IOCL Bongaigaon Refinery (Assam)', lat: 26.5056, lon: 90.5289, type: 'refinery', radius_m: 2500 },
  { name: 'Numaligarh Refinery (Golaghat, Assam)', lat: 26.6028, lon: 93.7556, type: 'refinery', radius_m: 2500 },
  { name: 'Digboi Refinery (Assam)', lat: 27.3889, lon: 95.6306, type: 'refinery', radius_m: 2000 },
  { name: 'Tatipaka Mini Refinery & Gas Processing (ONGC)', lat: 16.5189, lon: 81.8656, type: 'gas_flare', radius_m: 2000 },
  { name: 'Uran Gas Turbine & LPG Plant (ONGC)', lat: 18.8833, lon: 72.9333, type: 'gas_flare', radius_m: 2500 },
  { name: 'Mundra Ultra Mega Power Plant (Tata/Adani)', lat: 22.8250, lon: 69.5250, type: 'power_plant', radius_m: 4000 },
  { name: 'Vindhyachal Super Thermal Power Station (Singrauli)', lat: 24.0986, lon: 82.6667, type: 'power_plant', radius_m: 3500 },
  { name: 'Sasan Ultra Mega Power Plant (Singrauli)', lat: 23.9750, lon: 82.6250, type: 'power_plant', radius_m: 3500 },
  { name: 'NTPC Korba Super Thermal Power Plant', lat: 22.3833, lon: 82.6833, type: 'power_plant', radius_m: 3000 },
  { name: 'NTPC Talcher Super Thermal Power Station', lat: 20.9139, lon: 85.0767, type: 'power_plant', radius_m: 3000 },
  { name: 'NTPC Rihand Super Thermal Power Station', lat: 24.0250, lon: 82.7917, type: 'power_plant', radius_m: 3000 },
  { name: 'NTPC Singrauli Super Thermal (Shaktinagar)', lat: 24.1083, lon: 82.7833, type: 'power_plant', radius_m: 3000 },
  { name: 'Chandrapur Super Thermal Power Station (CSTPS)', lat: 19.9833, lon: 79.2833, type: 'power_plant', radius_m: 3000 },
  { name: 'NTPC Ramagundam Super Thermal Power Station', lat: 18.7583, lon: 79.4583, type: 'power_plant', radius_m: 3000 },
  { name: 'Kudgi Super Thermal Power Station (Bijapur)', lat: 16.6333, lon: 75.9167, type: 'power_plant', radius_m: 3000 },
  { name: 'Neyveli Thermal Power Station (NLC India)', lat: 11.5333, lon: 79.4833, type: 'power_plant', radius_m: 3000 },
  { name: 'NTPC Simhadri Super Thermal (Visakhapatnam)', lat: 17.6000, lon: 83.0833, type: 'power_plant', radius_m: 2500 },
  { name: 'Mejia Thermal Power Station (DVC, Bankura)', lat: 23.4667, lon: 87.1333, type: 'power_plant', radius_m: 2500 },
  { name: 'Kahalgaon Super Thermal Power Station (Bhagalpur)', lat: 25.2667, lon: 87.2500, type: 'power_plant', radius_m: 2500 },
  { name: 'Barh Super Thermal Power Station (Patna)', lat: 25.4833, lon: 85.7167, type: 'power_plant', radius_m: 3000 },
  { name: 'Anpara Thermal Power Station (Sonbhadra)', lat: 24.2000, lon: 82.7833, type: 'power_plant', radius_m: 2500 },
  { name: 'Obra Thermal Power Station (Sonbhadra)', lat: 24.4167, lon: 82.9833, type: 'power_plant', radius_m: 2500 },
  { name: 'Suratgarh Super Thermal Power Station (Rajasthan)', lat: 29.1833, lon: 73.9000, type: 'power_plant', radius_m: 2500 },
  { name: 'Wanakbori Thermal Power Station (Kheda)', lat: 22.8667, lon: 73.3500, type: 'power_plant', radius_m: 2500 },
  { name: 'Ukai Thermal Power Station (Tapi, Gujarat)', lat: 21.2167, lon: 73.5833, type: 'power_plant', radius_m: 2500 },
  { name: 'Adani Dahanu Thermal Power Station (Maharashtra)', lat: 19.9667, lon: 72.7333, type: 'power_plant', radius_m: 2000 },
  { name: 'Ennore Thermal Power Station (Chennai)', lat: 13.2000, lon: 80.3167, type: 'power_plant', radius_m: 2500 },
  { name: 'NTECL Vallur Thermal Power Station (Chennai)', lat: 13.2333, lon: 80.2833, type: 'power_plant', radius_m: 2500 },
  { name: 'Tuticorin Thermal Power Station (TTPS)', lat: 8.7667, lon: 78.1667, type: 'power_plant', radius_m: 2500 },
  { name: 'Raichur Thermal Power Station (RTPS)', lat: 16.3500, lon: 77.3500, type: 'power_plant', radius_m: 2500 },
  { name: 'Bellary Thermal Power Station (Kudatini)', lat: 15.1833, lon: 76.7167, type: 'power_plant', radius_m: 2500 },
  { name: 'NTPC Dadri Power Plant (Gautam Buddha Nagar)', lat: 28.6000, lon: 77.6000, type: 'power_plant', radius_m: 2500 },
  { name: 'Jindal Tamnar Thermal Power Plant (Raigarh)', lat: 22.1000, lon: 83.4500, type: 'power_plant', radius_m: 3000 },
  { name: 'Bhilai Steel Plant (SAIL, Chhattisgarh)', lat: 21.1833, lon: 81.4000, type: 'industrial', radius_m: 4500 },
  { name: 'Tata Steel Jamshedpur Works', lat: 22.8000, lon: 86.2000, type: 'industrial', radius_m: 4000 },
  { name: 'Bokaro Steel Plant (SAIL, Jharkhand)', lat: 23.6667, lon: 86.1500, type: 'industrial', radius_m: 4500 },
  { name: 'Rourkela Steel Plant (SAIL, Odisha)', lat: 22.2167, lon: 84.8667, type: 'industrial', radius_m: 4000 },
  { name: 'Durgapur Steel Plant (SAIL, West Bengal)', lat: 23.5167, lon: 87.2833, type: 'industrial', radius_m: 3500 },
  { name: 'IISCO Steel Plant Burnpur (SAIL, Asansol)', lat: 23.6667, lon: 86.9333, type: 'industrial', radius_m: 3500 },
  { name: 'Rashtriya Ispat Nigam RINL (Visakhapatnam)', lat: 17.6333, lon: 83.1833, type: 'industrial', radius_m: 4500 },
  { name: 'JSW Steel Vijayanagar Works (Toranagallu, Ballari)', lat: 15.1833, lon: 76.6667, type: 'industrial', radius_m: 5000 },
  { name: 'Tata Steel Kalinganagar (Jajpur, Odisha)', lat: 20.9667, lon: 85.9833, type: 'industrial', radius_m: 4500 },
  { name: 'Jindal Steel & Power Angul (Odisha)', lat: 20.8333, lon: 85.1667, type: 'industrial', radius_m: 4000 },
  { name: 'Vedanta Aluminium & Power Complex (Jharsuguda)', lat: 21.8333, lon: 84.0333, type: 'industrial', radius_m: 4000 },
  { name: 'BALCO Aluminium Smelter (Korba)', lat: 22.3667, lon: 82.7500, type: 'industrial', radius_m: 3500 },
  { name: 'Hindalco Renukoot Aluminium Complex (Sonbhadra)', lat: 24.2167, lon: 83.0333, type: 'industrial', radius_m: 3000 },
  { name: 'Tarapur MIDC Chemical & Engineering Zone', lat: 19.8167, lon: 72.7167, type: 'industrial', radius_m: 3500 },
  { name: 'Taloja MIDC Chemical Complex (Navi Mumbai)', lat: 19.0667, lon: 73.1167, type: 'industrial', radius_m: 3000 },
  { name: 'Mahad MIDC Chemical Hub (Raigad)', lat: 18.1000, lon: 73.4333, type: 'industrial', radius_m: 3000 },
  { name: 'Roha MIDC Industrial Area (Raigad)', lat: 18.4333, lon: 73.1167, type: 'industrial', radius_m: 2500 },
  { name: 'Patalganga MIDC Industrial Area (Rasayani)', lat: 18.9000, lon: 73.1667, type: 'industrial', radius_m: 3000 },
  { name: 'Ankleshwar GIDC Chemical Estate (Bharuch)', lat: 21.6333, lon: 73.0000, type: 'industrial', radius_m: 4000 },
  { name: 'Vapi GIDC Industrial Area (Valsad)', lat: 20.3833, lon: 72.9167, type: 'industrial', radius_m: 4000 },
  { name: 'Panoli GIDC Industrial Estate (Bharuch)', lat: 21.5333, lon: 72.9667, type: 'industrial', radius_m: 3000 },
  { name: 'Jhagadia GIDC Industrial Estate (Bharuch)', lat: 21.6833, lon: 73.1333, type: 'industrial', radius_m: 3500 },
  { name: 'Nandesari GIDC Chemical Estate (Vadodara)', lat: 22.4167, lon: 73.0833, type: 'industrial', radius_m: 2500 },
  { name: 'Sanand GIDC Industrial Estate (Ahmedabad)', lat: 22.9833, lon: 72.3667, type: 'industrial', radius_m: 3500 },
  { name: 'Chakan MIDC Industrial Area (Pune)', lat: 18.7500, lon: 73.8333, type: 'industrial', radius_m: 4000 },
  { name: 'Bhosari / Pimpri-Chinchwad Industrial Belt (Pune)', lat: 18.6333, lon: 73.8333, type: 'industrial', radius_m: 4000 },
  { name: 'Butibori MIDC Industrial Area (Nagpur)', lat: 20.9333, lon: 78.9833, type: 'industrial', radius_m: 4000 },
  { name: 'Waluj MIDC Industrial Area (Chhatrapati Sambhajinagar)', lat: 19.8333, lon: 75.2500, type: 'industrial', radius_m: 3500 },
  { name: 'Kurkumbh MIDC Chemical Zone (Pune)', lat: 18.4333, lon: 74.5500, type: 'industrial', radius_m: 2500 },
  { name: 'Atchutapuram SEZ (Visakhapatnam)', lat: 17.5333, lon: 82.9833, type: 'industrial', radius_m: 3500 },
  { name: 'Jawaharlal Nehru Pharma City (Parawada, Vizag)', lat: 17.6000, lon: 83.1000, type: 'industrial', radius_m: 3000 },
  { name: 'Patancheru & Pashamylaram Industrial Area (Hyderabad)', lat: 17.5333, lon: 78.2500, type: 'industrial', radius_m: 4000 },
  { name: 'Jeedimetla IDA (Hyderabad)', lat: 17.5167, lon: 78.4667, type: 'industrial', radius_m: 3000 },
  { name: 'Ranipet SIPCOT Industrial Area (Vellore)', lat: 12.9333, lon: 79.3333, type: 'industrial', radius_m: 3000 },
  { name: 'Cuddalore SIPCOT Chemical Complex', lat: 11.6833, lon: 79.7667, type: 'industrial', radius_m: 3000 },
  { name: 'Sriperumbudur & Oragadam SIPCOT (Kanchipuram)', lat: 12.9000, lon: 79.9500, type: 'industrial', radius_m: 4500 },
  { name: 'Hosur SIPCOT Industrial Complex', lat: 12.7333, lon: 77.8333, type: 'industrial', radius_m: 3500 },
  { name: 'Peenya Industrial Area (Bengaluru)', lat: 13.0333, lon: 77.5167, type: 'industrial', radius_m: 3500 },
  { name: 'Bhiwadi Industrial Area (Alwar, Rajasthan)', lat: 28.2000, lon: 76.8500, type: 'industrial', radius_m: 4000 },
  { name: 'Neemrana RIICO Industrial Area (Rajasthan)', lat: 27.9833, lon: 76.3833, type: 'industrial', radius_m: 3500 },
  { name: 'Manesar IMT (Gurugram, Haryana)', lat: 28.3667, lon: 76.9333, type: 'industrial', radius_m: 4000 },
  { name: 'Faridabad Industrial Area (Haryana)', lat: 28.3833, lon: 77.3167, type: 'industrial', radius_m: 4000 },
  { name: 'Mandi Gobindgarh Steel Cluster (Punjab)', lat: 30.6667, lon: 76.3000, type: 'industrial', radius_m: 3000 },
  { name: 'Ludhiana Focal Point Industrial Belt (Punjab)', lat: 30.8833, lon: 75.9000, type: 'industrial', radius_m: 4000 },
  { name: 'Eloor-Edayar Industrial Belt (Kochi)', lat: 10.0833, lon: 76.3000, type: 'industrial', radius_m: 3000 },
  { name: 'Adityapur Industrial Area (Jamshedpur)', lat: 22.7833, lon: 86.1667, type: 'industrial', radius_m: 3500 },
  { name: 'Urla & Siltara Industrial Growth Centres (Raipur)', lat: 21.3667, lon: 81.6500, type: 'industrial', radius_m: 4000 },
];

/**
 * Fast haversine calculation in meters to find nearest genuine industrial site.
 */
export function getNearestIndustrialFacility(lat: number, lon: number): { name: string; distanceM: number; isNearby: boolean; type: string } | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371008.8; // Earth radius in meters
  const lat1 = toRad(lat);
  const lon1 = toRad(lon);

  let nearest: IndustrialSite | null = null;
  let minDistance = Infinity;

  for (const site of GENUINE_INDUSTRIAL_SITES) {
    const lat2 = toRad(site.lat);
    const lon2 = toRad(site.lon);
    const dLat = lat2 - lat1;
    const dLon = lon2 - lon1;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const dist = R * c;

    if (dist < minDistance) {
      minDistance = dist;
      nearest = site;
    }
  }

  if (!nearest) return null;
  const effectiveRadius = Math.max(nearest.radius_m, 2500);
  return {
    name: nearest.name,
    distanceM: Math.round(minDistance),
    isNearby: minDistance <= effectiveRadius,
    type: nearest.type,
  };
}


