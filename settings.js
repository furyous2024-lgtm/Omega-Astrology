"use strict";

function bindLabelsToInput(containerSelector) {
  document.querySelectorAll(`${containerSelector} label`).forEach((label, index) => {
    if (label.htmlFor) return;

    let input = label.querySelector("input, select, textarea");
    if (!input) {
      const previous = label.previousElementSibling;
      const next = label.nextElementSibling;
      if (previous && /^(INPUT|SELECT|TEXTAREA)$/.test(previous.tagName)) {
        input = previous;
      } else if (next && /^(INPUT|SELECT|TEXTAREA)$/.test(next.tagName)) {
        input = next;
      }
    }

    if (!input) return;

    if (!input.id) {
      const safeValue = (input.value || input.name || "input")
        .toString()
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, "-");
      input.id = `${containerSelector.replace(/[^a-zA-Z0-9]/g, "")}-${index}-${safeValue}`;
    }

    label.htmlFor = input.id;
    label.style.cursor = "pointer";
  });
}

window.bindLabelsToInput = bindLabelsToInput;

document.addEventListener("DOMContentLoaded", function () {
  [
    "#planet-settings",
    "#graph-planet-settings",
    "#graph-aspect-settings",
    "#graph-type-settings",
    "#system-settings",
    "#customPointsList",
    ".degree-settings",
    ".ascendant-override",
  ].forEach(bindLabelsToInput);

  const ayanamsaSelect = document.querySelector(
    '#system-settings select[name="ayanamsaSystem"]',
  );
  const customLabel = document.getElementById("customAyanamsaLabel");
  const customInput = document.getElementById("customAyanamsaValue");
  const customDegreesLabel = document.getElementById("customAyanamsaDegreesLabel");
  const customDegreesInput = document.getElementById("customAyanamsaDegreesValue");
  const customDmsGroup = document.getElementById("customAyanamsaDmsGroup");
  const customJulianLabel = document.getElementById("customAyanamsaJulianLabel");
  const customJulianInput = document.getElementById("customAyanamsaJulianDate");

  function syncCustomAyanamsaField() {
    if (!ayanamsaSelect) return;
    const selected = ayanamsaSelect.value;

    if (customLabel && customInput) {
      const isCustom1 = selected === "Ayanamsa Personalizado 1";
      const isCustom2 = selected === "Ayanamsa Personalizado 2";
      const needsCustomValue = isCustom1 || isCustom2;
      customLabel.textContent = isCustom2
        ? "Valor do ayanamsa (°):"
        : "Referência J2000 (°):";
      customLabel.hidden = !needsCustomValue;
      customInput.hidden = !needsCustomValue;
      customInput.disabled = !needsCustomValue;
    }
    if (customDegreesLabel && customDegreesInput) {
      const isCustom3 = selected === "Ayanamsa Personalizado 3";
      customDegreesLabel.hidden = !isCustom3;
      customDegreesInput.hidden = !isCustom3;
      customDegreesInput.disabled = !isCustom3;
    }
    if (customDmsGroup) {
      const isCustom4 = selected === "Ayanamsa Personalizado 4";
      customDmsGroup.hidden = !isCustom4;
      customDmsGroup.querySelectorAll("input").forEach((input) => {
        input.disabled = !isCustom4;
      });
    }
    if (customJulianLabel && customJulianInput) {
      const isCustom5 = selected === "Ayanamsa Personalizado 5";
      customJulianLabel.hidden = !isCustom5;
      customJulianInput.hidden = !isCustom5;
      customJulianInput.disabled = !isCustom5;
    }
  }

  ayanamsaSelect?.addEventListener("change", syncCustomAyanamsaField);
  syncCustomAyanamsaField();
  window.syncCustomAyanamsaField = syncCustomAyanamsaField;
});
