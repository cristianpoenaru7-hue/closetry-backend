const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveSeasonFromMonth } = require('../src/controllers/weather.controller');

test('deriveSeasonFromMonth maps each month to the expected Northern-hemisphere season', () => {
  assert.equal(deriveSeasonFromMonth(new Date(2026, 0, 15)), 'winter'); // Jan
  assert.equal(deriveSeasonFromMonth(new Date(2026, 1, 15)), 'winter'); // Feb
  assert.equal(deriveSeasonFromMonth(new Date(2026, 2, 15)), 'spring'); // Mar
  assert.equal(deriveSeasonFromMonth(new Date(2026, 4, 15)), 'spring'); // May
  assert.equal(deriveSeasonFromMonth(new Date(2026, 5, 15)), 'summer'); // Jun
  assert.equal(deriveSeasonFromMonth(new Date(2026, 7, 15)), 'summer'); // Aug
  assert.equal(deriveSeasonFromMonth(new Date(2026, 8, 15)), 'fall');   // Sep
  assert.equal(deriveSeasonFromMonth(new Date(2026, 10, 15)), 'fall');  // Nov
  assert.equal(deriveSeasonFromMonth(new Date(2026, 11, 15)), 'winter'); // Dec
});
