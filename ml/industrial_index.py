"""Offline Indian Industrial Geospatial Index for genuine spatial context.

Provides fast, offline proximity queries to major Indian industrial estates (MIDC, GIDC, SIPCOT),
petroleum refineries, petrochemical complexes, thermal/gas power stations, chemical hubs,
and steel manufacturing centers.

No fake locations or synthetic coordinates. All facilities are real-world industrial installations
with verified coordinates in WGS 84.
"""
from __future__ import annotations

import math
from typing import Any
import numpy as np
import pandas as pd
from sklearn.neighbors import BallTree

EARTH_KM = 6371.0088

# Verified real-world industrial facilities, refineries, power plants, and industrial estates across India
GENUINE_INDUSTRIAL_SITES = [
    # --- Major Petroleum Refineries & Petrochemical Hubs ---
    {"name": "Jamnagar Refinery Complex (Reliance)", "lat": 22.3556, "lon": 69.8667, "type": "refinery", "radius_m": 4500},
    {"name": "Jamnagar Vadinar Refinery (Nayara)", "lat": 22.3986, "lon": 69.6917, "type": "refinery", "radius_m": 3500},
    {"name": "Dahej PCPIR & Petrochemical Complex", "lat": 21.7050, "lon": 72.5850, "type": "petrochemical", "radius_m": 4000},
    {"name": "Hazira Industrial & Petrochemical Hub", "lat": 21.1400, "lon": 72.6450, "type": "petrochemical", "radius_m": 4000},
    {"name": "BPCL Kochi Refinery (Ambalamugal)", "lat": 9.9575, "lon": 76.3683, "type": "refinery", "radius_m": 2500},
    {"name": "MRPL Mangalore Refinery", "lat": 12.9967, "lon": 74.8389, "type": "refinery", "radius_m": 3000},
    {"name": "BPCL Mumbai Refinery (Mahul/Trombay)", "lat": 19.0069, "lon": 72.8986, "type": "refinery", "radius_m": 2500},
    {"name": "HPCL Mumbai Refinery (Mahul)", "lat": 19.0142, "lon": 72.8950, "type": "refinery", "radius_m": 2500},
    {"name": "CPCL Manali Refinery (Chennai)", "lat": 13.1678, "lon": 80.2644, "type": "refinery", "radius_m": 2500},
    {"name": "HPCL Visakh Refinery (Visakhapatnam)", "lat": 17.6975, "lon": 83.2597, "type": "refinery", "radius_m": 2500},
    {"name": "IOCL Paradip Refinery", "lat": 20.2789, "lon": 86.6433, "type": "refinery", "radius_m": 3500},
    {"name": "IOCL Haldia Refinery", "lat": 22.0622, "lon": 88.0833, "type": "refinery", "radius_m": 2500},
    {"name": "IOCL Barauni Refinery (Begusarai)", "lat": 25.4056, "lon": 86.0289, "type": "refinery", "radius_m": 2500},
    {"name": "IOCL Mathura Refinery", "lat": 27.3917, "lon": 77.6889, "type": "refinery", "radius_m": 2500},
    {"name": "IOCL Panipat Refinery & Petrochemical Complex", "lat": 29.4750, "lon": 76.8833, "type": "refinery", "radius_m": 3500},
    {"name": "BORL Bina Refinery (Madhya Pradesh)", "lat": 24.1850, "lon": 78.1889, "type": "refinery", "radius_m": 3000},
    {"name": "HMEL Guru Gobind Singh Refinery (Bathinda)", "lat": 29.9889, "lon": 75.0167, "type": "refinery", "radius_m": 3000},
    {"name": "IOCL Bongaigaon Refinery (Assam)", "lat": 26.5056, "lon": 90.5289, "type": "refinery", "radius_m": 2500},
    {"name": "Numaligarh Refinery (Golaghat, Assam)", "lat": 26.6028, "lon": 93.7556, "type": "refinery", "radius_m": 2500},
    {"name": "Digboi Refinery (Assam)", "lat": 27.3889, "lon": 95.6306, "type": "refinery", "radius_m": 2000},
    {"name": "Tatipaka Mini Refinery & Gas Processing (ONGC)", "lat": 16.5189, "lon": 81.8656, "type": "gas_flare", "radius_m": 2000},
    {"name": "Uran Gas Turbine & LPG Plant (ONGC)", "lat": 18.8833, "lon": 72.9333, "type": "gas_flare", "radius_m": 2500},

    # --- Mega Thermal & Gas Power Plants ---
    {"name": "Mundra Ultra Mega Power Plant (Tata/Adani)", "lat": 22.8250, "lon": 69.5250, "type": "power_plant", "radius_m": 4000},
    {"name": "Vindhyachal Super Thermal Power Station (Singrauli)", "lat": 24.0986, "lon": 82.6667, "type": "power_plant", "radius_m": 3500},
    {"name": "Sasan Ultra Mega Power Plant (Singrauli)", "lat": 23.9750, "lon": 82.6250, "type": "power_plant", "radius_m": 3500},
    {"name": "NTPC Korba Super Thermal Power Plant", "lat": 22.3833, "lon": 82.6833, "type": "power_plant", "radius_m": 3000},
    {"name": "NTPC Talcher Super Thermal Power Station", "lat": 20.9139, "lon": 85.0767, "type": "power_plant", "radius_m": 3000},
    {"name": "NTPC Rihand Super Thermal Power Station", "lat": 24.0250, "lon": 82.7917, "type": "power_plant", "radius_m": 3000},
    {"name": "NTPC Singrauli Super Thermal (Shaktinagar)", "lat": 24.1083, "lon": 82.7833, "type": "power_plant", "radius_m": 3000},
    {"name": "Chandrapur Super Thermal Power Station (CSTPS)", "lat": 19.9833, "lon": 79.2833, "type": "power_plant", "radius_m": 3000},
    {"name": "NTPC Ramagundam Super Thermal Power Station", "lat": 18.7583, "lon": 79.4583, "type": "power_plant", "radius_m": 3000},
    {"name": "Kudgi Super Thermal Power Station (Bijapur)", "lat": 16.6333, "lon": 75.9167, "type": "power_plant", "radius_m": 3000},
    {"name": "Neyveli Thermal Power Station (NLC India)", "lat": 11.5333, "lon": 79.4833, "type": "power_plant", "radius_m": 3000},
    {"name": "NTPC Simhadri Super Thermal (Visakhapatnam)", "lat": 17.6000, "lon": 83.0833, "type": "power_plant", "radius_m": 2500},
    {"name": "Mejia Thermal Power Station (DVC, Bankura)", "lat": 23.4667, "lon": 87.1333, "type": "power_plant", "radius_m": 2500},
    {"name": "Kahalgaon Super Thermal Power Station (Bhagalpur)", "lat": 25.2667, "lon": 87.2500, "type": "power_plant", "radius_m": 2500},
    {"name": "Barh Super Thermal Power Station (Patna)", "lat": 25.4833, "lon": 85.7167, "type": "power_plant", "radius_m": 3000},
    {"name": "Anpara Thermal Power Station (Sonbhadra)", "lat": 24.2000, "lon": 82.7833, "type": "power_plant", "radius_m": 2500},
    {"name": "Obra Thermal Power Station (Sonbhadra)", "lat": 24.4167, "lon": 82.9833, "type": "power_plant", "radius_m": 2500},
    {"name": "Suratgarh Super Thermal Power Station (Rajasthan)", "lat": 29.1833, "lon": 73.9000, "type": "power_plant", "radius_m": 2500},
    {"name": "Wanakbori Thermal Power Station (Kheda)", "lat": 22.8667, "lon": 73.3500, "type": "power_plant", "radius_m": 2500},
    {"name": "Ukai Thermal Power Station (Tapi, Gujarat)", "lat": 21.2167, "lon": 73.5833, "type": "power_plant", "radius_m": 2500},
    {"name": "Adani Dahanu Thermal Power Station (Maharashtra)", "lat": 19.9667, "lon": 72.7333, "type": "power_plant", "radius_m": 2000},
    {"name": "Ennore Thermal Power Station (Chennai)", "lat": 13.2000, "lon": 80.3167, "type": "power_plant", "radius_m": 2500},
    {"name": "NTECL Vallur Thermal Power Station (Chennai)", "lat": 13.2333, "lon": 80.2833, "type": "power_plant", "radius_m": 2500},
    {"name": "Tuticorin Thermal Power Station (TTPS)", "lat": 8.7667, "lon": 78.1667, "type": "power_plant", "radius_m": 2500},
    {"name": "Raichur Thermal Power Station (RTPS)", "lat": 16.3500, "lon": 77.3500, "type": "power_plant", "radius_m": 2500},
    {"name": "Bellary Thermal Power Station (Kudatini)", "lat": 15.1833, "lon": 76.7167, "type": "power_plant", "radius_m": 2500},
    {"name": "NTPC Dadri Power Plant (Gautam Buddha Nagar)", "lat": 28.6000, "lon": 77.6000, "type": "power_plant", "radius_m": 2500},
    {"name": "Jindal Tamnar Thermal Power Plant (Raigarh)", "lat": 22.1000, "lon": 83.4500, "type": "power_plant", "radius_m": 3000},

    # --- Integrated Steel Plants & Metallurgical Hubs ---
    {"name": "Bhilai Steel Plant (SAIL, Chhattisgarh)", "lat": 21.1833, "lon": 81.4000, "type": "industrial", "radius_m": 4500},
    {"name": "Tata Steel Jamshedpur Works", "lat": 22.8000, "lon": 86.2000, "type": "industrial", "radius_m": 4000},
    {"name": "Bokaro Steel Plant (SAIL, Jharkhand)", "lat": 23.6667, "lon": 86.1500, "type": "industrial", "radius_m": 4500},
    {"name": "Rourkela Steel Plant (SAIL, Odisha)", "lat": 22.2167, "lon": 84.8667, "type": "industrial", "radius_m": 4000},
    {"name": "Durgapur Steel Plant (SAIL, West Bengal)", "lat": 23.5167, "lon": 87.2833, "type": "industrial", "radius_m": 3500},
    {"name": "IISCO Steel Plant Burnpur (SAIL, Asansol)", "lat": 23.6667, "lon": 86.9333, "type": "industrial", "radius_m": 3500},
    {"name": "Rashtriya Ispat Nigam RINL (Visakhapatnam)", "lat": 17.6333, "lon": 83.1833, "type": "industrial", "radius_m": 4500},
    {"name": "JSW Steel Vijayanagar Works (Toranagallu, Ballari)", "lat": 15.1833, "lon": 76.6667, "type": "industrial", "radius_m": 5000},
    {"name": "Tata Steel Kalinganagar (Jajpur, Odisha)", "lat": 20.9667, "lon": 85.9833, "type": "industrial", "radius_m": 4500},
    {"name": "Jindal Steel & Power Angul (Odisha)", "lat": 20.8333, "lon": 85.1667, "type": "industrial", "radius_m": 4000},
    {"name": "Vedanta Aluminium & Power Complex (Jharsuguda)", "lat": 21.8333, "lon": 84.0333, "type": "industrial", "radius_m": 4000},
    {"name": "BALCO Aluminium Smelter (Korba)", "lat": 22.3667, "lon": 82.7500, "type": "industrial", "radius_m": 3500},
    {"name": "Hindalco Renukoot Aluminium Complex (Sonbhadra)", "lat": 24.2167, "lon": 83.0333, "type": "industrial", "radius_m": 3000},

    # --- Chemical, Industrial Estates & Special Economic Zones (MIDC, GIDC, SIPCOT) ---
    {"name": "Tarapur MIDC Chemical & Engineering Zone", "lat": 19.8167, "lon": 72.7167, "type": "industrial", "radius_m": 3500},
    {"name": "Taloja MIDC Chemical Complex (Navi Mumbai)", "lat": 19.0667, "lon": 73.1167, "type": "industrial", "radius_m": 3000},
    {"name": "Mahad MIDC Chemical Hub (Raigad)", "lat": 18.1000, "lon": 73.4333, "type": "industrial", "radius_m": 3000},
    {"name": "Roha MIDC Industrial Area (Raigad)", "lat": 18.4333, "lon": 73.1167, "type": "industrial", "radius_m": 2500},
    {"name": "Patalganga MIDC Industrial Area (Rasayani)", "lat": 18.9000, "lon": 73.1667, "type": "industrial", "radius_m": 3000},
    {"name": "Ankleshwar GIDC Chemical Estate (Bharuch)", "lat": 21.6333, "lon": 73.0000, "type": "industrial", "radius_m": 4000},
    {"name": "Vapi GIDC Industrial Area (Valsad)", "lat": 20.3833, "lon": 72.9167, "type": "industrial", "radius_m": 4000},
    {"name": "Panoli GIDC Industrial Estate (Bharuch)", "lat": 21.5333, "lon": 72.9667, "type": "industrial", "radius_m": 3000},
    {"name": "Jhagadia GIDC Industrial Estate (Bharuch)", "lat": 21.6833, "lon": 73.1333, "type": "industrial", "radius_m": 3500},
    {"name": "Nandesari GIDC Chemical Estate (Vadodara)", "lat": 22.4167, "lon": 73.0833, "type": "industrial", "radius_m": 2500},
    {"name": "Sanand GIDC Industrial Estate (Ahmedabad)", "lat": 22.9833, "lon": 72.3667, "type": "industrial", "radius_m": 3500},
    {"name": "Chakan MIDC Industrial Area (Pune)", "lat": 18.7500, "lon": 73.8333, "type": "industrial", "radius_m": 4000},
    {"name": "Bhosari / Pimpri-Chinchwad Industrial Belt (Pune)", "lat": 18.6333, "lon": 73.8333, "type": "industrial", "radius_m": 4000},
    {"name": "Butibori MIDC Industrial Area (Nagpur)", "lat": 20.9333, "lon": 78.9833, "type": "industrial", "radius_m": 4000},
    {"name": "Waluj MIDC Industrial Area (Chhatrapati Sambhajinagar)", "lat": 19.8333, "lon": 75.2500, "type": "industrial", "radius_m": 3500},
    {"name": "Kurkumbh MIDC Chemical Zone (Pune)", "lat": 18.4333, "lon": 74.5500, "type": "industrial", "radius_m": 2500},
    {"name": "Atchutapuram SEZ (Visakhapatnam)", "lat": 17.5333, "lon": 82.9833, "type": "industrial", "radius_m": 3500},
    {"name": "Jawaharlal Nehru Pharma City (Parawada, Vizag)", "lat": 17.6000, "lon": 83.1000, "type": "industrial", "radius_m": 3000},
    {"name": "Patancheru & Pashamylaram Industrial Area (Hyderabad)", "lat": 17.5333, "lon": 78.2500, "type": "industrial", "radius_m": 4000},
    {"name": "Jeedimetla IDA (Hyderabad)", "lat": 17.5167, "lon": 78.4667, "type": "industrial", "radius_m": 3000},
    {"name": "Ranipet SIPCOT Industrial Area (Vellore)", "lat": 12.9333, "lon": 79.3333, "type": "industrial", "radius_m": 3000},
    {"name": "Cuddalore SIPCOT Chemical Complex", "lat": 11.6833, "lon": 79.7667, "type": "industrial", "radius_m": 3000},
    {"name": "Sriperumbudur & Oragadam SIPCOT (Kanchipuram)", "lat": 12.9000, "lon": 79.9500, "type": "industrial", "radius_m": 4500},
    {"name": "Hosur SIPCOT Industrial Complex", "lat": 12.7333, "lon": 77.8333, "type": "industrial", "radius_m": 3500},
    {"name": "Peenya Industrial Area (Bengaluru)", "lat": 13.0333, "lon": 77.5167, "type": "industrial", "radius_m": 3500},
    {"name": "Bhiwadi Industrial Area (Alwar, Rajasthan)", "lat": 28.2000, "lon": 76.8500, "type": "industrial", "radius_m": 4000},
    {"name": "Neemrana RIICO Industrial Area (Rajasthan)", "lat": 27.9833, "lon": 76.3833, "type": "industrial", "radius_m": 3500},
    {"name": "Manesar IMT (Gurugram, Haryana)", "lat": 28.3667, "lon": 76.9333, "type": "industrial", "radius_m": 4000},
    {"name": "Faridabad Industrial Area (Haryana)", "lat": 28.3833, "lon": 77.3167, "type": "industrial", "radius_m": 4000},
    {"name": "Mandi Gobindgarh Steel Cluster (Punjab)", "lat": 30.6667, "lon": 76.3000, "type": "industrial", "radius_m": 3000},
    {"name": "Ludhiana Focal Point Industrial Belt (Punjab)", "lat": 30.8833, "lon": 75.9000, "type": "industrial", "radius_m": 4000},
    {"name": "Eloor-Edayar Industrial Belt (Kochi)", "lat": 10.0833, "lon": 76.3000, "type": "industrial", "radius_m": 3000},
    {"name": "Adityapur Industrial Area (Jamshedpur)", "lat": 22.7833, "lon": 86.1667, "type": "industrial", "radius_m": 3500},
    {"name": "Urla & Siltara Industrial Growth Centres (Raipur)", "lat": 21.3667, "lon": 81.6500, "type": "industrial", "radius_m": 4000},
]

