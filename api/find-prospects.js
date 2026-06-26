// Live prospect sourcing from public SEC EDGAR data.
// No API key required. SEC asks for a descriptive User-Agent with contact info.
// This surfaces SOURCING SIGNALS to begin relationship-building under 506(b).
// It is not an offer or solicitation, and accreditation is never assumed.

const UA = "Cascade Investor Engine prototype (contact: investor-engine@example.com)";
const H = { "User-Agent": UA, "Accept": "application/json" };

// Preset searches over EDGAR full-text search.
const PRESETS = {
  "ai-funds":       { forms: "D",          q: '"artificial intelligence"', enrich: true,  label: "AI-focused funds & vehicles (Form D)" },
  "family-offices": { forms: "D",          q: '"family office"',           enrich: true,  label: "Family offices (Form D)" },
  "spv-sponsors":   { forms: "D",          q: '"special purpose vehicle"', enrich: true,  label: "SPV sponsors (Form D)" },
  "ai-ipos":        { forms: "S-1,424B4",  q: '"artificial intelligence"', enrich: false, label: "Recent AI IPO / offering filers" },
};

function ymd(d) { return d.toISOString().slice(0, 10); }

function pickExemption(items) {
  const it = (items || []).map((x) => String(x).toUpperCase());
  if (it.includes("06C")) return "506(c)";
  if (it.includes("06B")) return "506(b)";
  return "—";
}

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function tag(xml, name) {
  const m = xml.match(new RegExp("<" + name + ">([\\s\\S]*?)</" + name + ">", "i"));
  return m ? m[1].trim() : "";
}

function parsePersons(xml) {
  const out = [];
  const block = xml.match(/<relatedPersonsList>([\s\S]*?)<\/relatedPersonsList>/i);
  if (!block) return out;
  const infos = block[1].match(/<relatedPersonInfo>([\s\S]*?)<\/relatedPersonInfo>/gi) || [];
  for (const info of infos) {
    let first = tag(info, "firstName");
    const mid = tag(info, "middleName");
    const last = tag(info, "lastName");
    if (first === "-") first = "";          // EDGAR uses "-" when the related person is an entity
    const isPerson = !!first;                // keep humans (warm-path targets), skip GP entities
    if (!isPerson) continue;
    const name = [first, mid, last].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    if (!name) continue;
    const roles = (info.match(/<relationship>([\s\S]*?)<\/relationship>/gi) || [])
      .map((r) => r.replace(/<[^>]+>/g, "").trim()).filter(Boolean);
    const clar = tag(info, "relationshipClarification");
    out.push({ name, roles, note: clar });
  }
  return out;
}

function parseOffering(xml) {
  const investorsBlock = (xml.match(/<investors>([\s\S]*?)<\/investors>/i) || [])[1] || "";
  return {
    total: numOrNull(tag(xml, "totalOfferingAmount")),
    sold: numOrNull(tag(xml, "totalAmountSold")),
    minInvestment: numOrNull(tag(xml, "minimumInvestmentAccepted")),
    investorCount: numOrNull(tag(investorsBlock, "totalNumberAlreadyInvested")),
    allAccredited: /<hasNonAccreditedInvestors>\s*false\s*<\/hasNonAccreditedInvestors>/i.test(xml),
    fundType: tag(xml, "investmentFundType") || tag(xml, "industryGroupType") || "",
  };
}

function score(p, preset) {
  let s = 45;
  // recency
  const days = (Date.now() - new Date(p.date).getTime()) / 86400000;
  if (days <= 90) s += 22; else if (days <= 180) s += 14; else if (days <= 365) s += 6;
  // named principals = a warm-path target exists
  if (p.principals && p.principals.length) s += Math.min(18, 6 + p.principals.length * 3);
  // US-based
  if (/[A-Z]{2}$/.test((p.location || "").trim()) || /,\s*[A-Z]{2}$/.test(p.location || "")) s += 6;
  // AI signal in the name
  if (/artificial intelligence|\bAI\b|machine learning|neural/i.test(p.name)) s += 8;
  // a stated minimum check is a useful qualification signal
  if (p.offering && p.offering.minInvestment) s += 6;
  // 506(b) aligns with how Cascade typically operates (relationship-based)
  if (p.exemption === "506(b)") s += 5;
  return Math.max(1, Math.min(99, Math.round(s)));
}

async function fetchText(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error("SEC " + r.status);
  return r.text();
}

module.exports = async (req, res) => {
  try {
    const u = new URL(req.url, "http://localhost");
    const presetKey = u.searchParams.get("preset") || "ai-funds";
    const cfg = PRESETS[presetKey] || PRESETS["ai-funds"];

    const end = new Date();
    const start = new Date(end.getTime() - 365 * 86400000);
    const fts =
      "https://efts.sec.gov/LATEST/search-index?q=" + encodeURIComponent(cfg.q) +
      "&forms=" + encodeURIComponent(cfg.forms) +
      "&dateRange=custom&startdt=" + ymd(start) + "&enddt=" + ymd(end);

    const r = await fetch(fts, { headers: H });
    if (!r.ok) throw new Error("SEC FTS " + r.status);
    const data = await r.json();
    const hits = (data.hits && data.hits.hits) || [];

    let prospects = hits.slice(0, 30).map((h) => {
      const s = h._source || {};
      const cik = (s.ciks && s.ciks[0]) || "";
      const adsh = s.adsh || "";
      return {
        name: ((s.display_names && s.display_names[0]) || "").replace(/\s*\(CIK[^)]*\)\s*$/i, "").trim(),
        cik,
        adsh,
        form: s.form || "",
        date: s.file_date || "",
        location: (s.biz_locations && s.biz_locations[0]) || "",
        incState: (s.inc_states && s.inc_states[0]) || "",
        exemption: pickExemption(s.items),
        principals: [],
        offering: null,
        filingUrl: cik && adsh
          ? "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=" + cik + "&type=" + (cfg.forms.split(",")[0]) + "&dateb=&owner=include&count=40"
          : "https://www.sec.gov/cgi-bin/browse-edgar",
      };
    });

    // Enrich top Form D filings with the named related persons + offering size.
    // Done in small batches to stay well within SEC's fair-access rate limits.
    if (cfg.enrich) {
      const top = prospects.slice(0, 12);
      const enrichOne = async (p) => {
        try {
          if (!p.cik || !p.adsh) return;
          const accNo = p.adsh.replace(/-/g, "");
          const docUrl = "https://www.sec.gov/Archives/edgar/data/" + parseInt(p.cik, 10) + "/" + accNo + "/primary_doc.xml";
          const xml = await fetchText(docUrl);
          p.principals = parsePersons(xml).slice(0, 6);
          p.offering = parseOffering(xml);
        } catch (e) { /* leave unenriched */ }
      };
      for (let i = 0; i < top.length; i += 4) {
        await Promise.all(top.slice(i, i + 4).map(enrichOne));
      }
    }

    prospects = prospects
      .map((p) => ({ ...p, score: score(p, presetKey) }))
      .sort((a, b) => b.score - a.score);

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
    res.status(200).json({
      preset: presetKey,
      label: cfg.label,
      asOf: new Date().toISOString(),
      total: prospects.length,
      source: fts,
      prospects,
    });
  } catch (e) {
    res.setHeader("Content-Type", "application/json");
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};

// Exposed for local unit testing (harmless on Vercel, which invokes the default export).
module.exports.parsePersons = parsePersons;
module.exports.parseOffering = parseOffering;
module.exports.pickExemption = pickExemption;
module.exports.score = score;
