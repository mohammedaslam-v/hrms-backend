/**
 * The attendance geofence — may this check-in or check-out be made from here?
 *
 * Pure: no database, no HTTP, no clock. The office comes from env (via the
 * container), the home point from `hrms_employees`, and the fix from the browser.
 *
 * WHO IS FENCED, AND WHERE (policyFor)
 *
 *   WFO     the office, OR their saved home location once they have one
 *   WFH     their saved home location — and until it is saved, nowhere: the
 *           policy has no zones and `homeMissing`, so every punch is refused
 *           with "save your home location first"
 *   Hybrid  not fenced
 *
 *   Each of the two places (home, second) has an admin on/off switch and counts
 *   only while it is on and saved:
 *
 *     WFO  the office always, plus whichever places are on
 *     WFH  whichever places are on. Home on but not saved yet → blocked until
 *          it is saved. Both off → no location check at all for this person.
 *
 *   An admin punching on someone's behalf is never fenced — that is a
 *   correction, not the employee standing somewhere.
 *
 * THE ALGORITHM (judgeFix)
 *
 *   1. No fix                → refuse ("allow location access").
 *   2. Fix vaguer than ±maxAccuracyM → refuse ("not precise enough"). Judged
 *      before distance, so a vague laptop is never told it is "outside".
 *   3. Haversine distance from the fix to EVERY zone; keep the nearest
 *      (a linear scan — there are at most two zones, so O(k) with k ≤ 2).
 *   4. Allowed if the device is inside ANY zone, i.e. inside the nearest one's
 *      radius or any other's. Zones have their own radius, so "nearest" alone
 *      is not enough — a small home circle can be nearer than a large office
 *      one that still contains the device. So: allowed = some zone contains it.
 *   5. "Inside" means within radiusM + graceM. The grace is a hidden margin for
 *      GPS drift; every message states radiusM alone.
 *
 * WHAT IT CAN AND CANNOT PROVE
 *
 *   The coordinates are whatever the browser reports, and a browser can be told
 *   to report anything. This stops casual punching from elsewhere; it is not
 *   proof of presence. Every fix is written to the audit log so HR can look back.
 */

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** What the browser's Geolocation API reported. `accuracyM` is its ± radius. */
export interface DeviceFix extends GeoPoint {
  accuracyM: number;
}

export type ZoneKind = 'office' | 'home' | 'second';

/** One allowed place: a circle on the map. */
export interface GeofenceZone extends GeoPoint {
  kind: ZoneKind;
  /** The radius people are told about — every message says this number. */
  radiusM: number;
  /**
   * Extra metres allowed on top of `radiusM` but never shown. GPS readings
   * drift by tens of metres from one second to the next, so someone standing
   * inside the stated radius would otherwise flicker between allowed and not.
   * The decision uses radiusM + graceM; the words use radiusM.
   */
  graceM: number;
}

/** Every place this person may punch from. Sent to the browser as is. */
export interface GeofencePolicy {
  zones: GeofenceZone[];
  /**
   * A fix vaguer than this is refused as "not precise enough" rather than
   * "outside". A laptop indoors can report ±150 m while sitting at its desk, and
   * telling that person they are outside would be wrong.
   */
  maxAccuracyM: number;
  /**
   * WFH with no saved home location: there is nowhere they may punch yet.
   * `zones` is empty and every punch is refused until they save one.
   */
  homeMissing?: boolean;
}

/** The company-wide settings, from env. */
export interface GeofenceConfig {
  office: GeoPoint & { radiusM: number };
  homeRadiusM: number;
  /** Hidden margin added to every zone's radius — see GeofenceZone.graceM. */
  graceM: number;
  maxAccuracyM: number;
}

/** The radius that actually decides: the stated one plus the hidden margin. */
export const effectiveRadius = (zone: GeofenceZone): number => zone.radiusM + zone.graceM;

export type GeofenceVerdict =
  | { allowed: true; zone: ZoneKind; distanceM: number }
  | {
      allowed: false;
      reason: 'no_home' | 'missing' | 'inaccurate' | 'outside';
      distanceM: number | null;
      message: string;
    };

const EARTH_RADIUS_M = 6_371_000;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Great-circle distance in metres (haversine).
 *
 * The Earth is a sphere, so the straight-line formula on raw degrees is wrong:
 * a degree of longitude shrinks towards the poles (111 km at the equator,
 * ~108 km at Bengaluru). Haversine measures along the surface and is stable
 * for tiny distances, which is exactly the range a geofence works in.
 */
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
 * all, which judgeFix() refuses for the fenced and nobody else ever looks at.
 */
export function parseDeviceFix(body: unknown): DeviceFix | null {
  const location = (body as { location?: Record<string, unknown> } | null | undefined)?.location;
  if (!location || typeof location !== 'object') return null;
  const lat = Number(location.lat);
  const lng = Number(location.lng);
  const accuracyM = Number(location.accuracy);
  const valid = isValidPoint({ lat, lng }) && Number.isFinite(accuracyM) && accuracyM >= 0;
  return valid ? { lat, lng, accuracyM } : null;
}

