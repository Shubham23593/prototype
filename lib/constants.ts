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

