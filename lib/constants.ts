import type { ClassKey, Region, RiskLevel } from './types';

export const CLASSES: Record<ClassKey, { label: string; short: string; color: string; bg: string }> = {
  industrial: { label: 'Potential Industrial Fire', short: 'Potential Industrial Fire', color: '#ef4444', bg: '#fee2e2' },
  forest: { label: 'Forest / Natural Fire', short: 'Forest / Natural Fire', color: '#10b981', bg: '#d1fae5' },
  agriculture: { label: 'Agricultural or Waste Burning', short: 'Agricultural / Waste Burning', color: '#f59e0b', bg: '#fef3c7' },
  persistent: { label: 'Persistent Thermal Source', short: 'Persistent Thermal Source', color: '#8b5cf6', bg: '#ede9fe' },
  uncertain: { label: 'Other / Uncertain', short: 'Other / Uncertain', color: '#6b7280', bg: '#f3f4f6' },
  unclassified: { label: 'Provisional / Unclassified', short: 'Provisional', color: '#9ca3af', bg: '#f3f4f6' },
  // Backward-compatibility aliases for legacy dataset keys
  vegetation: { label: 'Forest / Natural Fire', short: 'Forest / Natural Fire', color: '#10b981', bg: '#d1fae5' },
  static: { label: 'Persistent Thermal Source', short: 'Persistent Thermal Source', color: '#8b5cf6', bg: '#ede9fe' },
  offshore: { label: 'Other / Uncertain', short: 'Other / Uncertain', color: '#6b7280', bg: '#f3f4f6' },
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

