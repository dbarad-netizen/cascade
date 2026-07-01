// GET /api/find-prospects?preset=family-office|mfo|private-wealth|alternatives|physicians|attorneys|real-estate&query=&state=
// Live search of the public SEC IAPD (Investment Adviser) registry.
// v2: adds profession-focused presets (advisers to physicians / attorneys / real-estate wealth)
// — the channels that aggregate Cascade's priority HNW-individual segment.

const PRESETS = {
  "family-office":  { q: "family office",        label: "Family offices" },
  "mfo":            { q: "multi-family office",  label: "Multi-family offices" },
  "private-wealth": { q: "private wealth",       label: "RIAs — private wealth" },
  "alternatives":   { q: "alternatives",         label: "RIAs — alternatives" },
  "physicians":     { q: "physician",            label: "Advisers to physicians & medical-practice owners", hnw: true, kw: ["physician", "doctor", "medical", "dental", "md "] },
  "attorneys":      { q: "attorney",             label: "Advisers to attorneys & law-firm partners",        hnw: true, kw: ["attorney", "lawyer", "legal", "counsel", "law "] },
  "real-estate":    { q: "real estate wealth",   label: "Real-estate wealth advisers",                      hnw: true, kw: ["real estate", "realty", "property", "1031"] },
};

export default async function handler(req, res) {
  try {
    const preset = String(req.query.preset || "family-office");
    const p = PRESETS[preset] || PRESETS["family-office"];
    const query = String(req.query.query || "").trim();
    const stateF = String(req.query.state || "").trim().toUpperCase();
    const term = query || p.q;

    const url =
      "https://api.adviserinfo.sec.gov/search/firm?query=" +
      encodeURIComponent(term) +
      "&hits=40&type=Firm&investmentAdvisors=true";

    const r = await fetch(url, {
      headers: { "User-Agent": "CascadeInvestorEngine/2.0 (research prototype)" },
    });
    if (!r.ok) {
      res.status(502).json({ error: "SEC IAPD returned HTTP " + r.status });
      return;
    }
    const data = await r.json();
    const hits = (data.hits && data.hits.hits) || [];
    const kw = p.kw || term.toLowerCase().split(/\s+/);

    const prospects = hits
      .map((h) => {
        const s = h._source || {};
        let addr = {};
        try {
          addr = (JSON.parse(s.firm_ia_address_details || s.firm_address_details || "{}").officeAddress) || {};
        } catch (e) { /* ignore */ }
        const name = s.firm_name || "";
        const otherNames = (s.firm_other_names || []).filter(
          (n) => n && n.toUpperCase() !== name.toUpperCase()
        ).slice(0, 4);
        const active = s.firm_ia_scope === "ACTIVE" || s.firm_scope === "ACTIVE";
        const branches = s.firm_branches_count || 0;
        const sec = s.firm_ia_full_sec_number ? "SEC " + s.firm_ia_full_sec_number : null;
        const crd = s.firm_source_id || null;
        const isUS = !addr.country || /united states/i.test(addr.country || "");
        const nameBlob = (name + " " + (s.firm_other_names || []).join(" ")).toLowerCase();
        const kwHit = kw.some((k) => nameBlob.includes(k));

        // fit score: SEC registration, footprint, name relevance, US presence, no disclosures
        let score = 50;
        if (sec) score += 14;
        score += Math.min(12, branches * 2);
        if (kwHit) score += 12;
        if (isUS) score += 5;
        if ((s.firm_ia_disclosure_fl || s.firm_disclosure_fl) === "Y") score -= 8;
        score = Math.max(35, Math.min(97, score));

        return {
          name,
          otherNames,
          active,
          city: addr.city ? titleCase(addr.city) : null,
          state: addr.state || null,
          country: addr.country || null,
          branches,
          sec,
          crd,
          score,
          profileUrl: crd ? "https://adviserinfo.sec.gov/firm/summary/" + crd : "https://adviserinfo.sec.gov/",
        };
      })
      .filter((x) => x.active)
      .filter((x) => !stateF || x.state === stateF)
      .sort((a, b) => b.score - a.score);

    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
    res.status(200).json({
      label: p.label,
      query: query || null,
      hnwChannel: !!p.hnw,
      asOf: new Date().toISOString(),
      prospects,
    });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
}

function titleCase(s) {
  return String(s).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
