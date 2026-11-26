"use strict";

let cityRecordsPromise;

const MIDPOINT_BOUNDARIES = [
  ["Aries", 0],
  ["Taurus", 19.7267],
  ["Gemini", 56.5838],
  ["Cancer", 86.0378],
  ["Leo", 103.1872],
  ["Virgo", 141.6068],
  ["Libra", 191.3253],
  ["Scorpio", 210.2037],
  ["Ophiuchus", 223.4316],
  ["Sagittarius", 235.7895],
  ["Capricorn", 269.1806],
  ["Aquarius", 294.8496],
  ["Pisces", 318.0143],
];

const EQUAL_13_SIGNS = [
  "Aries",
  "Taurus",
  "Gemini",
  "Cancer",
  "Leo",
  "Virgo",
  "Libra",
  "Scorpio",
  "Sagittarius",
  "Capricorn",
  "Aquarius",
  "Pisces",
  "Ophiuchus",
];
const EQUAL_13_BOUNDARIES = EQUAL_13_SIGNS.map((sign, index) => ({
  sign,
  boundary: (240 + (index - 8) * (360 / EQUAL_13_SIGNS.length) + 360) % 360,
}));
const IAU_SIGN_NAMES = new Set(EQUAL_13_SIGNS);
const IAU_NAME_ALIASES = {
  Scorpius: "Scorpio",
  Capricornus: "Capricorn",
};

let astronomyLibraryPromise;

const HOUSE_CODES = {
  Placidus: "P",
  Equal: "E",
  "Whole Sign": "W",
  Koch: "K",
  Porphyrius: "O",
  Regiomontanus: "R",
  Campanus: "C",
};
const SWISS_REQUEST_TIMEOUT_MS = 60000;

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase();
}

async function getCityRecords() {
  if (!cityRecordsPromise) {
    cityRecordsPromise = fetch("/data/cities.json")
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Unable to load local city data (${response.status}).`);
        }
        return response.json();
      })
      .then((records) => {
        if (!Array.isArray(records)) {
          throw new Error("Local city data is invalid.");
        }
        return records;
      });
  }
  return cityRecordsPromise;
}

const COUNTRY_ALIASES = {
  brasil: "brazil",
  usa: "united states",
  "united states of america": "united states",
  uk: "united kingdom",
  britain: "united kingdom",
  england: "united kingdom",
  "south korea": "south korea",
  "republic of korea": "south korea",
  "north korea": "north korea",
  "democratic people's republic of korea": "north korea",
  "czech republic": "czechia",
  "russian federation": "russia",
  "viet nam": "vietnam",
  "lao people's democratic republic": "laos",
  "iran, islamic republic of": "iran",
  "syrian arab republic": "syria",
  "united republic of tanzania": "tanzania",
  "republic of moldova": "moldova",
  "palestinian territories": "palestine",
  "palestinian territory": "palestine",
  "palestina": "palestine",
  "palesitina": "palestine",
  "state of palestine": "palestine",
  "west bank and gaza": "palestine",
  "turkiye": "turkey",
  "turkey": "turkey",
  "hong kong sar china": "hong kong",
  "taiwan, province of china": "taiwan",
};

function canonicalCountry(value) {
  const country = normalize(value).replace(/[.]/g, "").replace(/\s+/g, " ");
  return COUNTRY_ALIASES[country] || country;
}

function locationParts(location) {
  return String(location || "")
    .split(":")[0]
    .split(",")
    .map((part) => normalize(part))
    .filter(Boolean);
}

function findCity(location, cities) {
  const parts = locationParts(location);
  if (!parts.length) return null;
  const cityName = parts[0];
  const hasCountry = parts.length >= 3;
  const regionName = hasCountry ? parts.slice(1, -1).join(", ") : (parts[1] || "");
  const countryName = hasCountry ? canonicalCountry(parts[parts.length - 1]) : "";

  const secondPartIsCountry = !hasCountry && parts.length === 2;
  const matches = cities
    .filter((city) => normalize(city.name) === cityName)
    .map((city) => {
      let score = 0;
      const cityRegion = normalize(city.region);
      const cityCountry = canonicalCountry(city.country);
      const secondPartCountryMatch = secondPartIsCountry && cityCountry === canonicalCountry(parts[1]);
      if (regionName && !secondPartCountryMatch) {
        if (cityRegion === regionName) score += 40;
        else if (cityRegion.includes(regionName) || regionName.includes(cityRegion)) score += 8;
        else score -= 8;
      }
      if (countryName) {
        if (cityCountry === countryName) score += 80;
        else score -= 100;
      } else if (secondPartCountryMatch) {
        // Accept the common "City, Country" form as well as "City, Region, Country".
        score += 80;
      }
      return { city, score };
    })
    .sort((a, b) => b.score - a.score);

  if (!matches.length) return null;
  if (!regionName && !countryName && matches.length > 1) return null;
  if (countryName && matches[0].score < 0) return null;
  if (matches.length > 1 && matches[0].score === matches[1].score) return null;
  return matches[0].city;
}

function formatUtcOffset(offset) {
  if (!Number.isFinite(Number(offset))) return "UTC offset unavailable";
  const totalMinutes = Math.round(Number(offset) * 60);
  const sign = totalMinutes < 0 ? "−" : "+";
  const absolute = Math.abs(totalMinutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, "0");
  const minutes = String(absolute % 60).padStart(2, "0");
  return `UTC${sign}${hours}:${minutes}`;
}

function getGeoCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem("trueSky.locationGeoCache.v1") || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveGeoCache(cache) {
  try {
    const entries = Object.entries(cache).slice(-300);
    localStorage.setItem("trueSky.locationGeoCache.v1", JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Storage can be unavailable in private browsing; geocoding still works for this session.
  }
}

function normalizeCityMatch(value) {
  return normalize(value)
    .replace(/[’'`.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 7000) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (timedOut) {
      throw new Error(`Request timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function scoreGeocodeCandidate(candidate, parts) {
  const targetCity = parts[0] || "";
  const hasCountry = parts.length >= 3;
  const targetRegion = hasCountry ? parts.slice(1, -1).join(", ") : (parts[1] || "");
  const targetCountry = hasCountry ? canonicalCountry(parts[parts.length - 1]) : "";
  const candidateCity = normalizeCityMatch(candidate.name || "");
  const candidateRegion = normalizeCityMatch(candidate.admin1 || candidate.admin2 || "");
  const candidateCountry = canonicalCountry(candidate.country || "");
  let score = 0;

  if (candidateCity === normalizeCityMatch(targetCity)) score += 100;
  else if (candidateCity.startsWith(normalizeCityMatch(targetCity))) score += 30;
  else score -= 35;

  if (targetRegion) {
    if (candidateRegion === normalizeCityMatch(targetRegion)) score += 35;
    else if (candidateRegion.includes(normalizeCityMatch(targetRegion)) || normalizeCityMatch(targetRegion).includes(candidateRegion)) score += 12;
    else score -= 10;
  }
  if (targetCountry) {
    if (candidateCountry === targetCountry) score += 100;
    else score -= 150;
  }
  if (candidate.feature_code && /PPLC|PPLA|PPL$/i.test(candidate.feature_code)) score += 5;
  return score;
}

async function fetchOnlineGeocoding(location) {
  const parts = locationParts(location);
  if (!parts.length || parseCustomCoordinates(location)) return null;
  const cacheKey = normalizeCityMatch(location);
  const cache = getGeoCache();
  if (cache[cacheKey] && Number.isFinite(Number(cache[cacheKey].lat)) && Number.isFinite(Number(cache[cacheKey].lon))) {
    return cache[cacheKey];
  }

  const cityQuery = parts[0];
  const queryCandidates = [];
  const apiUrl = typeof window.trueskyApiUrl === "function"
    ? window.trueskyApiUrl(`/api/location-search?query=${encodeURIComponent(location)}`)
    : `/api/location-search?query=${encodeURIComponent(location)}`;

  // Prefer the app backend proxy. Older deployments may not have this endpoint yet,
  // so a direct public-geocoder fallback keeps the feature useful after deployment.
  try {
    const response = await fetchWithTimeout(apiUrl, { headers: { Accept: "application/json" } }, 5000);
    const body = await response.json();
    if (response.ok && Array.isArray(body?.results)) queryCandidates.push(...body.results);
  } catch {
    // The direct public API is tried below.
  }

  if (!queryCandidates.length) {
    try {
      const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityQuery)}&count=10&language=en&format=json`;
      const response = await fetchWithTimeout(url, { headers: { Accept: "application/json" } }, 7000);
      if (response.ok) {
        const body = await response.json();
        if (Array.isArray(body?.results)) queryCandidates.push(...body.results);
      }
    } catch {
      // Offline or blocked network; caller can still use manual coordinates and UTC offset.
    }
  }

  if (!queryCandidates.length) return null;
  const best = queryCandidates
    .filter((candidate) => Number.isFinite(Number(candidate.latitude)) && Number.isFinite(Number(candidate.longitude)))
    .map((candidate) => ({ candidate, score: scoreGeocodeCandidate(candidate, parts) }))
    .sort((a, b) => b.score - a.score)[0]?.candidate;
  if (!best) return null;
  if (parts.length >= 3 && scoreGeocodeCandidate(best, parts) < 50) return null;

  const record = {
    name: best.name || parts[0],
    region: best.admin1 || best.admin2 || parts[1] || "",
    country: best.country || parts.slice(2).join(", "),
    lat: Number(best.latitude),
    lon: Number(best.longitude),
    source: "online-geocoder",
  };
  cache[cacheKey] = record;
  saveGeoCache(cache);
  return record;
}

