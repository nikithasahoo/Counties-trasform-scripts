const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

// Helper: normalize spaces
function normSpace(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

// Helper: detect company by keywords (case-insensitive)
function isCompany(name) {
  const kw = [
    "inc",
    "llc",
    "l.l.c",
    "ltd",
    "limited",
    "foundation",
    "alliance",
    "solutions",
    "corp",
    "corporation",
    "co",
    "company",
    "services",
    "trust",
    "tr",
    "lp",
    "llp",
    "plc",
    "group",
    "partners",
    "holdings",
    "bank",
    "na",
    "association",
    "hoa",
    "assn",
    "ministries",
    "church",
  ];
  const n = name.toLowerCase();
  return kw.some((k) => new RegExp(`(^|[^a-z])${k}([^a-z]|$)`).test(n));
}

// Helper: parse a single person segment; attempts several patterns
function parsePersonSegment(segment, priorLastName) {
  let s = normSpace(segment)
    .replace(/\./g, "")
    .replace(/\s+ET\s+AL.?$/i, "")
    .trim();
  if (!s) return { invalid: true, reason: "empty_segment" };

  // If comma present: LAST, FIRST MIDDLE
  if (s.includes(",")) {
    const [lastRaw, restRaw] = s.split(",");
    const last = normSpace(lastRaw);
    const restTokens = normSpace(restRaw).split(" ").filter(Boolean);
    const first = restTokens[0] || "";
    const middle = restTokens.slice(1).join(" ");
    if (!first || !last)
      return { invalid: true, reason: "missing_first_or_last" };
    const person = { type: "person", first_name: first, last_name: last };
    if (middle) person.middle_name = middle;
    return person;
  }

  const tokens = s.split(" ").filter(Boolean);

  // If there is an explicit prior last name and this segment appears to be only given names (1-2 tokens), attach last name
  if (priorLastName && tokens.length <= 2) {
    const first = tokens[0] || "";
    const middle = tokens[1] || "";
    if (!first) return { invalid: true, reason: "missing_first_name" };
    const person = {
      type: "person",
      first_name: first,
      last_name: priorLastName,
    };
    if (middle) person.middle_name = middle;
    return person;
  }

  // Heuristic 1: All uppercase tokens, assume LAST FIRST [MIDDLE]
  const isAllUpper = tokens.every((t) => t === t.toUpperCase());
  if (isAllUpper && tokens.length >= 2) {
    const last = tokens[0];
    const first = tokens[1];
    const middle = tokens.slice(2).join(" ");
    const person = { type: "person", first_name: first, last_name: last };
    if (middle) person.middle_name = middle;
    return person;
  }

  // Heuristic 2: Default Western order FIRST [MIDDLE] LAST
  if (tokens.length >= 2) {
    const first = tokens[0];
    const last = tokens[tokens.length - 1];
    const middle = tokens.slice(1, -1).join(" ");
    if (!first || !last)
      return { invalid: true, reason: "missing_first_or_last" };
    const person = { type: "person", first_name: first, last_name: last };
    if (middle) person.middle_name = middle;
    return person;
  }

  return { invalid: true, reason: "unparsable_person_segment" };
}

// Helper: split a name line by owner delimiters (&, AND)
function splitOwnerGroups(line) {
  const cleaned = line.replace(/\s*\band\b\s*/gi, " & ");
  return cleaned
    .split(/\s*&\s*/)
    .map((s) => normSpace(s))
    .filter(Boolean);
}

// Helper: build normalized key for deduplication
function normOwnerKey(owner) {
  if (!owner) return "";
  if (owner.type === "company")
    return `company|${normSpace(owner.name).toLowerCase()}`;
  const first = (owner.first_name || "").toLowerCase().trim();
  const middle = (owner.middle_name || "").toLowerCase().trim();
  const last = (owner.last_name || "").toLowerCase().trim();
  return `person|${first}|${middle}|${last}`;
}

// Extract property ID from the document
function extractPropertyId($) {
  let id = null;
  const h1Text = $("h1").first().text();
  const m = h1Text.match(/(\d{5,})/);
  if (m) id = m[1];
  if (!id) {
    // Try any button or link containing the account
    $("*[onclick], a[href]").each((i, el) => {
      if (id) return;
      const attr = $(el).attr("onclick") || $(el).attr("href") || "";
      const mm =
        attr.match(/acct=([0-9\-]+)/i) ||
        attr.match(/defAccount=([0-9\-]+)/i) ||
        attr.match(/navLink\('([0-9\-]+)'\)/i);
      if (mm) id = mm[1];
    });
  }
  if (!id) id = "unknown_id";
  return id;
}

// Extract owner name lines (first line before address lines)
function extractOwnerNameLines($) {
  const lines = [];
  $("h2").each((i, el) => {
    const t = $(el).text().toLowerCase();
    if (t.includes("owner")) {
      // Try the nearest bordered div
      let cont = $(el)
        .nextAll("div")
        .filter((i2, e2) => /\bw3-border\b/.test($(e2).attr("class") || ""))
        .first();
      if (!cont.length) {
        cont = $(el).parent().find("div.w3-border").first();
      }
      if (cont.length) {
        const html = cont.html() || "";
        const firstSeg = html.split(/<br\s*\/?\s*>/i)[0] || "";
        const tmp = cheerio.load(`<div>${firstSeg}</div>`);
        const text = normSpace(tmp("div").text());
        if (text) lines.push(text);
      }
    }
  });
  return lines;
}

// Main execution
(function main() {
  const inputPath = path.join(process.cwd(), "input.html");
  const html = fs.readFileSync(inputPath, "utf8");
  const $ = cheerio.load(html);

  const propertyId = extractPropertyId($);

  const ownerLines = extractOwnerNameLines($);

  const owners = [];
  const invalidOwners = [];
  const seen = new Set();

  ownerLines.forEach((line) => {
    const groups = splitOwnerGroups(line);
    let priorLast = null;
    groups.forEach((g, idx) => {
      const candidate = normSpace(g);
      if (!candidate) return;

      // Classify
      if (isCompany(candidate)) {
        const company = { type: "company", name: candidate };
        const key = normOwnerKey(company);
        if (key && !seen.has(key)) {
          seen.add(key);
          owners.push(company);
        }
        // Reset priorLast so we don't bleed surnames across company/person boundaries
        priorLast = null;
      } else {
        // Person parsing with heuristics
        const parsed = parsePersonSegment(candidate, priorLast);
        if (parsed.invalid) {
          invalidOwners.push({ raw: candidate, reason: parsed.reason });
        } else {
          const key = normOwnerKey(parsed);
          if (key && !seen.has(key)) {
            seen.add(key);
            owners.push(parsed);
          }
          // Update priorLast for sharing surname in multi-party cases
          priorLast = parsed.last_name || priorLast;
        }
      }
    });
  });

  const ownersByDate = { current: owners };

  const result = {};
  result[`property_${propertyId}`] = {
    owners_by_date: ownersByDate,
    invalid_owners: invalidOwners,
  };

  const outDir = path.join(process.cwd(), "owners");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "owner_data.json");
  const jsonStr = JSON.stringify(result, null, 2);
  fs.writeFileSync(outPath, jsonStr, "utf8");
  console.log(jsonStr);
})();
