const test = require('node:test');
const assert = require('node:assert/strict');

// Loading the controller pulls in the Prisma client, which does not connect until first use.
const { toWeatherSnapshot } = require('../src/controllers/events.controller');

test('event weather snapshot keeps conditions only, never the place name', () => {
  const snap = toWeatherSnapshot({ tempC: 12.5, condition: 'Rain', description: 'light rain', locationName: 'Springfield' });
  assert.deepEqual(snap, { tempC: 12.5, condition: 'Rain', description: 'light rain' });
  assert.ok(!('locationName' in snap));
});