function parseCustomCoordinates(location) {
  const text = String(location || "").trim();
  // Accept the new clean format "latitude, longitude" and legacy labels such as
  // "Coordinates: latitude, longitude" or "Place: latitude, longitude".
  const match = text.match(
    /^(?:[^:]+:\s*)?(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/,
  );
  if (!match) return null;
  const lat = Number(match[1]);
  const long = Number(match[2]);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(long) || long < -180 || long > 180) return null;
  return { lat, long };
}

function formatCoordinateValue(value) {
  return Number(value).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function coordinateLocationLabel(lat, longitude) {
  // Keep the location input machine-readable: coordinates only, without a prefix.
  return `${formatCoordinateValue(lat)}, ${formatCoordinateValue(longitude)}`;
}

function isCoordinateLocationLabel(value) {
  return !!parseCustomCoordinates(value);
}

function nestedNatalMetadata(request) {
  const natalData = request.natalData;
  if (Array.isArray(natalData)) return natalData[0] || {};
  return natalData && typeof natalData === "object" ? natalData : {};
}

export async function prepareSwissRequest(request, form = null) {
  const payload = { ...request };
  const natal = nestedNatalMetadata(request);
  const coordinateToggle = form?.querySelector('[name="useCoordinates"]');
  const hasCoordinateToggle = !!coordinateToggle;
  const formLocationValue = form?.querySelector('[name="location"]')?.value;
  const formLat = form?.querySelector('[name="lat"]')?.value;
  const formLong = form?.querySelector('[name="long"]')?.value;
  const requestedLat = formLat !== undefined ? formLat : (payload.lat ?? payload.latitude);
  const requestedLong = formLong !== undefined ? formLong : (payload.long ?? payload.lon ?? payload.longitude);
  // The location field is the source of truth. A stale checked toggle must not
  // override a newly selected city; coordinate mode is inferred from a numeric pair.
  const requestLocation = String(formLocationValue || payload.location || natal.location || "").trim();
  const coordinatesInLocation = parseCustomCoordinates(requestLocation);
  const requestedCoordinateMode = coordinateToggle?.checked === true || payload.useCoordinates === true || payload.useCoordinates === "true" || payload.useCoordinates === "on";
  const hasRequestedCoordinates = requestedLat !== undefined && requestedLat !== "" && requestedLong !== undefined && requestedLong !== "";
  const useCoordinates = !!coordinatesInLocation || (!formLocationValue && requestedCoordinateMode && hasRequestedCoordinates);
  const location = coordinatesInLocation
    ? coordinateLocationLabel(coordinatesInLocation.lat, coordinatesInLocation.long)
    : useCoordinates && hasRequestedCoordinates
      ? coordinateLocationLabel(requestedLat, requestedLong)
      : requestLocation;
  const customCoordinates = parseCustomCoordinates(location);

  // The suggestion list contains far more cities than the small offline fallback
  // table. Try the local records first, then the online geocoder even on form submit
  // so a delayed/missed change event cannot make a valid city fail chart calculation.
  let cities = [];
  try { cities = await getCityRecords(); } catch (_) { cities = []; }
  let city = customCoordinates ? null : findCity(location, cities);
  if (!city && !customCoordinates && location) {
    try { city = await fetchOnlineGeocoding(location); } catch (_) { city = null; }
  }

  if (city && form) {
    const latitudeInput = form.querySelector('[name="lat"]');
    const longitudeInput = form.querySelector('[name="long"]');
    if (latitudeInput) {
      latitudeInput.value = formatCoordinateValue(city.lat);
      latitudeInput.dataset.manual = "false";
    }
    if (longitudeInput) {
      longitudeInput.value = formatCoordinateValue(city.lon ?? city.long);
      longitudeInput.dataset.manual = "false";
    }
    if (coordinateToggle) coordinateToggle.checked = false;
  }

  const latitudeField = form?.querySelector('[name="lat"]');
  const longitudeField = form?.querySelector('[name="long"]');
  const manuallyEditedCoordinates = latitudeField?.dataset.manual === "true" && longitudeField?.dataset.manual === "true";
  // A bare coordinate pair takes precedence even if the checkbox was not checked.
  const manualCoordinates = useCoordinates || !!customCoordinates || manuallyEditedCoordinates || (!hasCoordinateToggle && (
    latitudeField?.dataset.manual === "true" || longitudeField?.dataset.manual === "true"
  ));
  const sameLocationAsNatal = normalize(location) === normalize(natal.location);
  const useCityCoordinates = city && !manualCoordinates;
  const lat = useCityCoordinates
    ? city.lat
    : manualCoordinates
      ? customCoordinates?.lat ?? requestedLat ?? (sameLocationAsNatal ? natal.lat : undefined)
      : (sameLocationAsNatal ? natal.lat : undefined);
  const long = useCityCoordinates
    ? (city.lon ?? city.long)
    : manualCoordinates
      ? customCoordinates?.long ?? requestedLong ?? (sameLocationAsNatal ? natal.long : undefined)
      : (sameLocationAsNatal ? natal.long : undefined);
  if (lat === undefined || long === undefined || lat === "" || long === "") {
    throw new Error(
      "Enter latitude and longitude, or choose a city available in the local location list.",
    );
  }

  const latitude = Number(lat);
  const longitude = Number(long);
  if (
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new Error("Latitude must be -90..90 and longitude -180..180.");
  }

  const automaticUtcToggle = form?.querySelector('[name="autoUtc"]');
  const utcMode = automaticUtcToggle
    ? (automaticUtcToggle.checked ? "auto" : "manual")
    : (String(payload.utcMode || "manual").toLowerCase() === "auto" ? "auto" : "manual");
  const offsetValue =
    form?.querySelector('[name="utcOffset"]')?.value ??
    payload.utcOffset ??
    natal.utcOffset ??
    0;
  const utcOffset = Number(offsetValue);
  if (utcMode === "manual" && (String(offsetValue).trim() === "" || !Number.isFinite(utcOffset) || utcOffset < -14 || utcOffset > 14)) {
    throw new Error("Manual UTC offset must be between -14 and +14 hours.");
  }

  payload.lat = latitude;
  payload.long = longitude;
  payload.utcOffset = utcOffset;
  payload.utcMode = utcMode;
  delete payload.timezone;
  const modeField = form?.querySelector('[name="utcMode"]');
  if (modeField) modeField.value = utcMode;
  payload.useCoordinates = !!manualCoordinates;
  payload.location = manualCoordinates
    ? coordinateLocationLabel(latitude, longitude)
    : location;
  if (form && manualCoordinates) {
    const locationField = form.querySelector('[name="location"]');
    if (locationField) locationField.value = payload.location;
    if (coordinateToggle) coordinateToggle.checked = true;
    if (latitudeField) latitudeField.value = formatCoordinateValue(latitude);
    if (longitudeField) longitudeField.value = formatCoordinateValue(longitude);
  }
  payload.selectedHouseSystem =
    payload.selectedHouseSystem || natal.houseSystem || "Placidus";
  payload.houseSystemCode =
    payload.houseSystemCode || HOUSE_CODES[payload.selectedHouseSystem] || "P";
  const zodiacSelect = document.querySelector(
    '#system-settings select[name="zodiacSystem"]',
  );
  const ayanamsaSelect = document.querySelector(
    '#system-settings select[name="ayanamsaSystem"]',
  );
  payload.selectedZodiacSystem =
    zodiacSelect?.value || payload.selectedZodiacSystem || natal.zodiacSystem || "Tropical";
  payload.selectedAyanamsaSystem =
    ayanamsaSelect?.value ||
    payload.selectedAyanamsaSystem ||
    natal.ayanamsaSystem ||
    "Tropical";
  payload.customAyanamsaValue =
    Number(document.getElementById("customAyanamsaValue")?.value ??
      payload.customAyanamsaValue ??
      natal.customAyanamsaValue ??
      0);
  payload.customAyanamsaDegreesValue =
    Number(document.getElementById("customAyanamsaDegreesValue")?.value ?? 0);
  payload.customAyanamsaDegrees =
    Number(document.getElementById("customAyanamsaDegrees")?.value ?? 0);
  payload.customAyanamsaMinutes =
    Number(document.getElementById("customAyanamsaMinutes")?.value ?? 0);
  payload.customAyanamsaSeconds =
    Number(document.getElementById("customAyanamsaSeconds")?.value ?? 0);
  payload.customAyanamsaJulianDate =
    Number(document.getElementById("customAyanamsaJulianDate")?.value ?? 2451545);
  payload.selectedCoordinateSystem =
    payload.selectedCoordinateSystem || natal.coordinateSystem || "Geocentric";
  payload.trueNodes =
    payload.trueNodes ?? natal.trueNodes ?? true;
  payload.trueLilith =
    payload.trueLilith ?? natal.trueLilith ?? false;
  payload.draconic =
    payload.draconic ??
    document
      ?.querySelector('.degree-settings input[name="draconic"]')
      ?.checked ??
    false;
  payload.ascendantOverride =
    payload.ascendantOverride ??
    document?.getElementById("ascendantOverride")?.value ??
    "Normal";
  payload.fixedStars =
    payload.fixedStars ??
    document?.querySelector('input[name="fixedStars"]')?.checked ??
    false;
  payload.fixedStarsMagnitude =
    payload.fixedStarsMagnitude ??
    parseFloat(document?.querySelector('select[name="fixedStarsMagnitude"]')?.value) ??
    2.0;
  payload.fixedStarsLatitude =
    payload.fixedStarsLatitude ??
    parseFloat(document?.querySelector('select[name="fixedStarsLatitude"]')?.value) ??
    30.0;
  return payload;
}

function signForPosition(position, zodiacSystem, zodiacBoundaries = null) {
  const normalized = ((position % 360) + 360) % 360;
  const boundaries =
    zodiacBoundaries ||
    (zodiacSystem === "Midpoint"
      ? MIDPOINT_BOUNDARIES.map(([sign, boundary]) => ({ sign, boundary }))
      : isEqual13System(zodiacSystem)
        ? EQUAL_13_BOUNDARIES
        : null);
  if (boundaries) {
    let sign = boundaries[boundaries.length - 1]?.sign;
    for (const item of boundaries) {
      if (normalized < item.boundary) break;
      sign = item.sign;
    }
    return sign;
  }
  return [
    "Aries",
    "Taurus",
    "Gemini",
    "Cancer",
    "Leo",
    "Virgo",
    "Libra",
    "Scorpio",
    "Sagittarius",
    "Capricorn",
    "Aquarius",
    "Pisces",
  ][Math.floor(normalized / 30)];
}

function findHouse(position, cusps) {
  const longitude = ((position % 360) + 360) % 360;
  for (let index = 0; index < cusps.length; index += 1) {
    const start = cusps[index].position;
    const end = cusps[(index + 1) % cusps.length].position;
    const span = (end - start + 360) % 360;
    const fromStart = (longitude - start + 360) % 360;
    if (fromStart < span || index === cusps.length - 1) return index + 1;
  }
  return null;
}

function isEqual13System(value) {
  return normalize(value).replace(/[^a-z0-9]/g, "") === "13equal";
}

function isIauConstellationSystem(value) {
  return normalize(value).includes("iau real constellations");
}

async function getAstronomyLibrary() {
  if (globalThis.Astronomy?.Constellation) return globalThis.Astronomy;
  if (!astronomyLibraryPromise) {
    astronomyLibraryPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/js/astronomy.browser.js";
      script.onload = () => {
        if (globalThis.Astronomy?.Constellation) {
          resolve(globalThis.Astronomy);
        } else {
          reject(new Error("The astronomy library did not expose constellation boundaries."));
        }
      };
      script.onerror = () => {
        reject(new Error("Could not load the astronomy library for IAU constellation boundaries."));
      };
      document.head.append(script);
    });
  }
  return astronomyLibraryPromise;
}

