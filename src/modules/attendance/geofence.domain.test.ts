import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  distanceMeters,
  formatDistance,
  isValidPoint,
  judgeFix,
  needsHomeLocation,
  parseDeviceFix,
  policyFor,
  type GeofenceConfig,
  type GeofencePolicy,
  type GeoPoint,
} from './geofence.domain';

const CONFIG: GeofenceConfig = {
  office: { lat: 12.9005, lng: 77.6508, radiusM: 100 },
  homeRadiusM: 100,
  // No hidden margin in these tests, so the edges below are the stated radius.
  graceM: 0,
  maxAccuracyM: 100,
};
const OFFICE: GeoPoint = CONFIG.office;
// About 5 km from the office — a plausible home.
const HOME: GeoPoint = { lat: 12.9455, lng: 77.6508 };

// 0.0001° of latitude is ~11.1 m anywhere on Earth.
const north = (from: GeoPoint, meters: number) => ({
  lat: from.lat + (meters / 11.1) * 0.0001,
  lng: from.lng,
});

const officeOnly = policyFor('WFO', null, CONFIG)!;
const officeAndHome = policyFor('WFO', HOME, CONFIG)!;
const homeOnly = policyFor('WFH', HOME, CONFIG)!;

describe('distanceMeters', () => {
  it('is zero at the point itself', () => {
    assert.equal(distanceMeters(OFFICE, OFFICE), 0);
  });

  it('measures ~111 m for 0.001° of latitude', () => {
    const d = distanceMeters(OFFICE, { lat: OFFICE.lat + 0.001, lng: OFFICE.lng });
    assert.ok(Math.abs(d - 111.2) < 1, `got ${d}`);
  });

  it('is symmetric', () => {
    assert.equal(Math.round(distanceMeters(OFFICE, HOME)), Math.round(distanceMeters(HOME, OFFICE)));
  });
});

describe('policyFor', () => {
  it('fences WFO to the office alone until a home location is saved', () => {
    assert.deepEqual(officeOnly.zones.map((z) => z.kind), ['office']);
  });

  it('fences WFO to the office OR home once it is saved', () => {
    assert.deepEqual(officeAndHome.zones.map((z) => z.kind), ['office', 'home']);
  });

  it('fences WFH to home only', () => {
    assert.deepEqual(homeOnly.zones.map((z) => z.kind), ['home']);
  });

  it('blocks WFH everywhere until a home location is saved', () => {
    const noHome = policyFor('WFH', null, CONFIG)!;
    assert.equal(noHome.homeMissing, true);
    assert.deepEqual(noHome.zones, []);
    // Refused even with a perfect fix at the office — no location can fix it.
    const verdict = judgeFix({ ...OFFICE, accuracyM: 5 }, noHome);
    assert.equal(verdict.allowed === false && verdict.reason, 'no_home');
    assert.equal(judgeFix(null, noHome).allowed, false);
  });

  it('does not block WFO without a home location — the office still counts', () => {
    assert.equal(policyFor('WFO', null, CONFIG)!.homeMissing, undefined);
  });

  it('never fences Hybrid or an unknown mode', () => {
    assert.equal(policyFor('Hybrid', HOME, CONFIG), null);
    assert.equal(policyFor(null, HOME, CONFIG), null);
  });

  it('gives the home zone its own radius', () => {
    const p = policyFor('WFH', HOME, { ...CONFIG, homeRadiusM: 150 })!;
    assert.equal(p.zones[0].radiusM, 150);
  });
});

describe('second location', () => {
  // ~3 km north of the office — somewhere other than home or office.
  const SECOND: GeoPoint = { lat: 12.9275, lng: 77.6508 };

  it('adds a third place for WFO and a second for WFH', () => {
    assert.deepEqual(policyFor('WFO', HOME, CONFIG, SECOND)!.zones.map((z) => z.kind), [
      'office',
      'home',
      'second',
    ]);
    assert.deepEqual(policyFor('WFH', HOME, CONFIG, SECOND)!.zones.map((z) => z.kind), ['home', 'second']);
  });

  it('allows a punch at the second location', () => {
    const verdict = judgeFix({ ...north(SECOND, 20), accuracyM: 10 }, policyFor('WFH', HOME, CONFIG, SECOND)!);
    assert.deepEqual(verdict.allowed && verdict.zone, 'second');
  });

  it('lets WFH punch at the second location while home is on but unsaved', () => {
    assert.deepEqual(policyFor('WFH', null, CONFIG, SECOND)!.zones.map((z) => z.kind), ['second']);
  });

  it('is ignored for Hybrid', () => {
    assert.equal(policyFor('Hybrid', HOME, CONFIG, SECOND), null);
  });

  it('names it in the message', () => {
    const verdict = judgeFix({ ...north(SECOND, 400), accuracyM: 10 }, policyFor('WFH', HOME, CONFIG, SECOND)!);
    assert.match(verdict.allowed === false ? verdict.message : '', /your home location or your second location/);
  });
});

describe('home switch', () => {
  const SECOND: GeoPoint = { lat: 12.9275, lng: 77.6508 };

  it('drops a switched-off home from the places', () => {
    assert.deepEqual(policyFor('WFH', HOME, CONFIG, SECOND, false)!.zones.map((z) => z.kind), ['second']);
  });

  it('turns location checks off for WFH when both places are off', () => {
    assert.equal(policyFor('WFH', HOME, CONFIG, null, false), null);
  });

  it('keeps the office for WFO when both places are off', () => {
    assert.deepEqual(policyFor('WFO', HOME, CONFIG, null, false)!.zones.map((z) => z.kind), ['office']);
  });
});

