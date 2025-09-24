/*
  Data extraction script
  - Reads: input.html, unnormalized_address.json, property_seed.json
  - Reads owners data from: owners/owner_data.json, owners/utilities_data.json, owners/layout_data.json
  - Writes JSON outputs to data/
  Notes:
  - Uses only cheerio for HTML parsing
  - Avoids fabricating values; uses nulls where schema allows
  - Idempotent: always overwrites existing output files
*/

const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeJSON(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf8");
}

function parseCurrency(str) {
  if (!str) return null;
  const n = parseFloat(String(str).replace(/[$,\s]/g, ""));
  if (isNaN(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function parseUSDateToISO(str) {
  if (!str) return null;
  const m = String(str)
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [_, mm, dd, yyyy] = m;
  const month = mm.padStart(2, "0");
  const day = dd.padStart(2, "0");
  return `${yyyy}-${month}-${day}`;
}

function properCaseName(s) {
  if (!s) return s;
  return s
    .toLowerCase()
    .split(/[\s\-]+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function titleCaseAbbrev(s) {
  if (!s) return s;
  s = s.toString().trim();
  if (!s) return s;
  return s[0].toUpperCase() + s.slice(1).toLowerCase();
}

function main() {
  ensureDir("data");

  const inputHtml = fs.readFileSync("input.html", "utf8");
  const $ = cheerio.load(inputHtml);

  const unaddr = readJSON("unnormalized_address.json");
  const propSeed = readJSON("property_seed.json");

  // Owners/utilities/layout sources
  let ownersData = null,
    utilitiesData = null,
    layoutData = null;
  try {
    ownersData = readJSON(path.join("owners", "owner_data.json"));
  } catch {}
  try {
    utilitiesData = readJSON(path.join("owners", "utilities_data.json"));
  } catch {}
  try {
    layoutData = readJSON(path.join("owners", "layout_data.json"));
  } catch {}

  const parcelKey = `property_${propSeed.request_identifier || propSeed.parcel_id || propSeed.parcelId || ""}`;

  // PROPERTY
  // Building Information extraction
  let yearBuilt = null;
  let floors = null;
  let rooms = null;
  let bedrooms = null;
  let acArea = null;
  let totalArea = null;

  // More robust: scan rows for the Single Family row with fields aligned
  $("table").each((i, el) => {
    const caption = $(el).find("caption.blockcaption").first().text().trim();
    if (/Building Information/i.test(caption)) {
      $(el)
        .find("tr")
        .each((ri, tr) => {
          if (ri === 0) return; // header
          const tds = $(tr).find("td");
          if (tds.length >= 13) {
            const desc = $(tds[1]).text().trim();
            if (/Single Family/i.test(desc)) {
              yearBuilt = $(tds[4]).text().trim() || null;
              floors = $(tds[6]).text().trim() || null;
              rooms = $(tds[7]).text().trim() || null;
              bedrooms = $(tds[8]).text().trim() || null;
              acArea = $(tds[11]).text().trim() || null;
              totalArea = $(tds[12]).text().trim() || null;
            }
          }
        });
    }
  });

  // Zoning
  let zoning = null;
  $("div.w3-row").each((i, el) => {
    const label = $(el)
      .find("div.w3-cell.w3-half strong")
      .first()
      .text()
      .trim();
    if (/Zoning Code/i.test(label)) {
      zoning = $(el)
        .find("div.w3-cell.w3-half")
        .last()
        .text()
        .replace(/\s+/g, " ")
        .trim();
      zoning = zoning.replace(/\u00A0/g, "").trim();
      zoning = zoning.replace(/\s+/g, "");
    }
  });

  // Current Use → property_type
  let currentUse = null;
  $("div.w3-row").each((i, el) => {
    const label = $(el)
      .find("div.w3-cell.w3-half strong")
      .first()
      .text()
      .trim();
    if (/Current Use/i.test(label)) {
      currentUse = $(el)
        .find("div.w3-cell.w3-half")
        .last()
        .text()
        .replace(/\s+/g, " ")
        .trim();
    }
  });

  function mapPropertyType(useText) {
    if (!useText) return null;
    const t = useText.toLowerCase();
    if (t.includes("single")) return "SingleFamily";
    if (t.includes("duplex")) return "Duplex";
    if (t.includes("town")) return "Townhouse";
    if (t.includes("condominium")) return "Condominium";
    if (t.includes("vacant residential")) return "VacantLand";
    if (t.includes("single family residential")) return "SingleFamily";  
    if (t.includes("residential condominium")) return "Condominium";
    if (t.includes("single family")) return "SingleFamily"; 
    if (t.includes("vacant multi-family residential")) return "MultipleFamily";


    

    
    return null;
  }

  // Long Legal description
  let longLegal = null;
  // Find the div labeled Long Legal
  $("div.w3-container.w3-border.w3-border-blue.w3-cell").each((i, el) => {
    const label = $(el).find("strong").first().text().trim();
    if (/Long Legal/i.test(label)) {
      const text = $(el).text().replace(/\s+/g, " ").trim();
      longLegal = text.replace(/^Long Legal:\s*/i, "").trim();
    }
  });

  // Try subdivision from long legal (e.g., starts with PORT CHARLOTTE SEC 22)
  let subdivision = null;
  if (longLegal) {
    const m = longLegal.match(/^(PORT CHARLOTTE[^\d]*SEC\s*\d+)/i);
    if (m) subdivision = m[1].toUpperCase();
  }

  // Area strings (as schema expects string with digits)
  const livableStr = acArea ? String(acArea).trim() : null;
  const areaUnderAir = livableStr;
  const totalAreaStr = totalArea ? String(totalArea).trim() : null;

  const property = {
    parcel_identifier: String(
      propSeed.parcel_id || propSeed.request_identifier || "",
    ).trim(),
    property_type: mapPropertyType(currentUse),
    property_structure_built_year: yearBuilt ? parseInt(yearBuilt, 10) : null,
    property_effective_built_year: null, // not explicitly provided
    property_legal_description_text: longLegal || null,
    livable_floor_area: livableStr || null,
    area_under_air: areaUnderAir || null,
    total_area: totalAreaStr || null,
    number_of_units_type: "One",
    number_of_units: null,
    zoning: zoning || null,
    subdivision: subdivision || null,
    historic_designation: false,
  };
  writeJSON(path.join("data", "property.json"), property);

  // ADDRESS
  const fullAddr = unaddr.full_address || "";
  const county = unaddr.county_jurisdiction || null;
  const mAddr =
    fullAddr.match(
      /^(\d+)\s+(.+?)\s+([A-Za-z]+),\s*([A-Z\s\-']+),\s*([A-Z]{2})\s*(\d{5})(?:-(\d{4}))?$/,
    ) ||
    fullAddr.match(
      /^(\d+)\s+(.+?)\s+([A-Za-z]+),\s*([A-Z\s\-']+)\s*(\d{5})(?:-(\d{4}))?$/,
    );
  let streetNumber = null,
    streetName = null,
    streetSuffix = null,
    cityName = null,
    stateCode = null,
    postalCode = null,
    plus4 = null;
  if (mAddr) {
    streetNumber = mAddr[1];
    streetName = (mAddr[2] || "").trim();
    streetSuffix = titleCaseAbbrev(mAddr[3] || "");
    
    const allowedSuffixes = new Set([
      "Rds", "Blvd", "Lk", "Pike", "Ky", "Vw", "Curv", "Psge", "Ldg", "Mt", "Un", "Mdw", "Via", "Cor", "Kys", "Vl", "Pr", "Cv", "Isle", "Lgt", "Hbr", "Btm", "Hl", "Mews", "Hls", "Pnes", "Lgts", "Strm", "Hwy", "Trwy", "Skwy", "Is", "Est", "Vws", "Ave", "Exts", "Cvs", "Row", "Rte", "Fall", "Gtwy", "Wls", "Clb", "Frk", "Cpe", "Fwy", "Knls", "Rdg", "Jct", "Rst", "Spgs", "Cir", "Crst", "Expy", "Smt", "Trfy", "Cors", "Land", "Uns", "Jcts", "Ways", "Trl", "Way", "Trlr", "Aly", "Spg", "Pkwy", "Cmn", "Dr", "Grns", "Oval", "Cirs", "Pt", "Shls", "Vly", "Hts", "Clf", "Flt", "Mall", "Frds", "Cyn", "Lndg", "Mdws", "Rd", "Xrds", "Ter", "Prt", "Radl", "Grvs", "Rdgs", "Inlt", "Trak", "Byu", "Vlgs", "Ctr", "Ml", "Cts", "Arc", "Bnd", "Riv", "Flds", "Mtwy", "Msn", "Shrs", "Rue", "Crse", "Cres", "Anx", "Drs", "Sts", "Holw", "Vlg", "Prts", "Sta", "Fld", "Xrd", "Wall", "Tpke", "Ft", "Bg", "Knl", "Plz", "St", "Cswy", "Bgs", "Rnch", "Frks", "Ln", "Mtn", "Ctrs", "Orch", "Iss", "Brks", "Br", "Fls", "Trce", "Park", "Gdns", "Rpds", "Shl", "Lf", "Rpd", "Lcks", "Gln", "Pl", "Path", "Vis", "Lks", "Run", "Frg", "Brg", "Sqs", "Xing", "Pln", "Glns", "Blfs", "Plns", "Dl", "Clfs", "Ext", "Pass", "Gdn", "Brk", "Grn", "Mnr", "Cp", "Pne", "Spur", "Opas", "Upas", "Tunl", "Sq", "Lck", "Ests", "Shr", "Dm", "Mls", "Wl", "Mnrs", "Stra", "Frgs", "Frst", "Flts", "Ct", "Mtns", "Frd", "Nck", "Ramp", "Vlys", "Pts", "Bch", "Loop", "Byp", "Cmns", "Fry", "Walk", "Hbrs", "Dv", "Hvn", "Blf", "Grv", "Crk"
    ]);
    if (!allowedSuffixes.has(streetSuffix)) {
        streetSuffix = null;
    }


    if (mAddr.length === 8) {
      cityName = (mAddr[4] || "").trim().toUpperCase();
      stateCode = (mAddr[5] || "").trim().toUpperCase();
      postalCode = (mAddr[6] || "").trim();
      plus4 = mAddr[7] || null;
    } else {
      cityName = (mAddr[4] || "").trim().toUpperCase();
      stateCode = "FL";
      postalCode = (mAddr[5] || "").trim();
      plus4 = mAddr[6] || null;
    }
  }

  // Section/Township/Range: find row with this label
  let section = null,
    township = null,
    range = null;
  $("div.w3-row").each((i, el) => {
    const label = $(el)
      .find("div.w3-cell.w3-half strong")
      .first()
      .text()
      .trim();
    if (/Section\/Township\/Range/i.test(label)) {
      const val = $(el).find("div.w3-cell.w3-half").last().text().trim();
      const mm = val.match(/(\d{2})-(\d{2})-(\d{2})/);
      if (mm) {
        section = mm[1];
        township = mm[2];
        range = mm[3];
      }
    }
  });

  // Block from Long Legal: BLK 1099 or BLOCK 1099
  let block = null;
  if (longLegal) {
    const bm =
      longLegal.match(/BLK\s+(\d+)/i) || longLegal.match(/BLOCK\s+(\d+)/i);
    if (bm) block = bm[1];
  }

  // Clean street_name: remove trailing suffix if present (space + suffix)
  let streetBase = streetName;
  if (streetBase && streetSuffix) {
    const suf = streetSuffix.toUpperCase();
    const pattern = new RegExp(`\\s+${suf}$`, "i");
    streetBase = streetBase.replace(pattern, "").trim();
  }

  const address = {
    street_number: streetNumber || null,
    street_name: streetBase || null,
    street_suffix_type: streetSuffix || null,
    street_pre_directional_text: null,
    street_post_directional_text: null,
    unit_identifier: null,
    city_name: cityName || null,
    municipality_name: null,
    county_name: county || null,
    state_code: stateCode || "FL",
    postal_code: postalCode || null,
    plus_four_postal_code: plus4 || null,
    country_code: "US",
    latitude: null,
    longitude: null,
    route_number: null,
    township: township || null,
    range: range || null,
    section: section || null,
    block: block || null,
    lot: null,
  };
  writeJSON(path.join("data", "address.json"), address);

  // SALES
  const sales = [];
  $("h2").each((i, h) => {
    if (/Sales Information/i.test($(h).text())) {
      const table = $(h)
        .nextAll("div.w3-responsive")
        .first()
        .find("table")
        .first();
      table.find("tr").each((ri, tr) => {
        if (ri === 0) return; // header
        const tds = $(tr).find("td");
        if (tds.length >= 6) {
          const dateText = $(tds[0]).text().trim();
          const priceText = $(tds[3]).text().trim();
          const dateISO = parseUSDateToISO(dateText);
          const price = parseCurrency(priceText);
          if (dateISO && price !== null) {
            sales.push({
              ownership_transfer_date: dateISO,
              purchase_price_amount: price,
            });
          }
        }
      });
    }
  });

  // Write each sale as sales_1.json ...
  sales.forEach((s, idx) => {
    writeJSON(path.join("data", `sales_${idx + 1}.json`), s);
  });

  // Extract Ownership current through date to link relationships
  let ownershipThroughISO = null;
  $("div.prcfootnote").each((i, el) => {
    const t = $(el).text();
    const m = t.match(
      /Ownership current through:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i,
    );
    if (m) ownershipThroughISO = parseUSDateToISO(m[1]);
  });

  // PERSON/COMPANY from owners data
  const owners =
    (ownersData &&
      ownersData[parcelKey] &&
      ownersData[parcelKey].owners_by_date &&
      ownersData[parcelKey].owners_by_date.current) ||
    [];
  const persons = [];
  const companies = [];
  owners.forEach((o) => {
    if (o.type === "person") {
      const person = {
        birth_date: null,
        first_name: properCaseName(o.first_name || ""),
        last_name: properCaseName(o.last_name || ""),
        middle_name: o.middle_name ? properCaseName(o.middle_name) : null,
        prefix_name: null,
        suffix_name: null,
        us_citizenship_status: null,
        veteran_status: null,
      };
      persons.push(person);
    } else if (o.type === "company") {
      companies.push({ name: o.name || null });
    }
  });

  persons.forEach((p, i) =>
    writeJSON(path.join("data", `person_ ${i + 1}.json`), p),
  );
  companies.forEach((c, i) =>
    writeJSON(path.join("data", `company_${i + 1}.json`), c),
  );

  // Relationship: link each current owner to most recent sale on/before ownershipThroughISO
  if (persons.length > 0 && sales.length > 0) {
    // Find most recent sale by date <= ownershipThroughISO, else default to most recent overall
    const sortedSales = sales
      .map((s, idx) => ({
        ...s,
        idx,
        ts: Date.parse(s.ownership_transfer_date),
      }))
      .sort((a, b) => b.ts - a.ts);
    let target = sortedSales[0];
    if (ownershipThroughISO) {
      const cutoff = Date.parse(ownershipThroughISO);
      const found = sortedSales.find((s) => s.ts <= cutoff);
      if (found) target = found;
    }
    // sales files are 1-indexed
    const salesFile = `./sales_${target.idx + 1}.json`;
    persons.forEach((p, pi) => {
      const rel = {
        to: { "/": `./person_${pi + 1}.json` },
        from: { "/": salesFile },
      };
      writeJSON(
        path.join(
          "data",
          "relationship_sales_history_has_person.json".replace(".json", `_${pi + 1}.json`),
        ),
        rel,
      );
    });
  } else if (companies.length > 0 && sales.length > 0) {
    const sortedSales = sales
      .map((s, idx) => ({
        ...s,
        idx,
        ts: Date.parse(s.ownership_transfer_date),
      }))
      .sort((a, b) => b.ts - a.ts);
    const target = sortedSales[0];
    const salesFile = `./sales_${target.idx + 1}.json`;
    companies.forEach((c, ci) => {
      const rel = {
        to: { "/": `./company_${ci + 1}.json` },
        from: { "/": salesFile },
      };
      writeJSON(
        path.join(
          "data",
          "relationship_sales_has_company.json".replace(".json", `_${ci + 1}.json`),
        ),
        rel,
      );
    });
  }

  // TAX (2025 Preliminary)
  let taxYear = null;
  let justValue = null;
  let assessedValue = null;
  let taxableValue = null;
  $("table").each((i, el) => {
    const caption = $(el).find("caption.blockcaption").first();
    const capText = caption.text().replace(/\s+/g, " ").trim();
    if (/Preliminary Tax Roll Values/i.test(capText)) {
      const ym = capText.match(/(\d{4})\s+Preliminary Tax Roll Values/i);
      if (ym) taxYear = parseInt(ym[1], 10);
      const rows = $(el).find("tr");
      rows.each((ri, tr) => {
        const tds = $(tr).find("td");
        const th = $(tr).find("td,th").first().text().trim();
        if (/Preliminary Just Value/i.test(th) && tds.length >= 2) {
          justValue = parseCurrency($(tds[1]).text());
        }
        if (/Preliminary Assessed Value/i.test(th) && tds.length >= 2) {
          assessedValue = parseCurrency($(tds[1]).text());
        }
        if (/Preliminary Taxable Value/i.test(th) && tds.length >= 2) {
          taxableValue = parseCurrency($(tds[1]).text());
        }
      });
    }
  });
  if (taxYear) {
    const tax = {
      tax_year: taxYear,
      property_assessed_value_amount:
        assessedValue != null ? assessedValue : null,
      property_market_value_amount: justValue != null ? justValue : null,
      property_building_amount: null,
      property_land_amount: null,
      property_taxable_value_amount: taxableValue != null ? taxableValue : null,
      monthly_tax_amount: null,
      period_end_date: null,
      period_start_date: null,
      first_year_on_tax_roll: null,
      first_year_building_on_tax_roll: null,
      yearly_tax_amount: null,
    };
    writeJSON(path.join("data", `tax_${taxYear}.json`), tax);
  }

  // FLOOD
  let flood = null;
  $("table").each((i, el) => {
    const caption = $(el).find("caption.blockcaption").first().text().trim();
    if (/FEMA Flood Zone/i.test(caption)) {
      const effM = caption.match(/Effective\s+(\d{1,2}\/\d{1,2}\/\d{4})/i);
      const effective_date = effM ? parseUSDateToISO(effM[1]) : null;
      const row = $(el).find("tr").eq(1); // first data row
      const tds = row.find("td");
      if (tds.length >= 8) {
        const firmPanel = $(tds[0])
          .text()
          .replace(/\s|\u00A0/g, "")
          .trim();
        const floodZone = $(tds[3])
          .text()
          .replace(/\s|\u00A0/g, "")
          .trim();
        const fips = $(tds[4])
          .text()
          .replace(/\s|\u00A0/g, "")
          .trim();
        const community = $(tds[6])
          .text()
          .replace(/\s|\u00A0/g, "")
          .trim();
        const community_id = community || null;
        const panel_number = fips && firmPanel ? `${fips}${firmPanel}` : null;
        const map_version = firmPanel ? firmPanel.replace(/^[0-9]+/, "") : null; // trailing letter(s)
        flood = {
          community_id: community_id,
          panel_number: panel_number,
          map_version: map_version || null,
          effective_date: effective_date || null,
          evacuation_zone: null,
          flood_zone: floodZone || null,
          flood_insurance_required:
            floodZone && floodZone.toUpperCase() === "X" ? false : true,
          fema_search_url: null,
        };
      }
    }
  });
  if (flood)
    writeJSON(path.join("data", "flood_storm_information.json"), flood);

  // LOT (insufficient detail → mostly nulls per schema allowance)
  const lot = {
    lot_type: null,
    lot_length_feet: null,
    lot_width_feet: null,
    lot_area_sqft: null,
    landscaping_features: null,
    view: null,
    fencing_type: null,
    fence_height: null,
    fence_length: null,
    driveway_material: null,
    driveway_condition: null,
    lot_condition_issues: null,
    lot_size_acre: null,
  };
  writeJSON(path.join("data", "lot.json"), lot);

  // STRUCTURE: parse limited info from Building Component Information
  let exteriorWallMaterialPrimary = null;
  let roofMaterialType = null;
  let foundationType = null;
  let primaryFramingMaterial = null;

  $("table").each((i, el) => {
    const caption = $(el).find("caption.blockcaption").first().text().trim();
    if (/Building Component Information/i.test(caption)) {
      $(el)
        .find("tr")
        .each((ri, tr) => {
          if (ri === 0) return;
          const tds = $(tr).find("td");
          if (tds.length >= 3) {
            const desc = $(tds[2]).text().trim();
            if (/Masonry,\s*Stucco on Block/i.test(desc)) {
              exteriorWallMaterialPrimary = "Stucco";
              primaryFramingMaterial = "Concrete Block";
            }
            if (/Composition Shingle/i.test(desc)) {
              roofMaterialType = "Composition";
            }
            if (/Slab on Grade/i.test(desc)) {
              foundationType = "Slab on Grade";
            }
          }
        });
    }
  });

  const structure = {
    architectural_style_type: null,
    attachment_type: null,
    exterior_wall_material_primary: exteriorWallMaterialPrimary || null,
    exterior_wall_material_secondary: null,
    exterior_wall_condition: null,
    exterior_wall_insulation_type: "Unknown",
    flooring_material_primary: null,
    flooring_material_secondary: null,
    subfloor_material: "Concrete Slab",
    flooring_condition: null,
    interior_wall_structure_material: null,
    interior_wall_surface_material_primary: null,
    interior_wall_surface_material_secondary: null,
    interior_wall_finish_primary: null,
    interior_wall_finish_secondary: null,
    interior_wall_condition: null,
    roof_covering_material: null,
    roof_underlayment_type: "Unknown",
    roof_structure_material: null,
    roof_design_type: null,
    roof_condition: null,
    roof_age_years: null,
    gutters_material: null,
    gutters_condition: null,
    roof_material_type: roofMaterialType || null,
    foundation_type: foundationType || null,
    foundation_material: null,
    foundation_waterproofing: "Unknown",
    foundation_condition: null,
    ceiling_structure_material: null,
    ceiling_surface_material: null,
    ceiling_insulation_type: "Unknown",
    ceiling_height_average: null,
    ceiling_condition: null,
    exterior_door_material: null,
    interior_door_material: null,
    window_frame_material: null,
    window_glazing_type: null,
    window_operation_type: null,
    window_screen_material: null,
    primary_framing_material: primaryFramingMaterial || null,
    secondary_framing_material: null,
    structural_damage_indicators: null,
    finished_base_area: acArea
      ? parseInt(String(acArea).replace(/[^0-9]/g, ""), 10)
      : null,
    finished_basement_area: null,
    finished_upper_story_area: null,
    unfinished_base_area: null,
    unfinished_basement_area: null,
    unfinished_upper_story_area: null,
    number_of_stories: floors ? parseInt(floors, 10) : null,
  };
  writeJSON(path.join("data", "structure.json"), structure);

  // UTILITIES
  if (utilitiesData && utilitiesData[parcelKey]) {
    const u = utilitiesData[parcelKey];
    const utility = {
      cooling_system_type: u.cooling_system_type ?? null,
      heating_system_type: u.heating_system_type ?? null,
      public_utility_type: u.public_utility_type ?? null,
      sewer_type: u.sewer_type ?? null,
      water_source_type: u.water_source_type ?? null,
      plumbing_system_type: u.plumbing_system_type ?? null,
      plumbing_system_type_other_description:
        u.plumbing_system_type_other_description ?? null,
      electrical_panel_capacity: u.electrical_panel_capacity ?? null,
      electrical_wiring_type: u.electrical_wiring_type ?? null,
      hvac_condensing_unit_present: u.hvac_condensing_unit_present ?? null,
      electrical_wiring_type_other_description:
        u.electrical_wiring_type_other_description ?? null,
      solar_panel_present: u.solar_panel_present ?? null,
      solar_panel_type: u.solar_panel_type ?? null,
      solar_panel_type_other_description:
        u.solar_panel_type_other_description ?? null,
      smart_home_features: u.smart_home_features ?? null,
      smart_home_features_other_description:
        u.smart_home_features_other_description ?? null,
      hvac_unit_condition: u.hvac_unit_condition ?? null,
      solar_inverter_visible: u.solar_inverter_visible ?? null,
      hvac_unit_issues: u.hvac_unit_issues ?? null,
    };
    writeJSON(path.join("data", "utility.json"), utility);
  }

  // LAYOUTS
  if (
    layoutData &&
    layoutData[parcelKey] &&
    Array.isArray(layoutData[parcelKey].layouts)
  ) {
    layoutData[parcelKey].layouts.forEach((ly, i) => {
      writeJSON(path.join("data", `layout_${i + 1}.json`), {
        space_type: ly.space_type ?? null,
        space_index: ly.space_index ?? null,
        flooring_material_type: ly.flooring_material_type ?? null,
        size_square_feet: ly.size_square_feet ?? null,
        floor_level: ly.floor_level ?? null,
        has_windows: ly.has_windows ?? null,
        window_design_type: ly.window_design_type ?? null,
        window_material_type: ly.window_material_type ?? null,
        window_treatment_type: ly.window_treatment_type ?? null,
        is_finished: ly.is_finished ?? false,
        furnished: ly.furnished ?? null,
        paint_condition: ly.paint_condition ?? null,
        flooring_wear: ly.flooring_wear ?? null,
        clutter_level: ly.clutter_level ?? null,
        visible_damage: ly.visible_damage ?? null,
        countertop_material: ly.countertop_material ?? null,
        cabinet_style: ly.cabinet_style ?? null,
        fixture_finish_quality: ly.fixture_finish_quality ?? null,
        design_style: ly.design_style ?? null,
        natural_light_quality: ly.natural_light_quality ?? null,
        decor_elements: ly.decor_elements ?? null,
        pool_type: ly.pool_type ?? null,
        pool_equipment: ly.pool_equipment ?? null,
        spa_type: ly.spa_type ?? null,
        safety_features: ly.safety_features ?? null,
        view_type: ly.view_type ?? null,
        lighting_features: ly.lighting_features ?? null,
        condition_issues: ly.condition_issues ?? null,
        is_exterior: ly.is_exterior ?? false,
        pool_condition: ly.pool_condition ?? null,
        pool_surface_type: ly.pool_surface_type ?? null,
        pool_water_quality: ly.pool_water_quality ?? null,
      });
    });
  }

  // FILE for most recent sale document
  // Find most recent sale row's Book/Page link
  let mostRecentLink = null;
  $("h2").each((i, h) => {
    if (/Sales Information/i.test($(h).text())) {
      const table = $(h)
        .nextAll("div.w3-responsive")
        .first()
        .find("table")
        .first();
      table.find("tr").each((ri, tr) => {
        if (ri === 0) return; // header
        if (!mostRecentLink) {
          const link = $(tr).find("td").eq(1).find("a").attr("href");
          const bpText = $(tr).find("td").eq(1).text().trim();
          if (link) {
            mostRecentLink = { url: link, name: `Book/Page ${bpText}` };
          }
        }
      });
    }
  });
  if (mostRecentLink) {
    const file = {
      file_format: null,
      name: mostRecentLink.name,
      original_url: mostRecentLink.url,
      ipfs_url: null,
      document_type: null,
    };
    writeJSON(path.join("data", "file_1.json"), file);
  }

  // DEED and relationships (link most recent sale to deed, and deed to file)
  if (sales.length > 0) {
    const deed = {};
    writeJSON(path.join("data", "deed_1.json"), deed);
    // sales_1 corresponds to most recent row as we wrote in order
    writeJSON(path.join("data", "relationship_sales_history_has_deed.json"), {
      to: { "/": `./sales_1.json` },
      from: { "/": `./deed_1.json` },
    });
    if (mostRecentLink) {
      writeJSON(path.join("data", "relationship_deed_has_file.json"), {
        to: { "/": `./deed_1.json` },
        from: { "/": `./file_1.json` },
      });
    }
  }
}

main();
