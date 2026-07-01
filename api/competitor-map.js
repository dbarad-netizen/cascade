// GET /api/competitor-map?query=<competitor name>
// Live scan of SEC EDGAR Form D filings (full-text search) for a competitor:
// fund vehicles, feeder/distribution channels, named related persons, placement agents.
// v2: surfaces investor counts & average check per feeder — evidence of HNW-individual
// participation at $100k–$1M ticket sizes (Cascade's priority segment).

const UA = { "User-Agent": "CascadeInvestorEngine/2.0 research prototype (contact via cascade)" };

export default async function handler(req, res) {
  try {
    const query = String(req.query.query || "").trim();
    if (!query) {
      res.status(400).json({ error: "Missing ?query=" });
      return;
    }

    const ftsUrl =
      "https://efts.sec.gov/LATEST/search-index?q=" +
      encodeURIComponent('"' + query + '"') +
      "&forms=D";
    const r = await fetch(ftsUrl, { headers: UA });
    if (!r.ok) {
      res.status(502).json({ error: "SEC EDGAR full-text search returned HTTP " + r.status });
      return;
    }
    const data = await r.json();
    const hits = (data.hits && data.hits.hits) || [];

    // one entry per entity (CIK), keep the most recent filing
    const byCik = {};
    for (const h of hits) {
      const s = h._source || {};
      const cik = (s.ciks && s.ciks[0]) || null;
      if (!cik) continue;
      if (!byCik[cik] || s.file_date > byCik[cik].file_date) {
        byCik[cik] = {
          cik,
          adsh: s.adsh,
          name: ((s.display_names && s.display_names[0]) || "").replace(/\s*\(CIK.*$/, ""),
          file_date: s.file_date,
          items: s.items || [],
        };
      }
    }
    const entities = Object.values(byCik);

    const classify = (name) => {
      const n = name.toLowerCase();
      if (/access fund|feeder/.test(n)) return "feeder";
      if (/holdings|series|co-invest|spv/.test(n)) return "spv";
      return "fund";
    };
    const counts = { fund: 0, feeder: 0, spv: 0 };
    entities.forEach((e) => { e.kind = classify(e.name); counts[e.kind]++; });

    const exemptionOf = (items) =>
      items.some((i) => /06C/i.test(i)) ? "506(c)" : (items.some((i) => /06B?/i.test(i)) ? "506(b)" : "Reg D");

    // enrich a handful of filings with primary_doc.xml (feeders first, then recent funds)
    const toEnrich = entities
      .sort((a, b) => (a.kind === "feeder" ? -1 : 1) - (b.kind === "feeder" ? -1 : 1) || (b.file_date > a.file_date ? 1 : -1))
      .slice(0, 8);

    const enriched = await Promise.all(
      toEnrich.map(async (e) => {
        try {
          const url =
            "https://www.sec.gov/Archives/edgar/data/" +
            parseInt(e.cik, 10) +
            "/" +
            e.adsh.replace(/-/g, "") +
            "/primary_doc.xml";
          const rr = await fetch(url, { headers: UA });
          if (!rr.ok) return { ...e };
          const xml = await rr.text();
          return { ...e, ...parseFormD(xml) };
        } catch {
          return { ...e };
        }
      })
    );
    const enrichedByCik = {};
    enriched.forEach((e) => { enrichedByCik[e.cik] = e; });

    // feeders: channel vehicles + sponsor extraction ("IEQ Capital Access Fund - X" -> "IEQ Capital")
    const feeders = entities
      .filter((e) => e.kind === "feeder")
      .map((e) => {
        const en = enrichedByCik[e.cik] || e;
        const m = e.name.match(/^(.*?)\s+(access fund|feeder)/i);
        return {
          name: e.name,
          sponsor: m ? m[1].trim() : null,
          exemption: exemptionOf(e.items),
          date: e.file_date,
          sold: en.sold || null,
          investors: en.investors || null,
          minimum: en.minimum || null,
        };
      });

    // named people across enriched filings
    const seen = {};
    const people = [];
    for (const e of enriched) {
      for (const p of e.persons || []) {
        const key = p.name.toLowerCase();
        if (seen[key]) continue;
        seen[key] = true;
        people.push({
          name: p.name,
          roles: p.roles,
          vehicle: e.name,
          channel: e.kind === "feeder",
        });
      }
    }
    // channel people first
    people.sort((a, b) => (b.channel ? 1 : 0) - (a.channel ? 1 : 0));

    // placement agents
    const agentSeen = {};
    const placementAgents = [];
    for (const e of enriched) {
      for (const a of e.agents || []) {
        const key = a.name.toLowerCase();
        if (agentSeen[key]) continue;
        agentSeen[key] = true;
        placementAgents.push(a);
      }
    }

    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
    res.status(200).json({
      query,
      totalFilings: hits.length,
      counts,
      asOf: new Date().toISOString(),
      feeders,
      people,
      placementAgents,
    });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
}

/* ---- minimal Form D XML parsing (no deps) ---- */
function tag(xml, name) {
  const m = xml.match(new RegExp("<" + name + ">([\\s\\S]*?)</" + name + ">"));
  return m ? m[1].trim() : null;
}
function tags(xml, name) {
  const out = [];
  const re = new RegExp("<" + name + ">([\\s\\S]*?)</" + name + ">", "g");
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}
function parseFormD(xml) {
  const persons = tags(xml, "relatedPersonInfo").map((b) => {
    const first = tag(b, "firstName") || "";
    const last = tag(b, "lastName") || "";
    const name = (first === "-" || !first ? last : first + " " + last).trim();
    const roles = tags(b, "relationship");
    const clar = tag(b, "relationshipClarification");
    if (clar) roles.push(clar);
    return { name, roles };
  }).filter((p) => p.name);

  const agents = tags(xml, "recipient").map((b) => ({
    name: (tag(b, "recipientName") || "").trim(),
    crd: (tag(b, "recipientCRDNumber") || "").replace(/none/i, "").trim() || null,
  })).filter((a) => a.name && !/none/i.test(a.name));

  const soldRaw = tag(xml, "totalAmountSold");
  const sold = soldRaw && /^\d+$/.test(soldRaw) ? parseInt(soldRaw, 10) : null;
  const invRaw = tag(xml, "totalNumberAlreadyInvested");
  const investors = invRaw && /^\d+$/.test(invRaw) ? parseInt(invRaw, 10) : null;
  const minRaw = tag(xml, "minimumInvestmentAccepted");
  const minimum = minRaw && /^\d+$/.test(minRaw) ? parseInt(minRaw, 10) : null;

  return { persons, agents, sold, investors, minimum };
}