/** On the planet: latitude ±90, longitude ±180, both real numbers. */
export const isValidPoint = (p: GeoPoint): boolean =>
  Number.isFinite(p.lat) && Math.abs(p.lat) <= 90 && Number.isFinite(p.lng) && Math.abs(p.lng) <= 180;

/**
 * Where this person may punch from, or null when they may punch anywhere.
 * The one rule for who is fenced — see the table at the top of this file.
 */
export function policyFor(
  workMode: string | null | undefined,
  home: GeoPoint | null,
  config: GeofenceConfig,
  /** Only when an admin has switched it on AND it is saved — else null. */
  second: GeoPoint | null = null,
  /** The admin's switch for home. Off: the saved home point does not count. */
  homeEnabled = true,
): GeofencePolicy | null {
  // Home and second share the home radius: both are places a person lives or
  // works from, not a building the size of a tech park.
  const zoneAt = (kind: ZoneKind, p: GeoPoint | null): GeofenceZone[] =>
    p ? [{ kind, lat: p.lat, lng: p.lng, radiusM: config.homeRadiusM, graceM: config.graceM }] : [];

  const places = [...(homeEnabled ? zoneAt('home', home) : []), ...zoneAt('second', second)];

  let zones: GeofenceZone[];
  if (workMode === 'WFO') {
    zones = [{ kind: 'office', ...config.office, graceM: config.graceM }, ...places];
  } else if (workMode === 'WFH') {
    if (places.length === 0) {
      // Home switched on but never saved: blocked until it is. Both switched
      // off: HR has turned location checks off for this person.
      return homeEnabled ? { zones: [], maxAccuracyM: config.maxAccuracyM, homeMissing: true } : null;
    }
    zones = places;
  } else {
    return null;
  }

  return { zones, maxAccuracyM: config.maxAccuracyM };
}

/** Does this work mode need a saved home location? Drives the reminder. */
export const needsHomeLocation = (workMode: string | null | undefined): boolean =>
  workMode === 'WFO' || workMode === 'WFH';

/** Rounded for messages — "43 m", "1.2 km". */
export function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

export const HOME_MISSING_MESSAGE =
  'Save your home location before checking in or out: My page → Edit personal details → Home location.';

const PLACE: Record<ZoneKind, string> = {
  office: 'the office',
  home: 'your home location',
  second: 'your second location',
};

/** "the office", "your home location", "the office or your home location". */
const placesOf = (zones: GeofenceZone[]): string => zones.map((z) => PLACE[z.kind]).join(' or ');

/**
 * The verdict for one fix. Order matters: no fix, then a fix too vague to
 * judge, then the distances.
 */
export function judgeFix(fix: DeviceFix | null, policy: GeofencePolicy): GeofenceVerdict {
  // Nowhere to punch from yet — checked first, since no location can fix it.
  if (policy.zones.length === 0) {
    return {
      allowed: false,
      reason: 'no_home',
      distanceM: null,
      message: HOME_MISSING_MESSAGE,
    };
  }

  if (!fix) {
    return {
      allowed: false,
      reason: 'missing',
      distanceM: null,
      message: `Your location is needed to check in or out from ${placesOf(policy.zones)}. Allow location access for this site and try again.`,
    };
  }

  // One pass over the zones: remember the first one that contains the device,
  // and the nearest one overall for the message if none does.
  let inside: { zone: GeofenceZone; distanceM: number } | null = null;
  let nearest: { zone: GeofenceZone; distanceM: number } | null = null;
  for (const zone of policy.zones) {
    const distanceM = distanceMeters(fix, zone);
    if (!nearest || distanceM < nearest.distanceM) nearest = { zone, distanceM };
    if (!inside && distanceM <= effectiveRadius(zone)) inside = { zone, distanceM };
  }

  if (fix.accuracyM > policy.maxAccuracyM) {
    return {
      allowed: false,
      reason: 'inaccurate',
      distanceM: nearest?.distanceM ?? null,
      message: `Your location is not precise enough (±${Math.round(fix.accuracyM)} m). Turn on Wi-Fi or location services, or check in from your phone.`,
    };
  }

  if (inside) return { allowed: true, zone: inside.zone.kind, distanceM: inside.distanceM };

  const radii = [...new Set(policy.zones.map((z) => z.radiusM))];
  return {
    allowed: false,
    reason: 'outside',
    distanceM: nearest?.distanceM ?? null,
    message:
      `You are ${formatDistance(nearest!.distanceM)} from ${PLACE[nearest!.zone.kind]}. ` +
      `Check-in and check-out are only allowed within ${radii.join('/')} m of ${placesOf(policy.zones)}.`,
  };
}
