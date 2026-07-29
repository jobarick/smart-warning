// Public emergency telephone numbers, by country.
//
// This is a bundled dataset rather than a lookup against some directory API,
// and that is the whole point: the moment a person needs this list is the moment
// the network is least likely to cooperate. It must resolve offline, instantly,
// from coordinates the device already has.
//
// Scaling to a new country is adding a row here — no code changes anywhere else.
// `bbox` is [minLng, minLat, maxLng, maxLat]; lookups pick the SMALLEST bounding
// box containing the point, so a small country inside a larger country's box
// (Lesotho in South Africa's, Vatican City in Italy's) still wins.
//
// Numbers are the published national public-service numbers. Where a country
// runs one universal number, the categories intentionally repeat it — showing a
// caller the same number under "Police" and "Ambulance" is correct and is far
// better than showing them a gap.

/**
 * @typedef {Object} CountryEmergency
 * @property {string} name
 * @property {string} dial      international dialling prefix, e.g. "+255"
 * @property {number[]} bbox    [minLng, minLat, maxLng, maxLat]
 * @property {Object} numbers   category → array of numbers
 */

/** Categories the UI groups services under, in the order it shows them. */
const CATEGORIES = [
  { id: 'police', label: 'Police' },
  { id: 'fire', label: 'Fire' },
  { id: 'ambulance', label: 'Ambulance' },
  { id: 'disaster', label: 'Disaster Management' },
  { id: 'coastguard', label: 'Coast Guard' },
  { id: 'security', label: 'Security Services' },
  { id: 'utility', label: 'Utility Emergency' },
];

