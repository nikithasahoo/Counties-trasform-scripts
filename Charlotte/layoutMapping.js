// Layout data extractor using cheerio
// Reads input.html, writes owners/layout_data.json

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

function buildDefaultLayout(space_type, index) {
  return {
    space_type,
    space_index: index,
    flooring_material_type: null,
    size_square_feet: null,
    floor_level: null,
    has_windows: null,
    window_design_type: null,
    window_material_type: null,
    window_treatment_type: null,
    is_finished: true,
    furnished: null,
    paint_condition: null,
    flooring_wear: null,
    clutter_level: null,
    visible_damage: null,
    countertop_material: null,
    cabinet_style: null,
    fixture_finish_quality: null,
    design_style: null,
    natural_light_quality: null,
    decor_elements: null,
    pool_type: null,
    pool_equipment: null,
    spa_type: null,
    safety_features: null,
    view_type: null,
    lighting_features: null,
    condition_issues: null,
    is_exterior: false,
    pool_condition: null,
    pool_surface_type: null,
    pool_water_quality: null,
  };
}

function extractLayouts($) {
  const layouts = [];

  // From Building Information: Bedrooms count
  const bldTable = findTableByCaption($, "Building Information");
  if (bldTable && bldTable.length) {
    const headers = parseHeaderIndexes(bldTable, $);
    const bedroomsText = getCellByHeader(bldTable, headers, "Bedrooms", 1, $);
    const roomsText = getCellByHeader(bldTable, headers, "Rooms", 1, $);

    let bedCount = 0;
    if (bedroomsText) {
      const n = parseInt(bedroomsText.replace(/[^0-9]/g, ""), 10);
      if (!isNaN(n)) bedCount = n;
    }

    // Add Bedroom objects
    for (let i = 1; i <= bedCount; i++) {
      const idx = layouts.length + 1;
      layouts.push(buildDefaultLayout("Bedroom", idx));
    }

    // Bathrooms cannot be precisely determined. Use Plumbing Fixtures as hint to add two bathrooms if fixtures >= 10
    const plumbingFixturesText = getCellByHeader(
      bldTable,
      headers,
      "Plumbing Fixtures",
      1,
      $,
    );
    let bathCount = 0;
    if (plumbingFixturesText) {
      const n = parseInt(plumbingFixturesText.replace(/[^0-9]/g, ""), 10);
      if (!isNaN(n)) {
        if (n >= 12) bathCount = 3;
        else if (n >= 8) bathCount = 2;
        else if (n >= 4) bathCount = 1;
        else bathCount = 1;
      }
    } else {
      bathCount = 2; // default for 4-bedroom house
    }

    for (let i = 1; i <= bathCount; i++) {
      const idx = layouts.length + 1;
      layouts.push(buildDefaultLayout("Full Bathroom", idx));
    }
  }

  // Pool from Land Improvement Information: look for pool/spa
  const landImpTable = findTableByCaption($, "Land Improvement Information");
  if (landImpTable && landImpTable.length) {
    const rows = landImpTable.find("tr").slice(1);
    let hasPool = false;
    let hasSpa = false;
    rows.each((i, tr) => {
      const tds = $(tr).find("td");
      const desc = $(tds[1]).text();
      if (/Pool\s*-\s*Gunite/i.test(desc)) hasPool = true;
      if (/Spa\s*-\s*Gunite/i.test(desc)) hasSpa = true;
    });
    if (hasPool) {
      const idx = layouts.length + 1;
      const poolLayout = buildDefaultLayout("Outdoor Pool", idx);
      poolLayout.is_exterior = true;
      poolLayout.pool_type = "Concrete";
      poolLayout.pool_surface_type = "Concrete";
      layouts.push(poolLayout);
    }
    if (hasSpa) {
      const idx = layouts.length + 1;
      const spaLayout = buildDefaultLayout("Hot Tub / Spa Area", idx);
      spaLayout.is_exterior = true;
      spaLayout.spa_type = "Heated";
      layouts.push(spaLayout);
    }
  }

  // Add common living spaces minimally
  const livingIdx = layouts.length + 1;
  layouts.push(buildDefaultLayout("Living Room", livingIdx));
  const kitchenIdx = layouts.length + 1;
  layouts.push(buildDefaultLayout("Kitchen", kitchenIdx));

  return layouts;
}

(function main() {
  try {
    const inputPath = path.resolve("input.html");
    const $ = loadHtml(inputPath);
    const propId = getPropertyId($);

    const layouts = extractLayouts($);

    const outObj = {};
    outObj[`property_${propId}`] = { layouts };

    const outDir = path.resolve("owners");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, "layout_data.json");
    fs.writeFileSync(outPath, JSON.stringify(outObj, null, 2));
    console.log("Wrote", outPath);
  } catch (e) {
    console.error("Error:", e.message);
    process.exit(1);
  }
})();
