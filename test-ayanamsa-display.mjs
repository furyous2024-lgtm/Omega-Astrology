import assert from "node:assert/strict";

let ayanamsaSelect;
globalThis.document = {
  addEventListener() {},
  getElementById() { return null; },
  querySelector(selector) {
    return selector === '#system-settings select[name="ayanamsaSystem"]'
      ? ayanamsaSelect
      : null;
  },
};
globalThis.window = {};

const { requestSwissChart } = await import("./js/localSwiss.js");
const options = ["Tropical", "Lahiri", "Raman", "Ayanamsa Fixo"].map(
  (value) => ({
    value,
    textContent: value,
    dataset: {},
  }),
);
ayanamsaSelect = {
  options,
  value: "Lahiri",
};

const positionNames = [
  "Sun",
  "Moon",
  "Mercury",
  "Venus",
  "Mars",
  "Jupiter",
  "Saturn",
  "Uranus",
  "Neptune",
  "Pluto",
  "Chiron",
  "Ceres",
  "Pallas",
  "Juno",
  "Vesta",
  "North Node",
  "South Node",
  "Lilith",
  "Priapus",
  "Ascendant Symbol",
  "Midheaven",
  "Descendant",
  "Imum Coeli",
  "Vertex",
  "Anti-Vertex",
  "Part of Fortune",
  "Part of Spirit",
  "Galactic Center",
];

function chartResponse(ayanamsa) {
  return {
    success: true,
    julianDay: 2451545,
    ayanamsa,
    ayanamsaValues: {
      Tropical: 0,
      Lahiri: 24.12345678912,
      Raman: 22.50000000004,
      "Ayanamsa Fixo": 0,
    },
    positions: Object.fromEntries(
      positionNames.map((name) => [name, { position: 1, speed: 0 }]),
    ),
    houseCusps: Array.from({ length: 12 }, (_, index) => ({
      house: index + 1,
      position: index * 30,
    })),
    fixedStars: [],
  };
}

let releaseFirstResponse;
let signalFirstRequest;
globalThis.fetch = async (_url, options) => {
  const request = JSON.parse(options.body);
  if (request.selectedAyanamsaSystem === "Lahiri") {
    signalFirstRequest();
    return new Promise((resolve) => {
      releaseFirstResponse = () => resolve({
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify(chartResponse(24.12345678912));
        },
      });
    });
  }
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify(chartResponse(22.50000000004));
    },
  };
};

const firstRequestStarted = new Promise((resolve) => {
  signalFirstRequest = resolve;
});
const firstChart = requestSwissChart({
  location: "0, 0",
  lat: 0,
  long: 0,
  useCoordinates: true,
  year: 2000,
  month: 1,
  day: 1,
  hour: 12,
  minute: 0,
  utcMode: "manual",
  selectedAyanamsaSystem: "Lahiri",
  selectedZodiacSystem: "Tropical",
  selectedCoordinateSystem: "Geocentric",
  selectedHouseSystem: "Placidus",
});
await firstRequestStarted;

ayanamsaSelect.value = "Raman";
await requestSwissChart({
  location: "0, 0",
  lat: 0,
  long: 0,
  useCoordinates: true,
  year: 2000,
  month: 1,
  day: 1,
  hour: 12,
  minute: 0,
  utcMode: "manual",
  selectedAyanamsaSystem: "Raman",
  selectedZodiacSystem: "Tropical",
  selectedCoordinateSystem: "Geocentric",
  selectedHouseSystem: "Placidus",
});

releaseFirstResponse();
await firstChart;

assert.equal(options[1].textContent, "Lahiri (24.1234567891°)");
assert.equal(options[2].textContent, "Raman (22.5000000000°)");
assert.equal(options[3].textContent, "Ayanamsa Fixo");
console.log("Ayanamsa labels use the selected date's values without stale responses.");