const COUNTRIES = {
  TZ: {
    name: 'Tanzania', dial: '+255', bbox: [29.32, -11.75, 40.45, -0.99],
    numbers: {
      police: ['112', '111'], fire: ['114'], ambulance: ['114', '115'],
      disaster: ['0800110064'], coastguard: ['112'], security: ['112'], utility: ['0800711113'],
    },
  },
  KE: {
    name: 'Kenya', dial: '+254', bbox: [33.89, -4.72, 41.91, 5.51],
    numbers: { police: ['999', '112'], fire: ['999'], ambulance: ['999', '1199'], disaster: ['112'], coastguard: ['999'], security: ['999'], utility: ['95551'] },
  },
  UG: {
    name: 'Uganda', dial: '+256', bbox: [29.57, -1.48, 35.04, 4.23],
    numbers: { police: ['999', '112'], fire: ['999'], ambulance: ['999'], disaster: ['112'], coastguard: [], security: ['999'], utility: [] },
  },
  RW: {
    name: 'Rwanda', dial: '+250', bbox: [28.86, -2.84, 30.9, -1.05],
    numbers: { police: ['112'], fire: ['112'], ambulance: ['912'], disaster: ['112'], coastguard: [], security: ['112'], utility: [] },
  },
  BI: {
    name: 'Burundi', dial: '+257', bbox: [29.02, -4.47, 30.85, -2.31],
    numbers: { police: ['117'], fire: ['118'], ambulance: ['113'], disaster: ['117'], coastguard: [], security: ['117'], utility: [] },
  },
  ZM: {
    name: 'Zambia', dial: '+260', bbox: [21.89, -18.08, 33.7, -8.22],
    numbers: { police: ['991', '999'], fire: ['993'], ambulance: ['992'], disaster: ['999'], coastguard: [], security: ['999'], utility: [] },
  },
  MW: {
    name: 'Malawi', dial: '+265', bbox: [32.68, -17.13, 35.92, -9.36],
    numbers: { police: ['997', '990'], fire: ['999'], ambulance: ['998'], disaster: ['997'], coastguard: [], security: ['997'], utility: [] },
  },
  MZ: {
    name: 'Mozambique', dial: '+258', bbox: [30.18, -26.87, 40.78, -10.47],
    numbers: { police: ['119'], fire: ['198'], ambulance: ['117'], disaster: ['119'], coastguard: ['119'], security: ['119'], utility: [] },
  },
  ZA: {
    name: 'South Africa', dial: '+27', bbox: [16.34, -34.84, 32.83, -22.09],
    numbers: { police: ['10111'], fire: ['10177'], ambulance: ['10177', '112'], disaster: ['112'], coastguard: ['112'], security: ['10111'], utility: ['0860037566'] },
  },
  LS: {
    name: 'Lesotho', dial: '+266', bbox: [27.0, -30.65, 29.46, -28.57],
    numbers: { police: ['123'], fire: ['122'], ambulance: ['121'], disaster: ['123'], coastguard: [], security: ['123'], utility: [] },
  },
  SZ: {
    name: 'Eswatini', dial: '+268', bbox: [30.79, -27.32, 32.14, -25.72],
    numbers: { police: ['999'], fire: ['933'], ambulance: ['977'], disaster: ['999'], coastguard: [], security: ['999'], utility: [] },
  },
  ZW: {
    name: 'Zimbabwe', dial: '+263', bbox: [25.24, -22.42, 33.06, -15.61],
    numbers: { police: ['995', '999'], fire: ['993'], ambulance: ['994'], disaster: ['999'], coastguard: [], security: ['995'], utility: [] },
  },
  BW: {
    name: 'Botswana', dial: '+267', bbox: [19.99, -26.91, 29.37, -17.78],
    numbers: { police: ['999'], fire: ['998'], ambulance: ['997'], disaster: ['999'], coastguard: [], security: ['999'], utility: [] },
  },
  NA: {
    name: 'Namibia', dial: '+264', bbox: [11.73, -28.97, 25.26, -16.96],
    numbers: { police: ['10111'], fire: ['112'], ambulance: ['112'], disaster: ['112'], coastguard: ['112'], security: ['10111'], utility: [] },
  },
  NG: {
    name: 'Nigeria', dial: '+234', bbox: [2.67, 4.24, 14.68, 13.87],
    numbers: { police: ['112', '199'], fire: ['112'], ambulance: ['112'], disaster: ['112'], coastguard: ['112'], security: ['112'], utility: [] },
  },
  GH: {
    name: 'Ghana', dial: '+233', bbox: [-3.26, 4.71, 1.19, 11.17],
    numbers: { police: ['191', '112'], fire: ['192'], ambulance: ['193'], disaster: ['112'], coastguard: ['112'], security: ['191'], utility: [] },
  },
  ET: {
    name: 'Ethiopia', dial: '+251', bbox: [32.99, 3.4, 47.99, 14.89],
    numbers: { police: ['991'], fire: ['939'], ambulance: ['907'], disaster: ['991'], coastguard: [], security: ['991'], utility: [] },
  },
  EG: {
    name: 'Egypt', dial: '+20', bbox: [24.7, 22.0, 36.87, 31.67],
    numbers: { police: ['122'], fire: ['180'], ambulance: ['123'], disaster: ['122'], coastguard: ['122'], security: ['122'], utility: [] },
  },
  MA: {
    name: 'Morocco', dial: '+212', bbox: [-13.17, 27.66, -1.0, 35.93],
    numbers: { police: ['190'], fire: ['150'], ambulance: ['150'], disaster: ['177'], coastguard: ['177'], security: ['190'], utility: [] },
  },

  US: {
    name: 'United States', dial: '+1', bbox: [-125.0, 24.4, -66.9, 49.4],
    numbers: { police: ['911'], fire: ['911'], ambulance: ['911'], disaster: ['911'], coastguard: ['911'], security: ['911'], utility: ['811'] },
  },
  CA: {
    name: 'Canada', dial: '+1', bbox: [-141.0, 41.6, -52.6, 83.1],
    numbers: { police: ['911'], fire: ['911'], ambulance: ['911'], disaster: ['911'], coastguard: ['911'], security: ['911'], utility: [] },
  },
  MX: {
    name: 'Mexico', dial: '+52', bbox: [-118.4, 14.5, -86.7, 32.7],
    numbers: { police: ['911'], fire: ['911'], ambulance: ['911'], disaster: ['911'], coastguard: ['911'], security: ['911'], utility: [] },
  },
  BR: {
    name: 'Brazil', dial: '+55', bbox: [-73.99, -33.75, -34.79, 5.27],
    numbers: { police: ['190'], fire: ['193'], ambulance: ['192'], disaster: ['199'], coastguard: ['185'], security: ['190'], utility: [] },
  },
  AR: {
    name: 'Argentina', dial: '+54', bbox: [-73.58, -55.06, -53.64, -21.78],
    numbers: { police: ['911'], fire: ['100'], ambulance: ['107'], disaster: ['103'], coastguard: ['106'], security: ['911'], utility: [] },
  },
  GB: {
    name: 'United Kingdom', dial: '+44', bbox: [-8.62, 49.9, 1.77, 60.85],
    numbers: { police: ['999', '112'], fire: ['999'], ambulance: ['999'], disaster: ['999'], coastguard: ['999'], security: ['999'], utility: ['0800111999'] },
  },
  IE: {
    name: 'Ireland', dial: '+353', bbox: [-10.48, 51.42, -5.99, 55.39],
    numbers: { police: ['112', '999'], fire: ['112'], ambulance: ['112'], disaster: ['112'], coastguard: ['112'], security: ['112'], utility: ['1800205050'] },
  },
  FR: {
    name: 'France', dial: '+33', bbox: [-5.14, 41.33, 9.56, 51.09],
    numbers: { police: ['17', '112'], fire: ['18'], ambulance: ['15'], disaster: ['112'], coastguard: ['196'], security: ['17'], utility: [] },
  },
  DE: {
    name: 'Germany', dial: '+49', bbox: [5.87, 47.27, 15.04, 55.06],
    numbers: { police: ['110'], fire: ['112'], ambulance: ['112'], disaster: ['112'], coastguard: ['124124'], security: ['110'], utility: [] },
  },
  ES: {
    name: 'Spain', dial: '+34', bbox: [-9.3, 35.95, 4.33, 43.79],
    numbers: { police: ['091', '112'], fire: ['080', '112'], ambulance: ['061', '112'], disaster: ['112'], coastguard: ['900202202'], security: ['112'], utility: [] },
  },
  IT: {
    name: 'Italy', dial: '+39', bbox: [6.63, 36.62, 18.52, 47.09],
    numbers: { police: ['113', '112'], fire: ['115'], ambulance: ['118'], disaster: ['112'], coastguard: ['1530'], security: ['112'], utility: [] },
  },
  NL: {
    name: 'Netherlands', dial: '+31', bbox: [3.36, 50.75, 7.23, 53.56],
    numbers: { police: ['112'], fire: ['112'], ambulance: ['112'], disaster: ['112'], coastguard: ['112'], security: ['112'], utility: ['08000022'] },
  },
  SE: {
    name: 'Sweden', dial: '+46', bbox: [11.11, 55.34, 24.16, 69.06],
    numbers: { police: ['112'], fire: ['112'], ambulance: ['112'], disaster: ['112'], coastguard: ['112'], security: ['112'], utility: [] },
  },
  NO: {
    name: 'Norway', dial: '+47', bbox: [4.65, 57.98, 31.29, 71.19],
    numbers: { police: ['112'], fire: ['110'], ambulance: ['113'], disaster: ['112'], coastguard: ['120'], security: ['112'], utility: [] },
  },
  PL: {
    name: 'Poland', dial: '+48', bbox: [14.12, 49.0, 24.15, 54.84],
    numbers: { police: ['997', '112'], fire: ['998'], ambulance: ['999'], disaster: ['112'], coastguard: ['601100100'], security: ['112'], utility: [] },
  },
  PT: {
    name: 'Portugal', dial: '+351', bbox: [-9.53, 36.96, -6.19, 42.16],
    numbers: { police: ['112'], fire: ['112'], ambulance: ['112'], disaster: ['112'], coastguard: ['214401919'], security: ['112'], utility: [] },
  },
  CH: {
    name: 'Switzerland', dial: '+41', bbox: [5.96, 45.82, 10.49, 47.81],
    numbers: { police: ['117'], fire: ['118'], ambulance: ['144'], disaster: ['112'], coastguard: [], security: ['117'], utility: [] },
  },
  RU: {
    name: 'Russia', dial: '+7', bbox: [19.64, 41.19, 180.0, 81.86],
    numbers: { police: ['102'], fire: ['101'], ambulance: ['103'], disaster: ['112'], coastguard: ['112'], security: ['112'], utility: ['104'] },
  },
  TR: {
    name: 'Türkiye', dial: '+90', bbox: [25.66, 35.82, 44.83, 42.11],
    numbers: { police: ['155', '112'], fire: ['110'], ambulance: ['112'], disaster: ['122'], coastguard: ['158'], security: ['155'], utility: ['187'] },
  },

  IN: {
    name: 'India', dial: '+91', bbox: [68.11, 6.75, 97.41, 35.51],
    numbers: { police: ['100', '112'], fire: ['101'], ambulance: ['102', '108'], disaster: ['108', '1078'], coastguard: ['1554'], security: ['112'], utility: ['1906'] },
  },
  PK: {
    name: 'Pakistan', dial: '+92', bbox: [60.87, 23.69, 77.84, 37.1],
    numbers: { police: ['15'], fire: ['16'], ambulance: ['115', '1122'], disaster: ['1129'], coastguard: ['1030'], security: ['15'], utility: [] },
  },
  BD: {
    name: 'Bangladesh', dial: '+880', bbox: [88.01, 20.74, 92.67, 26.63],
    numbers: { police: ['999'], fire: ['999'], ambulance: ['999'], disaster: ['1090'], coastguard: ['999'], security: ['999'], utility: [] },
  },
  CN: {
    name: 'China', dial: '+86', bbox: [73.5, 18.2, 134.77, 53.56],
    numbers: { police: ['110'], fire: ['119'], ambulance: ['120'], disaster: ['110'], coastguard: ['12395'], security: ['110'], utility: [] },
  },
  JP: {
    name: 'Japan', dial: '+81', bbox: [122.93, 24.05, 145.82, 45.52],
    numbers: { police: ['110'], fire: ['119'], ambulance: ['119'], disaster: ['119'], coastguard: ['118'], security: ['110'], utility: [] },
  },
  KR: {
    name: 'South Korea', dial: '+82', bbox: [125.06, 33.11, 129.6, 38.61],
    numbers: { police: ['112'], fire: ['119'], ambulance: ['119'], disaster: ['119'], coastguard: ['122'], security: ['112'], utility: [] },
  },
  ID: {
    name: 'Indonesia', dial: '+62', bbox: [95.01, -11.01, 141.02, 6.08],
    numbers: { police: ['110', '112'], fire: ['113'], ambulance: ['118', '119'], disaster: ['129'], coastguard: ['115'], security: ['112'], utility: [] },
  },
  PH: {
    name: 'Philippines', dial: '+63', bbox: [116.93, 4.64, 126.6, 21.12],
    numbers: { police: ['911', '117'], fire: ['911'], ambulance: ['911'], disaster: ['911'], coastguard: ['0917PCGUARD'], security: ['911'], utility: [] },
  },
  MY: {
    name: 'Malaysia', dial: '+60', bbox: [99.64, 0.85, 119.27, 7.36],
    numbers: { police: ['999'], fire: ['994'], ambulance: ['999'], disaster: ['999'], coastguard: ['999'], security: ['999'], utility: [] },
  },
  SG: {
    name: 'Singapore', dial: '+65', bbox: [103.6, 1.15, 104.09, 1.47],
    numbers: { police: ['999'], fire: ['995'], ambulance: ['995'], disaster: ['995'], coastguard: ['999'], security: ['999'], utility: ['1800CALLPUB'] },
  },
  TH: {
    name: 'Thailand', dial: '+66', bbox: [97.34, 5.61, 105.64, 20.46],
    numbers: { police: ['191'], fire: ['199'], ambulance: ['1669'], disaster: ['1784'], coastguard: ['1196'], security: ['191'], utility: [] },
  },
  VN: {
    name: 'Vietnam', dial: '+84', bbox: [102.14, 8.18, 109.46, 23.39],
    numbers: { police: ['113'], fire: ['114'], ambulance: ['115'], disaster: ['112'], coastguard: ['112'], security: ['113'], utility: [] },
  },
  AE: {
    name: 'United Arab Emirates', dial: '+971', bbox: [51.58, 22.63, 56.4, 26.08],
    numbers: { police: ['999'], fire: ['997'], ambulance: ['998'], disaster: ['996'], coastguard: ['996'], security: ['999'], utility: ['991'] },
  },
  SA: {
    name: 'Saudi Arabia', dial: '+966', bbox: [34.5, 16.35, 55.67, 32.16],
    numbers: { police: ['999'], fire: ['998'], ambulance: ['997'], disaster: ['911'], coastguard: ['994'], security: ['999'], utility: ['933'] },
  },
  IL: {
    name: 'Israel', dial: '+972', bbox: [34.27, 29.49, 35.9, 33.34],
    numbers: { police: ['100'], fire: ['102'], ambulance: ['101'], disaster: ['104'], coastguard: ['100'], security: ['100'], utility: [] },
  },
  AU: {
    name: 'Australia', dial: '+61', bbox: [112.92, -43.65, 153.64, -10.06],
    numbers: { police: ['000', '112'], fire: ['000'], ambulance: ['000'], disaster: ['132500'], coastguard: ['000'], security: ['000'], utility: [] },
  },
  NZ: {
    name: 'New Zealand', dial: '+64', bbox: [166.51, -47.29, 178.52, -34.39],
    numbers: { police: ['111'], fire: ['111'], ambulance: ['111'], disaster: ['111'], coastguard: ['111'], security: ['111'], utility: [] },
  },
};

