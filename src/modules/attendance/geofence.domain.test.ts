import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  distanceMeters,
  formatDistance,
  judgeFix,
  parseDeviceFix,
  requiresGeofence,
  type Geofence,
} from './geofence.domain';

const OFFICE: Geofence = { lat: 12.9105, lng: 77.6482, radiusM: 50, maxAccuracyM: 100 };

// 0.0001° of latitude is ~11.1 m anywhere on Earth.
const north = (meters: number) => ({ lat: OFFICE.lat + (meters / 11.1) * 0.0001, lng: OFFICE.lng });

describe('distanceMeters', () => {
  it('is zero at the office itself', () => {
    assert.equal(distanceMeters(OFFICE, OFFICE), 0);
  });

  it('measures ~111 m for 0.001° of latitude', () => {
    const d = distanceMeters(OFFICE, { lat: OFFICE.lat + 0.001, lng: OFFICE.lng });
    assert.ok(Math.abs(d - 111.2) < 1, `got ${d}`);
  });

  it('is symmetric', () => {
    const p = { lat: 12.92, lng: 77.64 };
    assert.equal(Math.round(distanceMeters(OFFICE, p)), Math.round(distanceMeters(p, OFFICE)));
  });
});

describe('requiresGeofence', () => {
  it('fences WFO only', () => {
    assert.equal(requiresGeofence('WFO'), true);
    assert.equal(requiresGeofence('WFH'), false);
    assert.equal(requiresGeofence('Hybrid'), false);
    assert.equal(requiresGeofence(null), false);
  });
});

describe('judgeFix', () => {
  it('allows a fix inside the radius', () => {
    const verdict = judgeFix({ ...north(30), accuracyM: 15 }, OFFICE);
    assert.equal(verdict.allowed, true);
  });

  it('allows a fix right at the edge', () => {
    assert.equal(judgeFix({ ...north(49), accuracyM: 10 }, OFFICE).allowed, true);
  });

  it('refuses a fix outside the radius and says how far', () => {
    const verdict = judgeFix({ ...north(340), accuracyM: 10 }, OFFICE);
    assert.equal(verdict.allowed, false);
    assert.equal(verdict.allowed === false && verdict.reason, 'outside');
    assert.match(verdict.allowed === false ? verdict.message : '', /You are 3[34]\d m from the office/);
  });

  it('refuses a missing fix', () => {
    const verdict = judgeFix(null, OFFICE);
    assert.equal(verdict.allowed === false && verdict.reason, 'missing');
  });

  it('calls a vague fix inaccurate, not outside — even when it lands inside', () => {
    const verdict = judgeFix({ ...north(10), accuracyM: 150 }, OFFICE);
    assert.equal(verdict.allowed === false && verdict.reason, 'inaccurate');
  });

  it('accepts accuracy exactly at the limit', () => {
    assert.equal(judgeFix({ ...north(10), accuracyM: 100 }, OFFICE).allowed, true);
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

describe('formatDistance', () => {
  it('uses metres below a kilometre and km above', () => {
    assert.equal(formatDistance(43.4), '43 m');
    assert.equal(formatDistance(1234), '1.2 km');
  });
});
