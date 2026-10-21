/**
 * The office geofence — may this check-in or check-out be made from here?
 *
 * Pure: no database, no HTTP, no clock. The fence is passed in by the service
 * (built from env in the container) and the fix comes from the browser.
 *
 * WHO IT APPLIES TO
 *
 *   Only `work_mode = 'WFO'`. WFH and Hybrid punch from anywhere. An admin
 *   punching on someone's behalf is not fenced either — that is a correction,
 *   not the employee standing somewhere.
 *
 * WHAT IT CAN AND CANNOT PROVE
 *
 *   The coordinates are whatever the browser reports, and a browser can be told
 *   to report anything. This stops casual punching from home; it is not proof
 *   of presence. The fix is written to the audit log so HR can look back.
 */

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** What the browser's Geolocation API reported. `accuracyM` is its ± radius. */
export interface DeviceFix extends GeoPoint {
  accuracyM: number;
}

export interface Geofence extends GeoPoint {
  radiusM: number;
  /**
   * A fix vaguer than this is refused as "not precise enough" rather than
   * "outside". A laptop indoors can report ±150 m while sitting at its desk, and
   * telling that person they are outside the office would be wrong.
   */
  maxAccuracyM: number;
}

export type GeofenceVerdict =
  | { allowed: true; distanceM: number }
  | {
      allowed: false;
      reason: 'missing' | 'inaccurate' | 'outside';
      distanceM: number | null;
      message: string;
    };

const EARTH_RADIUS_M = 6_371_000;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Great-circle distance in metres (haversine). Plenty precise at 50 m. */
export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * `{ location: { lat, lng, accuracy } }` from a punch request body — the shape
 * the browser's Geolocation API gives. Anything malformed reads as no fix at
 * all, which judgeFix() refuses for WFO and nobody else ever looks at.
 */
export function parseDeviceFix(body: unknown): DeviceFix | null {
  const location = (body as { location?: Record<string, unknown> } | null | undefined)?.location;
  if (!location || typeof location !== 'object') return null;
  const lat = Number(location.lat);
  const lng = Number(location.lng);
  const accuracyM = Number(location.accuracy);
  const valid =
    Number.isFinite(lat) &&
    Math.abs(lat) <= 90 &&
    Number.isFinite(lng) &&
    Math.abs(lng) <= 180 &&
    Number.isFinite(accuracyM) &&
    accuracyM >= 0;
  return valid ? { lat, lng, accuracyM } : null;
}

/** The one rule for who is fenced. Exact match: 'WFO' is how the column stores it. */
export const requiresGeofence = (workMode: string | null | undefined): boolean =>
  workMode === 'WFO';

/** Rounded for messages — "43 m", "1.2 km". */
export function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

/**
 * The verdict for one fix. Order matters: no fix, then a fix too vague to
 * judge, then the distance itself.
 */
export function judgeFix(fix: DeviceFix | null, fence: Geofence): GeofenceVerdict {
  if (!fix) {
    return {
      allowed: false,
      reason: 'missing',
      distanceM: null,
      message:
        'Your location is needed to check in or out from the office. Allow location access for this site and try again.',
    };
  }

  const distanceM = distanceMeters(fix, fence);

  if (fix.accuracyM > fence.maxAccuracyM) {
    return {
      allowed: false,
      reason: 'inaccurate',
      distanceM,
      message: `Your location is not precise enough (±${Math.round(fix.accuracyM)} m). Turn on Wi-Fi or location services, or check in from your phone.`,
    };
  }

  if (distanceM > fence.radiusM) {
    return {
      allowed: false,
      reason: 'outside',
      distanceM,
      message: `You are ${formatDistance(distanceM)} from the office. Check-in and check-out are only allowed within ${fence.radiusM} m of the office.`,
    };
  }

  return { allowed: true, distanceM };
}