// Last resort when coordinates fall outside every box (mid-ocean, Antarctica, a
// country not yet in the table). 112 and 911 are the two numbers most widely
// routed to a national dispatcher, and GSM handsets accept both almost anywhere.
const FALLBACK = {
  code: null,
  name: 'International',
  dial: '',
  numbers: {
    police: ['112', '911'], fire: ['112'], ambulance: ['112'],
    disaster: ['112'], coastguard: ['112'], security: ['112'], utility: [],
  },
};

const bboxArea = (b) => (b[2] - b[0]) * (b[3] - b[1]);

/**
 * Resolve a country from coordinates. Smallest containing box wins, so enclaves
 * and small states beat the large neighbours whose boxes overlap them.
 * @returns {{code: string|null, name: string, dial: string, numbers: object}}
 */
function countryAt(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { ...FALLBACK };
  let best = null;
  let bestArea = Infinity;
  for (const [code, c] of Object.entries(COUNTRIES)) {
    const [minLng, minLat, maxLng, maxLat] = c.bbox;
    if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) continue;
    const area = bboxArea(c.bbox);
    if (area < bestArea) { bestArea = area; best = { code, ...c }; }
  }
  if (!best) return { ...FALLBACK };
  return { code: best.code, name: best.name, dial: best.dial, numbers: best.numbers };
}

/** Look a country up by ISO 3166-1 alpha-2 code, for clients that already know it. */
function countryByCode(code) {
  const c = COUNTRIES[String(code || '').toUpperCase()];
  if (!c) return { ...FALLBACK };
  return { code: String(code).toUpperCase(), name: c.name, dial: c.dial, numbers: c.numbers };
}

/**
 * The shape the client renders: ordered categories, empty ones dropped, so a
 * landlocked country simply has no Coast Guard row rather than an empty one.
 */
function directoryFor(country) {
  const services = [];
  for (const cat of CATEGORIES) {
    const numbers = country.numbers[cat.id] || [];
    if (numbers.length) services.push({ id: cat.id, label: cat.label, numbers });
  }
  return { country: { code: country.code, name: country.name, dial: country.dial }, services };
}

module.exports = { CATEGORIES, COUNTRIES, countryAt, countryByCode, directoryFor, FALLBACK };