function constellationAlongEcliptic(longitude, time, astronomy) {
  const eclipticVector = astronomy.VectorFromSphere(
    new astronomy.Spherical(0, ((longitude % 360) + 360) % 360, 1),
    time,
  );
  const equatorialJ2000 = astronomy.RotateVector(
    astronomy.Rotation_ECT_EQJ(time),
    eclipticVector,
  );
  const equatorial = astronomy.EquatorFromVector(equatorialJ2000);
  return astronomy.Constellation(equatorial.ra, equatorial.dec).name;
}

async function getIauEclipticBoundaries(julianDay) {
  if (!Number.isFinite(julianDay)) {
    throw new Error("Swiss Ephemeris did not return a valid Julian day for IAU boundaries.");
  }
  const astronomy = await getAstronomyLibrary();
  const time = new astronomy.AstroTime(julianDay - 2451545);
  const names = Array.from({ length: 360 }, (_, degree) =>
    constellationAlongEcliptic(degree, time, astronomy),
  );
  const boundaries = [];

  for (let degree = 0; degree < 360; degree += 1) {
    const previousName = names[(degree + 359) % 360];
    const currentName = names[degree];
    if (previousName === currentName) continue;

    let low = degree - 1;
    let high = degree;
    while (high - low > 0.000001) {
      const midpoint = (low + high) / 2;
      if (
        constellationAlongEcliptic(midpoint, time, astronomy) === previousName
      ) {
        low = midpoint;
      } else {
        high = midpoint;
      }
    }

    const sign = IAU_NAME_ALIASES[currentName] || currentName;
    if (!IAU_SIGN_NAMES.has(sign)) {
      throw new Error(
        `The IAU ecliptic boundary resolved to unsupported zodiac constellation "${currentName}".`,
      );
    }
    boundaries.push({
      sign,
      boundary: ((high % 360) + 360) % 360,
    });
  }

  return boundaries.sort((left, right) => left.boundary - right.boundary);
}

