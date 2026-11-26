import assert from "node:assert/strict";

globalThis.document = {
  addEventListener() {},
  getElementById() { return null; },
  querySelector() { return null; },
};
globalThis.window = {};

const { prepareSwissRequest } = await import("./js/localSwiss.js");
const fields = {
  location: { value: "-23.5505, -46.6333" },
  lat: { value: "-23.5505", dataset: { manual: "true" } },
  long: { value: "-46.6333", dataset: { manual: "true" } },
  utcOffset: { value: "-3.5" },
  useCoordinates: { checked: false },
};
const form = {
  querySelector(selector) {
    const name = selector.match(/\[name="([^"]+)"\]/)?.[1];
    return fields[name] || null;
  },
};

const request = await prepareSwissRequest({
  location: fields.location.value,
  lat: -23.5505,
  long: -46.6333,
  utcOffset: -4,
  utcMode: "auto",
  timezone: "America/New_York",
}, form);

assert.equal(request.utcOffset, -3.5);
assert.equal(request.utcMode, "manual");
assert.equal("timezone" in request, false);

const savedDocuments = [];
const birthCharts = {
  async get() { return { docs: [] }; },
  doc() {
    return { async set(data) { savedDocuments.push(data); } };
  },
};
const db = {
  collection() {
    return {
      doc() {
        return { collection() { return birthCharts; } };
      },
    };
  },
};
function firestore() { return db; }
firestore.FieldValue = { serverTimestamp: () => "timestamp" };
window.firebase = {
  apps: [{}],
  auth: () => ({ currentUser: { uid: "test-user" } }),
  firestore,
};
await import("./js/firebase-birth-charts.js");

await window.TrueSkyFirebaseCharts.save({
  name: "Manual UTC test",
  year: 2000,
  month: 1,
  day: 1,
  hour: 12,
  minute: 0,
  lat: -23.5505,
  long: -46.6333,
  utc: request.utcOffset,
  utcMode: "auto",
  timezone: "America/New_York",
  location: request.location,
});

assert.equal(savedDocuments.length, 1);
assert.equal(savedDocuments[0].utc, -3.5);
assert.equal(savedDocuments[0].utcMode, "manual");
assert.equal("timezone" in savedDocuments[0], false);

console.log("Manual UTC calculation and Firebase save passed.");
