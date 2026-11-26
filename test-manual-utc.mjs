import assert from "node:assert/strict";

globalThis.document = {
  addEventListener() {},
  getElementById() { return null; },
  querySelector() { return null; },
};
globalThis.window = {};

const { prepareSwissRequest, requestSwissReturnDate } = await import("./js/localSwiss.js");
const fields = {
  location: { value: "-23.5505, -46.6333" },
  lat: { value: "-23.5505", dataset: { manual: "true" } },
  long: { value: "-46.6333", dataset: { manual: "true" } },
  utcOffset: { value: "-3.5" },
  autoUtc: { checked: false },
  useCoordinates: { checked: false },
};
const preview = { textContent: "" };
const locationFields = {
  querySelector(selector) {
    return selector === ".utc-offset-preview" ? preview : null;
  },
};
const form = {
  querySelector(selector) {
    if (selector === ".local-chart-location-fields") return locationFields;
    const name = selector.match(/\[name="([^"]+)"\]/)?.[1];
    return fields[name] || null;
  },
};

const request = await prepareSwissRequest({
  location: fields.location.value,
  lat: -23.5505,
  long: -46.6333,
  utcOffset: -4,
  utcMode: "manual",
}, form);

assert.equal(request.utcOffset, -3.5);
assert.equal(request.utcMode, "manual");
assert.equal("timezone" in request, false);

fields.autoUtc.checked = true;
const automaticRequest = await prepareSwissRequest({
  location: fields.location.value,
  lat: -23.5505,
  long: -46.6333,
  utcOffset: -4,
  utcMode: "manual",
  timezone: "America/New_York",
}, form);
assert.equal(automaticRequest.utcMode, "auto");
assert.equal("timezone" in automaticRequest, false);
globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  async text() {
    return JSON.stringify({
      success: true,
      utcOffset: -4,
      timezone: "America/New_York",
    });
  },
});
const returnDate = await requestSwissReturnDate({
  year: 2021,
  month: 7,
  day: 15,
  hour: 12,
  minute: 0,
  lat: 40.7128,
  long: -74.006,
  location: fields.location.value,
}, form);
assert.equal(returnDate.utcOffset, -4);
assert.equal(
  preview.textContent,
  "Automatic UTC offset: UTC−04:00 (America/New_York)",
);
fields.autoUtc.checked = false;

const savedDocuments = [];
const birthCharts = {
  async get() {
    return {
      docs: savedDocuments.map((data, index) => ({
        id: String(index),
        data: () => data,
      })),
    };
  },
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
  utcMode: "manual",
  location: request.location,
});

assert.equal(savedDocuments.length, 1);
assert.equal(savedDocuments[0].utc, -3.5);
assert.equal(savedDocuments[0].utcMode, "manual");
assert.equal("timezone" in savedDocuments[0], false);

await window.TrueSkyFirebaseCharts.save({
  name: "Manual UTC test",
  year: 2000,
  month: 1,
  day: 1,
  hour: 12,
  minute: 0,
  lat: -23.5505,
  long: -46.6333,
  utc: -3,
  utcMode: "auto",
  timezone: "America/Sao_Paulo",
  location: request.location,
});
assert.equal(savedDocuments[1].utc, -3);
assert.equal(savedDocuments[1].utcMode, "auto");
assert.equal(savedDocuments[1].timezone, "America/Sao_Paulo");

console.log("Manual/automatic UTC selection and Firebase save passed.");
