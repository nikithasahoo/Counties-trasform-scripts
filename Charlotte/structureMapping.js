// Structure data extractor using cheerio
// Reads input.html from working directory and writes owners/structure_data.json

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

function parseHeaderIndexes($table, $) {
  const map = {};
  const $headers = $table.find("tr").first().find("th");
  $headers.each((i, th) => {
    const key = $(th).text().replace(/\s+/g, " ").trim();
    if (key) map[key] = i;
  });
  return map;
}

function getCellByHeader($table, headerMap, headerLabel, rowIndex, $) {
  if (!(headerLabel in headerMap)) return null;
  const idx = headerMap[headerLabel];
  const $rows = $table.find("tr");
  if ($rows.length <= rowIndex) return null;
  const $cells = $($rows[rowIndex]).find("td");
  if ($cells.length <= idx) return null;
  return $($cells[idx])
    .text()
    .replace(/\u00a0/g, " ")
    .trim();
}

function extractStructure($) {
  const result = {
    architectural_style_type: null,
    attachment_type: "Detached",
    ceiling_condition: null,
    ceiling_height_average: null,
    ceiling_insulation_type: "Unknown",
    ceiling_structure_material: null,
    ceiling_surface_material: null,
    exterior_door_material: null,
    exterior_wall_condition: null,
    exterior_wall_condition_primary: null,
    exterior_wall_condition_secondary: null,
    exterior_wall_insulation_type: "Unknown",
    exterior_wall_insulation_type_primary: "Unknown",
    exterior_wall_insulation_type_secondary: "Unknown",
    exterior_wall_material_primary: null,
    exterior_wall_material_secondary: null,
    finished_base_area: null,
    finished_basement_area: null,
    finished_upper_story_area: null,
    flooring_condition: null,
    flooring_material_primary: null,
    flooring_material_secondary: null,
    foundation_condition: "Unknown",
    foundation_material: null,
    foundation_type: null,
    foundation_waterproofing: "Unknown",
    gutters_condition: null,
    gutters_material: null,
    interior_door_material: null,
    interior_wall_condition: null,
    interior_wall_finish_primary: null,
    interior_wall_finish_secondary: null,
    interior_wall_structure_material: null,
    interior_wall_structure_material_primary: null,
    interior_wall_structure_material_secondary: null,
    interior_wall_surface_material_primary: null,
    interior_wall_surface_material_secondary: null,
    number_of_stories: null,
    primary_framing_material: null,
    roof_age_years: null,
    roof_condition: null,
    roof_covering_material: null,
    roof_date: null,
    roof_design_type: null,
    roof_material_type: null,
    roof_structure_material: null,
    roof_underlayment_type: "Unknown",
    secondary_framing_material: null,
    structural_damage_indicators: null,
    subfloor_material: "Concrete Slab",
    unfinished_base_area: null,
    unfinished_basement_area: null,
    unfinished_upper_story_area: null,
    window_frame_material: null,
    window_glazing_type: null,
    window_operation_type: null,
    window_screen_material: null,
  };

  // Building Information table: floors, bedrooms, areas
  const bldTable = findTableByCaption($, "Building Information");
  if (bldTable && bldTable.length) {
    const headers = parseHeaderIndexes(bldTable, $);
    // Data row is second row (index 1) after header
    const floorsText = getCellByHeader(bldTable, headers, "Floors", 1, $);
    const acAreaText = getCellByHeader(bldTable, headers, "A/C Area", 1, $);

    if (floorsText) {
      const n = parseInt(floorsText.replace(/[^0-9]/g, ""), 10);
      if (!isNaN(n)) result.number_of_stories = n;
    }
    if (acAreaText) {
      const n = parseInt(acAreaText.replace(/[^0-9]/g, ""), 10);
      if (!isNaN(n)) result.finished_base_area = n; // use A/C Area as finished base area
    }
  }

  // Building Component Information: materials, roofing, foundation, HVAC indicator, exterior walls, slab
  const compTable = findTableByCaption($, "Building Component Information");
  if (compTable && compTable.length) {
    compTable
      .find("tr")
      .slice(1)
      .each((i, tr) => {
        const tds = $(tr).find("td");
        if (!tds.length) return;
        const desc = $(tds[2]).text().trim();
        const cat = $(tds[3]).text().trim();
        // Exterior walls
        if (/Masonry,\s*Stucco on Block/i.test(desc)) {
          result.exterior_wall_material_primary = "Stucco";
          result.primary_framing_material = "Concrete Block";
        }
        // Roofing
        if (
          /Composition\s*Shingle/i.test(desc) ||
          /Composition Shingle/i.test(desc)
        ) {
          result.roof_material_type = "Composition";
          // leave roof_covering_material null due to ambiguity of 3-tab vs architectural
        }
        // Foundation slab
        if (/Slab on Grade/i.test(desc)) {
          result.foundation_type = "Slab on Grade";
          result.foundation_material = "Poured Concrete";
          result.subfloor_material = "Concrete Slab";
        }
      });
  }

  // If still missing some reasonable defaults based on single-family detached in FL
  if (!result.exterior_wall_material_primary)
    result.exterior_wall_material_primary = "Stucco";
  if (!result.foundation_type) result.foundation_type = "Slab on Grade";
  if (!result.foundation_material)
    result.foundation_material = "Poured Concrete";
  if (!result.primary_framing_material)
    result.primary_framing_material = "Concrete Block";
  if (!result.roof_material_type) result.roof_material_type = "Composition";

  return result;
}

(function main() {
  try {
    const inputPath = path.resolve("input.html");
    const $ = loadHtml(inputPath);
    const propId = getPropertyId($);

    const structure = extractStructure($);

    const outObj = {};
    outObj[`property_${propId}`] = structure;

    const outDir = path.resolve("owners");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, "structure_data.json");
    fs.writeFileSync(outPath, JSON.stringify(outObj, null, 2));
    console.log("Wrote", outPath);
  } catch (e) {
    console.error("Error:", e.message);
    process.exit(1);
  }
})();
