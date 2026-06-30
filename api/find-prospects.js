// Live prospect sourcing from the public SEC IAPD (Investment Adviser) registry.
// Channels: RIAs (wealth advisers) and family offices — the allocator universe.
// No API key required. These are SOURCING SIGNALS to begin a relationship under
// 506(b); not an offer or solicitation, and accreditation is never assumed.
//
// Richer mandate / AUM / contact data (e.g. FINTRX, AdvizorPro, Altss) is the paid
// upgrade that would layer on top of this free public base.

const UA = "Cascade Investor Engine prototype (contact: investor-engine@example.com)";

const PRESETS = {
  "family-office":  { q: "family office",           label: "Family offices" },
  "mfo":            { q: "multi family office",      label: "Multi-family offices" },
  "private-wealth": { q: "private wealth",           label: "RIAs — private wealth" },
  "alternatives":   { q: "alternative investments",  label: "RIAs — alternatives" },
};

function parseAddr(s) {
  try { return (JSON.parse(s || "{}").officeAddress) || {}; }
  catch (e) { return {}; }
}

function scoreFirm(f, qlc) {
  let s = 48;
  if (f.active) s += 16;
  if (f.country === "United States" || !f.country) s += 8;
  if (f.branches >= 5) s += 10; else if (f.branches >= 1) s += 5;     // larger practice = more clients
  const nlc = (f.name || "").toLowerCase();
  if (nlc.includes("family office")) s += 10;
  if (nlc.includes("wealth") || nlc.includes("capital") || nlc.includes("private")) s += 5;
  if (qlc && nlc.includes(qlc.split(" ")[0])) s += 4;
  return Math.max(1, Math.min(99, Math.round(s)));
}

async function iapdSearch(query) {
  const url = "https://api.adviserinfo.sec.gov/search/firm?query=" + encodeURIComponent(query) +
              "&hits=40&type=Firm&investmentAdvisors=true&includePrevious=true";
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
  if (!r.ok) throw new Error("IAPD " + r.status);
  const data = await r.json();
  const hits = (data.hits && data.hits.hits) || [];
  const qlc = (query || "").toLowerCase();
  let firms = hits.map((h) => {
    const s = h._source || {};
    const a = parseAddr(s.firm_ia_address_details);
    return {
      name: s.firm_name || "",
      crd: s.firm_source_id || "",
      sec: s.firm_ia_full_sec_number || "",
      active: s.firm_ia_scope === "ACTIVE",
      branches: s.firm_branches_count || 0,
      city: a.city || "",
      state: a.state || "",
      country: a.country || "",
      otherNames: (s.firm_other_names || []).filter((n) => n !== s.firm_name).slice(0, 2),
      profileUrl: "https://adviserinfo.sec.gov/firm/summary/" + (s.firm_source_id || ""),
    };
  }).filter((f) => f.name && f.active);
  return firms
    .map((f) => ({ ...f, score: scoreFirm(f, qlc) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 30);
}

module.exports = async (req, res) => {
  try {
    const u = new URL(req.url, "http://localhost");
    const presetKey = u.searchParams.get("preset") || "family-office";
    const cfg = PRESETS[presetKey] || PRESETS["family-office"];
    const query = (u.searchParams.get("query") || "").trim() || cfg.q;
    const stateF = (u.searchParams.get("state") || "").trim().toUpperCase();

    let prospects = await iapdSearch(query);
    if (stateF) prospects = prospects.filter((f) => (f.state || "").toUpperCase() === stateF);

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
    res.status(200).json({
      source: "iapd",
      preset: presetKey,
      label: cfg.label,
      query,
      asOf: new Date().toISOString(),
      total: prospects.length,
      prospects,
    });
  } catch (e) {
    res.setHeader("Content-Type", "application/json");
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};

// Exposed for local unit testing (harmless on Vercel).
module.exports.parseAddr = parseAddr;
module.exports.scoreFirm = scoreFirm;