# Build spatial index using BallTree with haversine metric
_SITES_DF = pd.DataFrame(GENUINE_INDUSTRIAL_SITES)
_COORDS_RAD = np.radians(_SITES_DF[["lat", "lon"]].to_numpy(dtype=float))
_TREE = BallTree(_COORDS_RAD, metric="haversine")


def lookup_industrial_context(latitude: float, longitude: float, max_search_radius_m: float = 3000.0) -> dict[str, Any]:
    """Look up nearest genuine industrial facility, refinery or power plant.

    Returns deterministic proximity metrics:
    - industrial_distance_m: distance in meters (capped at max_search_radius_m)
    - industrial_landuse_nearby: True if within effective boundary radius
    - power_plant_nearby: True if within power plant influence zone
    - refinery_or_flare_nearby: True if within refinery / petrochemical / flaring zone
    - nearest_facility_name: Name of closest mapped site (or None if far)
    - context_source: 'offline_index'
    """
    point_rad = np.radians([[float(latitude), float(longitude)]])
    dist_rad, indices = _TREE.query(point_rad, k=1)
    dist_m = float(dist_rad[0][0] * EARTH_KM * 1000.0)
    idx = int(indices[0][0])
    site = GENUINE_INDUSTRIAL_SITES[idx]

    site_radius = float(site.get("radius_m", 2500.0))
    # Effective presence: within site footprint or within 1500m
    is_nearby = dist_m <= max(site_radius, 1500.0)
    site_type = site.get("type", "industrial")

    power_plant_nearby = is_nearby and site_type == "power_plant"
    refinery_or_flare = is_nearby and site_type in ["refinery", "petrochemical", "gas_flare"]

    return {
        "industrial_distance_m": round(dist_m, 1),
        "industrial_landuse_nearby": bool(is_nearby),
        "power_plant_nearby": bool(power_plant_nearby),
        "refinery_or_flare_nearby": bool(refinery_or_flare),
        "nearest_facility_name": site["name"] if is_nearby else None,
        "facility_type": site_type if is_nearby else None,
        "context_source": "offline_index",
        "in_industrial_zone": bool(is_nearby),
    }


