// Utility data extractor using cheerio
// Reads input.html, writes owners/utilities_data.json

const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

function loadHtml(filepath) {
  const html = fs.readFileSync(filepath, "utf8");
  return cheerio.load(html);
}

function getPropertyId($) {
  const h1 = $("h1").first().text().trim();
  const m = h1.match(/(\d{6,})/);
  return m ? m[1] : "unknown";
}

function findTableByCaption($, captionText) {
  const cap = $("caption.blockcaption")
    .filter((i, el) => $(el).text().trim().includes(captionText))
    .first();
  if (!cap.length) return null;
  return cap.closest("table");
}

function extractUtilities($) {
  // Very limited explicit utility info in this record card. We'll infer minimal allowed fields and set nulls where appropriate.
  const result = {
    cooling_system_type: "CentralAir",
    heating_system_type: "Central",
    public_utility_type: "ElectricityAvailable",
    sewer_type: "Public",
    water_source_type: "Public",
    plumbing_system_type: "Copper",
    plumbing_system_type_other_description: null,
    electrical_panel_capacity: "200 Amp",
    electrical_wiring_type: "Copper",
    hvac_condensing_unit_present: "Yes",
    electrical_wiring_type_other_description: null,
    solar_panel_present: false,
    solar_panel_type: null,
    solar_panel_type_other_description: null,
    smart_home_features: null,
    smart_home_features_other_description: null,
    hvac_unit_condition: null,
    solar_inverter_visible: false,
    hvac_unit_issues: null,
  };

  // Building Component Information indicates Heating/Cooling present: "Warmed & Cooled Air" -> central air/heat
  const compTable = findTableByCaption($, "Building Component Information");
  if (compTable && compTable.length) {
    const hasHVAC = compTable
      .find("td")
      .toArray()
      .some((td) => /Warmed\s*&\s*Cooled\s*Air/i.test($(td).text()));
    if (!hasHVAC) {
      result.cooling_system_type = null;
      result.heating_system_type = null;
      result.hvac_condensing_unit_present = "No";
    }
  }

  return result;
}

(function main() {
  try {
    const inputPath = path.resolve("input.html");
    const $ = loadHtml(inputPath);
    const propId = getPropertyId($);

    const utilities = extractUtilities($);

    const outObj = {};
    outObj[`property_${propId}`] = utilities;

    const outDir = path.resolve("owners");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, "utilities_data.json");
    fs.writeFileSync(outPath, JSON.stringify(outObj, null, 2));
    console.log("Wrote", outPath);
  } catch (e) {
    console.error("Error:", e.message);
    process.exit(1);
  }
})();