function settingValues(request, key, selector, valueName) {
  if (Array.isArray(request[key])) return request[key];
  if (
    typeof document === "undefined" ||
    typeof document.querySelectorAll !== "function"
  ) {
    return null;
  }
  return Array.from(document.querySelectorAll(selector)).map((element) =>
    valueName ? element.dataset[valueName] : element.value,
  );
}

function attachAspects(planets, request) {
  const aspectSettings = settingValues(
    request,
    "selectedAspects",
    '#aspect-settings input[name="aspects"]:checked',
  );
  const enabledAspects =
    aspectSettings === null
      ? null
      : new Set(aspectSettings.map((type) => normalize(type)));
  const planetSettings = settingValues(
    request,
    "selectedPlanetsAspects",
    '#planet-settings input[name="planetAspects"]:checked',
  );
  const enabledPlanets =
    planetSettings === null
      ? null
      : new Set(planetSettings.map((name) => normalize(name)));
  const aspectOrbs = {};
  const orbSettings =
    request.aspectOrbs && typeof request.aspectOrbs === "object"
      ? request.aspectOrbs
      : typeof document !== "undefined" &&
          typeof document.querySelectorAll === "function"
        ? Object.fromEntries(
            Array.from(
              document.querySelectorAll("#aspect-settings select.aspect-orb"),
            ).map((select) => [
              normalize(select.dataset.aspect),
              Number(select.value),
            ]),
          )
        : {};
  Object.entries(orbSettings).forEach(([name, orb]) => {
    aspectOrbs[normalize(name)] = Number(orb);
  });

  const aspects = [
    { deg: 0, type: "Conjunction", orb: 10 },
    { deg: 180, type: "Opposition", orb: 10 },
    { deg: 120, type: "Trine", orb: 8 },
    { deg: 90, type: "Square", orb: 8 },
    { deg: 60, type: "Sextile", orb: 6 },
    { deg: 30, type: "Semisextile", orb: 3 },
    { deg: 150, type: "Quincunx", orb: 3 },
  ]
    .map((aspect) => ({
      ...aspect,
      orb: aspectOrbs[normalize(aspect.type)] ?? aspect.orb,
    }))
    .filter(
      (aspect) =>
        enabledAspects === null || enabledAspects.has(normalize(aspect.type)),
    );

  const customAspects = Array.isArray(request.customAspects)
    ? request.customAspects
        .filter(
          (aspect) =>
            Number.isFinite(Number(aspect.angle)) &&
            Number.isFinite(Number(aspect.orb)),
        )
        .map((aspect) => ({
          deg: Number(aspect.angle),
          type: `custom${Number(aspect.angle)}`,
          orb: Number(aspect.orb),
          isCustom: true,
          customAngle: Number(aspect.angle),
        }))
    : [];
  const candidates = [...aspects, ...customAspects];
  const planetList = planets.filter(
    (planet) =>
      planet.name !== "Ascendant" &&
      Number.isFinite(planet.position) &&
      !planet.name?.startsWith("House"),
  );
  planetList.forEach((planet) => {
    planet.aspects = [];
  });

  const allowedPlanet = (planet) =>
    enabledPlanets === null ||
    enabledPlanets.has(normalize(planet.name)) ||
    (planet.name === "Earth" && enabledPlanets.has("sun"));

  for (let leftIndex = 0; leftIndex < planetList.length; leftIndex += 1) {
    const left = planetList[leftIndex];
    if (!allowedPlanet(left)) continue;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < planetList.length;
      rightIndex += 1
    ) {
      const right = planetList[rightIndex];
      if (!allowedPlanet(right)) continue;
      const distance = Math.abs(
        ((left.position - right.position + 540) % 360) - 180,
      );
      const aspect = candidates.find(
        (candidate) => Math.abs(distance - candidate.deg) <= candidate.orb,
      );
      if (!aspect) continue;

      let signedDistance = left.position - right.position;
      if (signedDistance > 180) signedDistance -= 360;
      else if (signedDistance < -180) signedDistance += 360;
      const distanceFromExact = Math.abs(signedDistance) - aspect.deg;
      const separationSpeed =
        Math.sign(signedDistance) *
        (Number(left.speed || 0) - Number(right.speed || 0));
      const aspectData = {
        type: aspect.type,
        orb: Math.abs(distance - aspect.deg),
        status:
          distanceFromExact * separationSpeed < 0 ? "applying" : "separating",
        ...(aspect.isCustom
          ? { isCustom: true, customAngle: aspect.customAngle }
          : {}),
      };
      left.aspects.push({ ...aspectData, planet: right.name });
      right.aspects.push({ ...aspectData, planet: left.name });
    }
  }
}