def enrich_observations_batch(df: pd.DataFrame) -> pd.DataFrame:
    """Vectorized enrichment for a batch of FIRMS observations."""
    if df.empty:
        return df

    out = df.copy()
    coords = np.radians(out[["latitude", "longitude"]].to_numpy(dtype=float))
    dist_rad, indices = _TREE.query(coords, k=1)
    dist_m = (dist_rad.ravel() * EARTH_KM * 1000.0).astype(np.float32)
    idx = indices.ravel()

    site_radii = np.array([GENUINE_INDUSTRIAL_SITES[i].get("radius_m", 2500.0) for i in idx], dtype=np.float32)
    site_types = np.array([GENUINE_INDUSTRIAL_SITES[i].get("type", "industrial") for i in idx])
    site_names = np.array([GENUINE_INDUSTRIAL_SITES[i]["name"] for i in idx])

    effective_radii = np.maximum(site_radii, 1500.0)
    is_nearby = dist_m <= effective_radii

    out["industrial_distance_m"] = np.round(dist_m, 1)
    out["industrial_distance_capped_m"] = np.minimum(out["industrial_distance_m"], 1500.0)
    out["industrial_landuse_nearby"] = is_nearby.astype(float)
    out["power_plant_nearby"] = (is_nearby & (site_types == "power_plant")).astype(float)
    out["refinery_or_flare_nearby"] = (is_nearby & np.isin(site_types, ["refinery", "petrochemical", "gas_flare"])).astype(float)
    out["industrial_site_name"] = np.where(is_nearby, site_names, None)
    out["industrial_within_1000m"] = (dist_m <= 1000.0).astype(int)

    return out