describe('needsHomeLocation', () => {
  it('asks WFO and WFH, not Hybrid', () => {
    assert.equal(needsHomeLocation('WFO'), true);
    assert.equal(needsHomeLocation('WFH'), true);
    assert.equal(needsHomeLocation('Hybrid'), false);
  });
});

describe('judgeFix', () => {
  it('allows a fix inside the office', () => {
    const verdict = judgeFix({ ...north(OFFICE, 30), accuracyM: 15 }, officeOnly);
    assert.deepEqual(verdict.allowed && verdict.zone, 'office');
  });

  it('allows a WFO employee at home once home is saved', () => {
    const verdict = judgeFix({ ...north(HOME, 20), accuracyM: 10 }, officeAndHome);
    assert.deepEqual(verdict.allowed && verdict.zone, 'home');
  });

  it('refuses the same spot for WFO before home is saved', () => {
    assert.equal(judgeFix({ ...north(HOME, 20), accuracyM: 10 }, officeOnly).allowed, false);
  });

  it('refuses a WFH employee at the office — the office is not their zone', () => {
    assert.equal(judgeFix({ ...OFFICE, accuracyM: 10 }, homeOnly).allowed, false);
  });

  it('allows a fix right at the edge', () => {
    assert.equal(judgeFix({ ...north(OFFICE, 99), accuracyM: 10 }, officeOnly).allowed, true);
  });

  it('refuses outside every zone and names the nearest one', () => {
    const verdict = judgeFix({ ...north(HOME, 400), accuracyM: 10 }, officeAndHome);
    assert.equal(verdict.allowed, false);
    const message = verdict.allowed === false ? verdict.message : '';
    assert.match(message, /You are 4\d\d m from your home location/);
    assert.match(message, /within 100 m of the office or your home location/);
  });

  it('is allowed by a containing zone even when another zone is nearer', () => {
    // A tiny home circle right next to the device, inside a large office circle.
    const policy: GeofencePolicy = {
      maxAccuracyM: 100,
      zones: [
        { kind: 'office', ...OFFICE, radiusM: 500, graceM: 0 },
        { kind: 'home', ...north(OFFICE, 60), radiusM: 5, graceM: 0 },
      ],
    };
    const verdict = judgeFix({ ...north(OFFICE, 40), accuracyM: 10 }, policy);
    assert.deepEqual(verdict.allowed && verdict.zone, 'office');
  });

  it('refuses a missing fix', () => {
    const verdict = judgeFix(null, officeOnly);
    assert.equal(verdict.allowed === false && verdict.reason, 'missing');
  });

  it('calls a vague fix inaccurate, not outside — even when it lands inside', () => {
    const verdict = judgeFix({ ...north(OFFICE, 10), accuracyM: 150 }, officeOnly);
    assert.equal(verdict.allowed === false && verdict.reason, 'inaccurate');
  });

  it('accepts accuracy exactly at the limit', () => {
    assert.equal(judgeFix({ ...north(OFFICE, 10), accuracyM: 100 }, officeOnly).allowed, true);
  });
});

describe('hidden grace margin', () => {
  // Stated 100 m, decided at 100 + 100 = 200 m.
  const graced = policyFor('WFO', HOME, { ...CONFIG, graceM: 100 })!;

  it('allows a device beyond the stated radius but within the margin', () => {
    const verdict = judgeFix({ ...north(OFFICE, 180), accuracyM: 10 }, graced);
    assert.deepEqual(verdict.allowed && verdict.zone, 'office');
  });

  it('gives home the same margin', () => {
    assert.equal(judgeFix({ ...north(HOME, 180), accuracyM: 10 }, graced).allowed, true);
  });

  it('still refuses past radius + margin', () => {
    assert.equal(judgeFix({ ...north(OFFICE, 230), accuracyM: 10 }, graced).allowed, false);
  });

  it('never mentions the margin — the message states the stated radius', () => {
    const verdict = judgeFix({ ...north(OFFICE, 400), accuracyM: 10 }, graced);
    const message = verdict.allowed === false ? verdict.message : '';
    assert.match(message, /within 100 m of/);
    assert.doesNotMatch(message, /200 m/);
  });
});

describe('parseDeviceFix', () => {
  it('reads the browser shape', () => {
    assert.deepEqual(parseDeviceFix({ location: { lat: 12.91, lng: 77.64, accuracy: 18 } }), {
      lat: 12.91,
      lng: 77.64,
      accuracyM: 18,
    });
  });

  it('reads anything malformed as no fix', () => {
    assert.equal(parseDeviceFix(undefined), null);
    assert.equal(parseDeviceFix({}), null);
    assert.equal(parseDeviceFix({ location: { lat: 'x', lng: 77, accuracy: 5 } }), null);
    assert.equal(parseDeviceFix({ location: { lat: 95, lng: 77, accuracy: 5 } }), null);
    assert.equal(parseDeviceFix({ location: { lat: 12, lng: 77 } }), null);
  });
});

describe('isValidPoint', () => {
  it('accepts the planet and nothing else', () => {
    assert.equal(isValidPoint({ lat: 12.9, lng: 77.6 }), true);
    assert.equal(isValidPoint({ lat: 91, lng: 0 }), false);
    assert.equal(isValidPoint({ lat: 0, lng: -181 }), false);
    assert.equal(isValidPoint({ lat: Number.NaN, lng: 0 }), false);
  });
});

describe('formatDistance', () => {
  it('uses metres below a kilometre and km above', () => {
    assert.equal(formatDistance(43.4), '43 m');
    assert.equal(formatDistance(1234), '1.2 km');
  });
});