function normalizeApiBase(value) {
  const trimmed = String(value || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname.endsWith(".web.app") || hostname.endsWith(".firebaseapp.com")) {
      return "https://true-sky-astrologia.onrender.com";
    }
    return parsed.origin;
  } catch (error) {
    return "https://true-sky-astrologia.onrender.com";
  }
}

function swissEphemerisUrl() {
  const windowObject = typeof window !== "undefined" ? window : null;
  const globalObject = typeof globalThis !== "undefined" ? globalThis : null;
  const apiUrlFn =
    (windowObject && typeof windowObject.trueskyApiUrl === "function")
      ? windowObject.trueskyApiUrl.bind(windowObject)
      : (globalObject && typeof globalObject.trueskyApiUrl === "function")
        ? globalObject.trueskyApiUrl.bind(globalObject)
        : null;

  if (apiUrlFn) {
    return apiUrlFn("/api/swiss-ephemeris");
  }

  const configuredBase = normalizeApiBase(
    (windowObject && windowObject.TRUESKY_API_BASE_URL) ||
      (globalObject && globalObject.TRUESKY_API_BASE_URL) ||
      "",
  );
  if (configuredBase) {
    return `${configuredBase}/api/swiss-ephemeris`;
  }

  const hostname = windowObject?.location?.hostname || "localhost";
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.endsWith(".onrender.com")
  ) {
    return "/api/swiss-ephemeris";
  }

  return "https://true-sky-astrologia.onrender.com/api/swiss-ephemeris";
}

async function chartDataFromSwiss(result, request) {
  if (!result || result.success !== true || !result.positions) {
    throw new Error(result?.error || "Swiss Ephemeris returned no chart positions.");
  }
  const ayanamsaSelect =
    typeof document === "undefined"
      ? null
      : document.querySelector(
          '#system-settings select[name="ayanamsaSystem"]',
        );
  if (ayanamsaSelect) {
    const ayanamsaValues = result.ayanamsaValues || {};
    for (const option of ayanamsaSelect.options) {
      option.dataset.baseLabel ||= option.textContent;
      const value = option.selected
        ? Number(result.ayanamsa)
        : Number(ayanamsaValues[option.value]);
      option.textContent = Number.isFinite(value)
        ? `${option.dataset.baseLabel} (${value.toFixed(10)}°)`
        : option.dataset.baseLabel;
    }
  }
  if (!Array.isArray(result.houseCusps) || result.houseCusps.length !== 12) {
    throw new Error("Swiss Ephemeris did not return all 12 house cusps.");
  }
  const expectedObjects = [
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
    request.selectedCoordinateSystem === "Heliocentric" ? "Earth" : "Sun",
  ];
  const missingObjects = expectedObjects.filter(
    (name) => !Number.isFinite(result.positions[name]?.position),
  );
  if (missingObjects.length) {
    throw new Error(
      `Swiss Ephemeris did not calculate: ${missingObjects.join(", ")}.`,
    );
  }

  const natal = nestedNatalMetadata(request);
  const zodiacSystem = request.selectedZodiacSystem || "Tropical";
  const ayanamsa = Number(result.ayanamsa || 0);
  let zodiacBoundaries = null;
  if (isIauConstellationSystem(zodiacSystem)) {
    zodiacBoundaries = (await getIauEclipticBoundaries(Number(result.julianDay)))
      .map((entry) => ({
        ...entry,
        boundary: ((entry.boundary - ayanamsa) % 360 + 360) % 360,
      }))
      .sort((left, right) => left.boundary - right.boundary);
  } else if (isEqual13System(zodiacSystem)) {
    zodiacBoundaries = EQUAL_13_BOUNDARIES;
  }
  const meta = {
    name: request.name || natal.name || "Chart",
    day: request.day || natal.day,
    month: request.month || natal.month,
    year: request.year || natal.year,
    hour: Number(request.hour ?? natal.hour ?? 0),
    minute: Number(request.minute ?? natal.minute ?? 0),
    hourString: String(request.hour ?? natal.hour ?? "00").padStart(2, "0"),
    minuteString: String(request.minute ?? natal.minute ?? "00").padStart(2, "0"),
    utcOffset: result.utcOffset ?? request.utcOffset ?? natal.utcOffset,
    utcMode: result.utcMode || request.utcMode || "manual",
    ...(result.timezone ? { timezone: result.timezone } : {}),
    location: request.location || natal.location || "",
    lat: request.lat,
    long: request.long,
    zodiacSystem,
    ...(zodiacBoundaries ? { zodiacBoundaries } : {}),
    ayanamsaSystem: request.selectedAyanamsaSystem || "Tropical",
    customAyanamsaValue: request.customAyanamsaValue,
    houseSystem: request.selectedHouseSystem || "Placidus",
    coordinateSystem: request.selectedCoordinateSystem || "Geocentric",
  };
  const houses = result.houseCusps.map((cusp) => ({
    name: `House ${cusp.house}`,
    position: cusp.position,
    tropical: ((cusp.position + ayanamsa) % 360 + 360) % 360,
    sign: signForPosition(cusp.position, zodiacSystem, zodiacBoundaries),
  }));
  const data = [meta, ...houses];

  for (const [name, value] of Object.entries(result.positions)) {
    if (!Number.isFinite(value?.position)) continue;
    const position = ((value.position % 360) + 360) % 360;
    const planet = {
      name,
      position,
      tropical: ((position + ayanamsa) % 360 + 360) % 360,
      sign: signForPosition(position, zodiacSystem, zodiacBoundaries),
      eclipticLatitude: value.eclipticLatitude,
      house: findHouse(position, result.houseCusps),
      retrograde: value.retrograde ?? (Number(value.speed) < 0),
      speed: value.speed,
      source: value.source || "Swiss Ephemeris",
      ...(value.isCustomPoint === true
        ? {
            isCustomPoint: true,
            asteroidNum: value.asteroidNum,
            asteroidName: value.asteroidName,
            displayLabel: value.displayLabel,
          }
        : {}),
    };
    data.push(planet);
    if (name === "Ascendant Symbol") {
      data.push({ ...planet, name: "Ascendant" });
    }
  }

  attachAspects(data, request);
  if (request.fixedStars === true) {
    if (!Array.isArray(result.fixedStars)) {
      throw new Error("Swiss Ephemeris did not return the requested fixed stars.");
    }
    for (const star of result.fixedStars) {
      if (!Number.isFinite(star.position)) {
        throw new Error(`Swiss Ephemeris returned an invalid position for ${star.name}.`);
      }
      const position = ((star.position % 360) + 360) % 360;
      data.push({
        name: star.name,
        position,
        tropical: ((position + ayanamsa) % 360 + 360) % 360,
        sign: signForPosition(position, zodiacSystem, zodiacBoundaries),
        eclipticLatitude: star.eclipticLatitude,
        magnitude: star.magnitude,
        speed: star.speed,
        retrograde: Number(star.speed) < 0,
        source: star.source || "Swiss Ephemeris fixed-star catalog",
        isFixedStar: true,
      });
    }
  }
  return data;
}

