/**
 * EXIF parser — read GPS + Theodolite custom tags from uploaded photos.
 *
 * The Theodolite app for iOS stamps photos with full EXIF GPS plus
 * the custom angle data in the ImageDescription tag. We parse:
 *   • GPSLatitude / GPSLongitude         → decimal degrees
 *   • GPSAltitude                         → metres above sea level
 *   • GPSImgDirection (T or M)            → camera bearing in degrees
 *   • GPSHPositioningError                → accuracy in metres (when present)
 *   • GPSMapDatum                         → "WGS-84" almost always
 *   • DateTimeOriginal                    → capture timestamp
 *   • Software                            → e.g. "Theodolite App - ..."
 *   • ImageDescription "vert_angle_deg=X.X / horiz_angle_deg=Y.Y"
 *                                         → device pitch / roll
 *   • FocalLength + FocalLengthIn35mmFilm → for FOV calc later
 *
 * Tested against a real Theodolite photo from Pink Mountain BC —
 * full chain of metadata survives even after iMessage transit.
 *
 * Confidence scoring (drives downstream trust + the "Theodolite-verified"
 * pill in the UI):
 *   • Theodolite + WGS-84 + bearing + |pitch|<5° + |roll|<5°  → 0.98
 *   • Theodolite + WGS-84 + bearing                             → 0.95
 *   • iPhone stock + GPS + bearing                              → 0.85
 *   • iPhone stock + GPS only                                   → 0.75
 *   • No GPS                                                    → 0.30 (manual entry needed)
 */

import exifr from "exifr";

export interface ParsedExif {
  // Location
  lat: number | null;
  lng: number | null;
  altitude_m: number | null;
  bearing_deg: number | null;
  bearing_ref: "T" | "M" | null;       // True or Magnetic
  gps_accuracy_m: number | null;
  gps_datum: string | null;             // "WGS-84"

  // Device orientation (Theodolite custom)
  pitch_deg: number | null;
  roll_deg: number | null;

  // Provenance
  captured_at: string | null;           // ISO timestamp
  software_app: string | null;          // "Theodolite App - ..." etc.
  is_theodolite: boolean;
  device_make: string | null;
  device_model: string | null;

  // Lens
  focal_length_mm: number | null;
  focal_length_35mm_eq: number | null;

  // Computed
  confidence: number;                   // 0–1
  raw: Record<string, unknown>;         // full EXIF dump for archival
}

export async function parsePhotoExif(file: File | Blob): Promise<ParsedExif> {
  let raw: Record<string, unknown> = {};
  try {
    raw = (await exifr.parse(file, { gps: true, exif: true, ifd0: true, mergeOutput: true })) as Record<string, unknown> ?? {};
  } catch {
    // Some files lack any parseable EXIF (PNGs, screenshots, etc.).
    // Return all-nulls + low confidence rather than throwing.
    return emptyParsed();
  }

  const lat = numberOrNull(raw.latitude ?? raw.GPSLatitude);
  const lng = numberOrNull(raw.longitude ?? raw.GPSLongitude);
  const altitude_m = numberOrNull(raw.GPSAltitude ?? raw.altitude);
  const bearing_deg = numberOrNull(raw.GPSImgDirection);
  const bearing_ref = (raw.GPSImgDirectionRef === "M" ? "M" : raw.GPSImgDirectionRef === "T" ? "T" : null);
  const gps_accuracy_m = numberOrNull(raw.GPSHPositioningError);
  const gps_datum = stringOrNull(raw.GPSMapDatum);

  const captured_at = parseExifDate(raw.DateTimeOriginal ?? raw.CreateDate);
  const software_app = stringOrNull(raw.Software);
  const is_theodolite = !!software_app && /theodolite/i.test(software_app);
  const device_make = stringOrNull(raw.Make);
  const device_model = stringOrNull(raw.Model);

  const focal_length_mm = numberOrNull(raw.FocalLength);
  const focal_length_35mm_eq = numberOrNull(raw.FocalLengthIn35mmFilm ?? raw.FocalLengthIn35mmFormat);

  // Theodolite stamps pitch/roll in ImageDescription:
  // "vert_angle_deg=-2.3 / horiz_angle_deg=-0.5"
  let pitch_deg: number | null = null;
  let roll_deg: number | null = null;
  const desc = stringOrNull(raw.ImageDescription);
  if (desc) {
    const vMatch = desc.match(/vert_angle_deg=(-?\d+(\.\d+)?)/);
    const hMatch = desc.match(/horiz_angle_deg=(-?\d+(\.\d+)?)/);
    if (vMatch) pitch_deg = parseFloat(vMatch[1]);
    if (hMatch) roll_deg = parseFloat(hMatch[1]);
  }

  // Confidence model — see header.
  let confidence = 0.30;
  if (lat !== null && lng !== null) {
    if (is_theodolite && bearing_deg !== null && (gps_datum?.includes("WGS") ?? true)) {
      const levelEnough =
        (pitch_deg === null || Math.abs(pitch_deg) < 5) &&
        (roll_deg === null || Math.abs(roll_deg) < 5);
      confidence = levelEnough ? 0.98 : 0.95;
    } else if (bearing_deg !== null) {
      confidence = 0.85;
    } else {
      confidence = 0.75;
    }
  }

  return {
    lat, lng, altitude_m, bearing_deg, bearing_ref,
    gps_accuracy_m, gps_datum,
    pitch_deg, roll_deg,
    captured_at, software_app, is_theodolite,
    device_make, device_model,
    focal_length_mm, focal_length_35mm_eq,
    confidence, raw,
  };
}

function numberOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function stringOrNull(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

function parseExifDate(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") {
    // EXIF format: "2026:05:10 12:56:10"
    const cleaned = v.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3");
    const d = new Date(cleaned);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

function emptyParsed(): ParsedExif {
  return {
    lat: null, lng: null, altitude_m: null, bearing_deg: null, bearing_ref: null,
    gps_accuracy_m: null, gps_datum: null,
    pitch_deg: null, roll_deg: null,
    captured_at: null, software_app: null, is_theodolite: false,
    device_make: null, device_model: null,
    focal_length_mm: null, focal_length_35mm_eq: null,
    confidence: 0.30, raw: {},
  };
}

/**
 * Format a confidence score as a human label for the UI pill.
 */
export function confidenceLabel(c: number, isTheodolite: boolean): string {
  if (isTheodolite && c >= 0.95) return "🎯 Theodolite-verified";
  if (c >= 0.85) return "📍 GPS-verified";
  if (c >= 0.7) return "📍 GPS";
  return "✏️ Manual";
}
