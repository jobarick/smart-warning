// The next 12 hours of weather, public since 2026-10-07 (the landing page
// shows them to every visitor; the 3 day forecast stays a paid feature).
//
// Run with: npm test   (from server/)
const { test } = require('node:test');
const assert = require('node:assert');

// A fresh weather.js for each test: it keeps a module level cache keyed by
// position, which would otherwise hand the second test the first one's data.
function freshWeather() {
  delete process.env.WEATHER_PROVIDER;
  delete require.cache[require.resolve('../weather')];
  return require('../weather');
}

function openMeteoReply({ hourlyRain = [10, 10, 10], hourlyWind = [5, 5, 5], hourlyTemp = [28, 29, 30] } = {}) {
  const n = hourlyRain.length;
  return {
    current: { temperature_2m: 28, weather_code: 3, wind_speed_10m: 5, precipitation: 0 },
    daily: {
      time: ['2026-10-07', '2026-10-08', '2026-10-09'],
      weather_code: [3, 3, 3],
      temperature_2m_max: [31, 31, 31],
      temperature_2m_min: [24, 24, 24],
      precipitation_probability_max: [10, 10, 10],
    },
    hourly: {
      time: Array.from({ length: n }, (_, i) => `2026-10-07T${String(11 + i).padStart(2, '0')}:00`),
      temperature_2m: hourlyTemp,
      precipitation_probability: hourlyRain,
      weather_code: Array(n).fill(3),
      wind_speed_10m: hourlyWind,
    },
  };
}

async function withFetch(reply, fn) {
  const real = global.fetch;
  const seen = [];
  global.fetch = async (url) => {
    seen.push(String(url));
    return { ok: true, json: async () => reply };
  };
  try { return await fn(seen); } finally { global.fetch = real; }
}

test('asks Open-Meteo for the next 12 hours and returns them in local time', async () => {
  const weather = freshWeather();
  await withFetch(openMeteoReply(), async (seen) => {
    const r = await weather.getWeather({ lat: -6.79, lng: 39.21 });
    assert.ok(seen[0].includes('forecast_hours=12'), 'requests 12 hours');
    assert.ok(seen[0].includes('hourly='), 'requests hourly fields');
    assert.strictEqual(r.hourly.length, 3);
    assert.deepStrictEqual(r.hourly[0], {
      time: '2026-10-07T11:00', tempC: 28, precipitationProbability: 10, windKph: 5, condition: 'cloudy',
    });
  });
});

test('a storm due later today raises the caution now', async () => {
  const weather = freshWeather();
  await withFetch(openMeteoReply({ hourlyRain: [10, 20, 80] }), async () => {
    const r = await weather.getWeather({ lat: -3.38, lng: 36.68 });
    assert.strictEqual(r.flags.heavyRainLikely, true);
  });
});

test('strong wind and extreme heat in the coming hours are flagged', async () => {
  const weather = freshWeather();
  await withFetch(openMeteoReply({ hourlyWind: [5, 35, 5], hourlyTemp: [30, 36, 30] }), async () => {
    const r = await weather.getWeather({ lat: -2.51, lng: 32.91 });
    assert.strictEqual(r.flags.strongWind, true);
    assert.strictEqual(r.flags.extremeHeat, true);
  });
});

test('calm hours raise no caution', async () => {
  const weather = freshWeather();
  await withFetch(openMeteoReply(), async () => {
    const r = await weather.getWeather({ lat: -6.16, lng: 35.75 });
    assert.deepStrictEqual(r.flags, { heavyRainLikely: false, strongWind: false, extremeHeat: false });
  });
});