async function postSwissRequest(payload) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, SWISS_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(swissEphemerisUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    return { response, responseBody: await response.text() };
  } catch (error) {
    if (timedOut) {
      throw new Error("Swiss Ephemeris calculation timed out after 60 seconds. Try again.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function requestSwissChart(request, form = null) {
  const payload = await prepareSwissRequest(request, form);
  const { response, responseBody } = await postSwissRequest(payload);
  let result;
  try {
    result = responseBody ? JSON.parse(responseBody) : null;
  } catch (error) {
    throw new Error(
      `Swiss Ephemeris returned an invalid response (${response.status}): ${error.message}`,
    );
  }
  if (!result || typeof result !== "object") {
    throw new Error(
      `Swiss Ephemeris returned an empty response (${response.status}).`,
    );
  }
  if (!response.ok || result.success === false) {
    throw new Error(result.error || `Swiss Ephemeris request failed (${response.status}).`);
  }
  return chartDataFromSwiss(result, payload);
}

export async function requestSwissReturnDate(request, form = null) {
  const payload = await prepareSwissRequest(request, form);
  const { response, responseBody } = await postSwissRequest({
    ...payload,
    action: "find-return-date",
  });
  let result;
  try {
    result = responseBody ? JSON.parse(responseBody) : null;
  } catch (error) {
    throw new Error(
      `Swiss Ephemeris returned an invalid return-date response (${response.status}): ${error.message}`,
    );
  }
  if (!result || typeof result !== "object") {
    throw new Error(
      `Swiss Ephemeris returned an empty return-date response (${response.status}).`,
    );
  }
  if (!response.ok || result.success !== true) {
    throw new Error(
      result.error ||
        `Swiss Ephemeris return-date request failed (${response.status}).`,
    );
  }
  return result;
}

export function setupLocalLocationFields() {
  const forms = Array.from(document.querySelectorAll(".form")).filter((form) =>
    form.querySelector('.location[name="location"]'),
  );

  function setStatus(status, message, state = "info") {
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state;
  }

  function ensureUtcOffsetOptions(fields) {
    const input = fields.querySelector('input[name="utcOffset"]');
    if (!input) return;
    const select = document.createElement("select");
    select.id = input.id;
    select.name = input.name;
    select.className = input.className;
    select.setAttribute("aria-label", input.getAttribute("aria-label") || "Manual UTC offset");
    const currentValue = Number(input.value);
    for (let quarterHours = -56; quarterHours <= 56; quarterHours += 1) {
      const value = quarterHours / 4;
      const option = document.createElement("option");
      option.value = String(value);
      option.textContent = formatUtcOffset(value);
      select.appendChild(option);
    }
    select.value = Number.isFinite(currentValue) && currentValue >= -14 && currentValue <= 14
      ? String(currentValue)
      : "0";
    input.replaceWith(select);
  }

  function ensureUtcModeControl(fields, form) {
    let mode = fields.querySelector('[name="utcMode"]');
    if (!mode || mode.tagName === "SELECT") {
      const hidden = document.createElement("input");
      hidden.type = "hidden";
      hidden.name = "utcMode";
      mode?.replaceWith(hidden);
      mode = hidden;
    }
    let toggle = fields.querySelector('[name="autoUtc"]');
    if (!toggle) {
      const label = document.createElement("label");
      label.className = "auto-utc-option";
      const prefix = form.id || "chart";
      label.htmlFor = `${prefix}-auto-utc`;
      label.innerHTML = `<input id="${prefix}-auto-utc" name="autoUtc" type="checkbox" value="true" /><span><strong>Use automatic UTC</strong><small>Resolve the historical time zone and daylight-saving rules from these coordinates.</small></span>`;
      const offsetInput = fields.querySelector('[name="utcOffset"]');
      const offsetField = offsetInput?.closest(".local-coordinate-field");
      if (offsetField) offsetField.insertAdjacentElement("afterend", label);
      else fields.insertBefore(label, mode);
      toggle = label.querySelector('[name="autoUtc"]');
    }
    if (!toggle.dataset.initialized) {
      toggle.checked = form.id === "natalForm";
      toggle.dataset.initialized = "true";
    }
    const offset = fields.querySelector('[name="utcOffset"]');
    const syncMode = () => {
      mode.value = toggle.checked ? "auto" : "manual";
      if (offset) offset.disabled = toggle.checked;
      updateOffsetPreview(fields);
    };
    toggle.addEventListener("change", syncMode);
    if (!form.dataset.utcModeResetBound) {
      form.dataset.utcModeResetBound = "true";
      form.addEventListener("reset", () => setTimeout(syncMode, 0));
    }
    syncMode();
  }

  function updateOffsetPreview(fields) {
    const output = fields.querySelector(".utc-offset-preview");
    if (!output) return;
    if (fields.querySelector('[name="autoUtc"]')?.checked) {
      output.textContent = "Automatic UTC will use the coordinate's historical time zone and daylight-saving rules.";
      return;
    }
    const offset = Number(fields.querySelector('[name="utcOffset"]')?.value);
    output.textContent = Number.isFinite(offset) ? `Selected offset: ${formatUtcOffset(offset)}` : "Select a valid UTC offset";
  }

  function setCoordinates(fields, record) {
    const latitudeInput = fields.querySelector('[name="lat"]');
    const longitudeInput = fields.querySelector('[name="long"]');
    if (!latitudeInput || !longitudeInput) return;
    latitudeInput.value = Number(record.lat).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
    longitudeInput.value = Number(record.lon ?? record.long).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
    latitudeInput.dataset.manual = "false";
    longitudeInput.dataset.manual = "false";
  }

  async function resolveLocation(form, locationInput, fields, options = {}) {
    const resolutionToken = (Number(locationInput.dataset.resolutionToken) || 0) + 1;
    locationInput.dataset.resolutionToken = String(resolutionToken);
    const location = locationInput.value.trim();
    const status = fields.querySelector(".location-resolution-status");
    if (!location) {
      setStatus(status, "Type or select a city first.", "error");
      return null;
    }
    setStatus(status, "Finding city coordinates…", "loading");
    const submitButtons = Array.from(form.querySelectorAll('button[type="submit"]'));
    const priorDisabled = submitButtons.map((button) => button.disabled);
    submitButtons.forEach((button) => { button.disabled = true; });
    try {
      const customCoordinates = parseCustomCoordinates(location);
      if (customCoordinates) {
        const latInput = fields.querySelector('[name="lat"]');
        const longInput = fields.querySelector('[name="long"]');
        const coordinateToggle = fields.querySelector('[name="useCoordinates"]');
        latInput.value = formatCoordinateValue(customCoordinates.lat);
        longInput.value = formatCoordinateValue(customCoordinates.long);
        latInput.dataset.manual = "true";
        longInput.dataset.manual = "true";
        if (coordinateToggle) coordinateToggle.checked = true;
        locationInput.value = coordinateLocationLabel(customCoordinates.lat, customCoordinates.long);
        locationInput.dataset.coordinateMode = "true";
        updateOffsetPreview(fields);
        setStatus(status, "Coordinates loaded.", "success");
        return { ...customCoordinates };
      }
      let cities = [];
      try { cities = await getCityRecords(); } catch (_) { cities = []; }
      if (resolutionToken !== Number(locationInput.dataset.resolutionToken)) return null;
      let record = findCity(location, cities);
      if (!record) record = await fetchOnlineGeocoding(location);
      if (resolutionToken !== Number(locationInput.dataset.resolutionToken)) return null;
      if (!record) {
        throw new Error("City not found. Check the name/country, try Search city online, or enter coordinates manually.");
      }
      const coordinateToggle = fields.querySelector('[name="useCoordinates"]');
      if (coordinateToggle) coordinateToggle.checked = false;
      delete locationInput.dataset.coordinateMode;
      delete locationInput.dataset.locationBeforeCoordinates;
      setCoordinates(fields, record);
      updateOffsetPreview(fields);
      const sourceText = record.source === "online-geocoder" ? "online city database" : "local city database";
      setStatus(status, `Coordinates filled from the ${sourceText}. Use automatic UTC or select a manual offset below.`, "success");
      return record;
    } catch (error) {
      if (resolutionToken !== Number(locationInput.dataset.resolutionToken)) return null;
      setStatus(status, error.message || "Could not resolve this location.", "error");
      return null;
    } finally {
      submitButtons.forEach((button, index) => { button.disabled = priorDisabled[index]; });
    }
  }

  function addCurrentLocationButton(form, fields, locationInput, activateCoordinateMode) {
    const actions = fields.querySelector(".location-actions");
    if (!actions || actions.dataset.bound === "true") return;
    actions.dataset.bound = "true";
    const searchButton = actions.querySelector(".search-location-button");
    const currentButton = actions.querySelector(".use-browser-location");
    const status = fields.querySelector(".location-resolution-status");

    searchButton?.addEventListener("click", () => {
      resolveLocation(form, locationInput, fields);
    });

    currentButton?.addEventListener("click", () => {
      if (!navigator.geolocation) {
        setStatus(status, "This browser does not provide geolocation. Enter coordinates manually.", "error");
        return;
      }
      setStatus(status, "Waiting for location permission…", "loading");
      currentButton.disabled = true;
      navigator.geolocation.getCurrentPosition(async (position) => {
        const lat = Number(position.coords.latitude.toFixed(6));
        const lon = Number(position.coords.longitude.toFixed(6));
        const latInput = fields.querySelector('[name="lat"]');
        const lonInput = fields.querySelector('[name="long"]');
        latInput.value = lat;
        lonInput.value = lon;
        latInput.dataset.manual = "false";
        lonInput.dataset.manual = "false";
        try {
          if (typeof activateCoordinateMode === "function") await activateCoordinateMode();
          else {
            locationInput.value = coordinateLocationLabel(lat, lon);
            updateOffsetPreview(fields);
            setStatus(status, `Coordinates added: ${lat}, ${lon}. Automatic UTC will use these coordinates.`, "success");
          }
        } catch (error) {
          setStatus(status, error.message || "Coordinates were added, but the location mode could not be activated.", "warning");
        } finally {
          currentButton.disabled = false;
        }
      }, (error) => {
        const message = error.code === 1
          ? "Location permission was denied. Allow location access in the browser or enter coordinates manually."
          : error.code === 2
            ? "The device could not determine your location. Enter coordinates manually."
            : "Location request timed out. Try again or enter coordinates manually.";
        setStatus(status, message, "error");
        currentButton.disabled = false;
      }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
    });
  }

  forms.forEach((form) => {
    const locationInput = form.querySelector('[name="location"]');
    let fields = form.querySelector(".local-chart-location-fields");
    if (!fields) {
      const prefix = form.id || "chart";
      fields = document.createElement("div");
      fields.className = "local-chart-location-fields";
      fields.innerHTML = `
        <div class="local-coordinate-field">
          <label for="${prefix}-latitude">Latitude (decimal degrees)</label>
          <input id="${prefix}-latitude" name="lat" type="number" min="-90" max="90" step="any" placeholder="e.g. -23.550520" />
        </div>
        <div class="local-coordinate-field">
          <label for="${prefix}-longitude">Longitude (decimal degrees)</label>
          <input id="${prefix}-longitude" name="long" type="number" min="-180" max="180" step="any" placeholder="e.g. -46.633308" />
        </div>
        <div class="local-coordinate-field">
          <label for="${prefix}-utc-offset">Manual UTC offset</label>
          <input id="${prefix}-utc-offset" name="utcOffset" type="number" min="-14" max="14" step="0.25" value="0" />
        </div>
        <div class="location-actions">
          <button type="button" class="search-location-button">Search city / fill automatically</button>
          <button type="button" class="use-browser-location">Use my current location</button>
          <output class="utc-offset-preview" aria-live="polite">Select the UTC offset manually.</output>
        </div>
        <input type="hidden" name="utcMode" value="manual" />
        <div class="location-resolution-status" role="status" aria-live="polite"></div>`;
      const suggestions = locationInput.nextElementSibling;
      if (suggestions?.classList.contains("suggestions-box")) {
        suggestions.insertAdjacentElement("afterend", fields);
      } else {
        locationInput.insertAdjacentElement("afterend", fields);
      }
    }

    fields.querySelectorAll('[name="timezone"], .local-timezone-field, .utc-mode-help').forEach((element) => element.remove());
    fields.querySelector('select[name="utcMode"]')?.remove();
    if (!fields.querySelector(".location-actions")) {
      const actions = document.createElement("div");
      actions.className = "location-actions";
      actions.innerHTML = `<button type="button" class="search-location-button">Search city / fill automatically</button><button type="button" class="use-browser-location">Use my current location</button><output class="utc-offset-preview" aria-live="polite">Select the UTC offset manually.</output>`;
      fields.appendChild(actions);
    }
    if (!fields.querySelector(".location-resolution-status")) {
      const status = document.createElement("div");
      status.className = "location-resolution-status";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      fields.appendChild(status);
    }
    if (!fields.querySelector('[name="useCoordinates"]')) {
      const prefix = form.id || "chart";
      const coordinateControl = document.createElement("div");
      coordinateControl.className = "coordinate-mode-control";
      coordinateControl.innerHTML = `
        <label class="coordinate-mode-option" for="${prefix}-use-coordinates">
          <input id="${prefix}-use-coordinates" name="useCoordinates" type="checkbox" value="true" />
          <span><strong>Use coordinates instead of city</strong><small>When enabled, the first location field is filled automatically with the latitude and longitude.</small></span>
        </label>
        <button type="button" class="apply-coordinates-button">Use these coordinates</button>`;
      const actions = fields.querySelector(".location-actions");
      if (actions) fields.insertBefore(coordinateControl, actions);
      else fields.appendChild(coordinateControl);
    }
    if (!fields.querySelector(".utc-offset-preview")) {
      const output = document.createElement("output");
      output.className = "utc-offset-preview";
      fields.querySelector(".location-actions")?.appendChild(output);
    }

    const latitudeInput = fields.querySelector('[name="lat"]');
    const longitudeInput = fields.querySelector('[name="long"]');
    ensureUtcOffsetOptions(fields);
    ensureUtcModeControl(fields, form);
    const utcOffset = fields.querySelector('[name="utcOffset"]');
    if (!latitudeInput || !longitudeInput || !utcOffset) return;
    if (!locationInput.placeholder) locationInput.placeholder = "City, region/state, country";
    const resolutionStatus = fields.querySelector(".location-resolution-status");
    if (resolutionStatus && !resolutionStatus.textContent.trim()) {
      setStatus(resolutionStatus, "Select a city to fill coordinates, or enter coordinates directly.", "info");
    }
    const useCoordinatesToggle = fields.querySelector('[name="useCoordinates"]');
    const useCoordinatesButton = fields.querySelector(".apply-coordinates-button");

    async function applyCoordinateMode() {
      const rawLat = latitudeInput.value.trim();
      const rawLong = longitudeInput.value.trim();
      const lat = Number(rawLat);
      const longitude = Number(rawLong);
      if (!rawLat || !rawLong || !Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
        setStatus(resolutionStatus, "Enter a valid latitude (-90 to 90) and longitude (-180 to 180), or use the current-location button.", "error");
        return false;
      }
      if (!isCoordinateLocationLabel(locationInput.value)) {
        locationInput.dataset.locationBeforeCoordinates = locationInput.value || "";
      }
      latitudeInput.dataset.manual = "true";
      longitudeInput.dataset.manual = "true";
      if (useCoordinatesToggle) useCoordinatesToggle.checked = true;
      locationInput.value = coordinateLocationLabel(lat, longitude);
      locationInput.dataset.coordinateMode = "true";
      document.querySelectorAll(".suggestions-box").forEach((box) => { box.style.display = "none"; });

      updateOffsetPreview(fields);
      setStatus(resolutionStatus, `Using coordinates directly: ${formatCoordinateValue(lat)}, ${formatCoordinateValue(longitude)}. No city name is required.`, "success");
      return true;
    }

    function disableCoordinateMode() {
      if (isCoordinateLocationLabel(locationInput.value)) {
        locationInput.value = locationInput.dataset.locationBeforeCoordinates || "";
      }
      delete locationInput.dataset.locationBeforeCoordinates;
      delete locationInput.dataset.coordinateMode;
      latitudeInput.dataset.manual = "false";
      longitudeInput.dataset.manual = "false";
      updateOffsetPreview(fields);
      setStatus(resolutionStatus, locationInput.value.trim()
        ? "City mode is active. Choose a city to refresh coordinates automatically."
        : "City mode is active. Enter or select a city, or turn coordinate mode back on.", "info");
    }

    useCoordinatesToggle?.addEventListener("change", async () => {
      if (useCoordinatesToggle.checked) await applyCoordinateMode();
      else disableCoordinateMode();
    });
    useCoordinatesButton?.addEventListener("click", () => {
      if (useCoordinatesToggle) {
        useCoordinatesToggle.checked = true;
        useCoordinatesToggle.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        applyCoordinateMode();
      }
    });
    [latitudeInput, longitudeInput].forEach((input) => {
      input.addEventListener("change", () => {
        if (useCoordinatesToggle?.checked) applyCoordinateMode();
      });
    });

    utcOffset.addEventListener("input", () => updateOffsetPreview(fields));
    utcOffset.addEventListener("change", () => updateOffsetPreview(fields));

    locationInput.addEventListener("input", () => {
      delete locationInput.dataset.lastResolvedLocation;
    });

    locationInput.addEventListener("change", async () => {
      const currentValue = locationInput.value.trim();
      locationInput.dataset.lastResolvedLocation = currentValue;
      locationInput.dataset.resolutionToken = String((Number(locationInput.dataset.resolutionToken) || 0) + 1);
      const enteredCoordinates = parseCustomCoordinates(currentValue);
      if (enteredCoordinates) {
        latitudeInput.value = formatCoordinateValue(enteredCoordinates.lat);
        longitudeInput.value = formatCoordinateValue(enteredCoordinates.long);
        latitudeInput.dataset.manual = "true";
        longitudeInput.dataset.manual = "true";
        if (useCoordinatesToggle) useCoordinatesToggle.checked = true;
        await applyCoordinateMode();
        return;
      }

      // City entry/selection is authoritative, even if a previous coordinate mode was active.
      if (useCoordinatesToggle) useCoordinatesToggle.checked = false;
      delete locationInput.dataset.coordinateMode;
      delete locationInput.dataset.locationBeforeCoordinates;
      await resolveLocation(form, locationInput, fields);
    });

    // Resolve hand-typed cities on blur as well as autocomplete selection, but never
    // let a stale coordinate toggle override the city just entered.
    locationInput.addEventListener("blur", () => {
      const value = locationInput.value.trim();
      if (value && !parseCustomCoordinates(value) && value !== locationInput.dataset.lastResolvedLocation) {
        locationInput.dataset.lastResolvedLocation = value;
        if (useCoordinatesToggle) useCoordinatesToggle.checked = false;
        resolveLocation(form, locationInput, fields).then((record) => {
          if (record) locationInput.dataset.lastResolvedLocation = value;
        });
      }
    });

    [latitudeInput, longitudeInput].forEach((input) => {
      input.addEventListener("input", () => {
        input.dataset.manual = "true";
        updateOffsetPreview(fields);
      });
      input.addEventListener("change", () => {
        // Editing the coordinate fields immediately mirrors the numeric pair in the
        // upper location field, replacing the city name and enabling coordinate mode.
        if (latitudeInput.value.trim() && longitudeInput.value.trim()) {
          applyCoordinateMode();
        }
      });
    });

    addCurrentLocationButton(form, fields, locationInput, async () => {
      if (useCoordinatesToggle) useCoordinatesToggle.checked = true;
      await applyCoordinateMode();
    });
    updateOffsetPreview(fields);
    // Restore/initialize saved city fields as soon as this form is ready. This also
    // repairs older saved forms where a city was present but coordinates were blank.
    if (locationInput.value.trim()) {
      const savedCoordinates = parseCustomCoordinates(locationInput.value);
      if (savedCoordinates) {
        latitudeInput.value = formatCoordinateValue(savedCoordinates.lat);
        longitudeInput.value = formatCoordinateValue(savedCoordinates.long);
        locationInput.value = coordinateLocationLabel(savedCoordinates.lat, savedCoordinates.long);
        locationInput.dataset.coordinateMode = "true";
        latitudeInput.dataset.manual = "true";
        longitudeInput.dataset.manual = "true";
        if (useCoordinatesToggle) useCoordinatesToggle.checked = true;
      } else if (!latitudeInput.value.trim() || !longitudeInput.value.trim()) {
        locationInput.dataset.lastResolvedLocation = locationInput.value.trim();
        resolveLocation(form, locationInput, fields);
      }
    }
  });
}

document.addEventListener("DOMContentLoaded", setupLocalLocationFields);
