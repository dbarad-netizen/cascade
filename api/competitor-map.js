// Competitor LP Map — live, public SEC Form D data.
// Given a competitor name, returns the fund vehicles they've raised, the feeder /
// distribution channels pooling capital into them, the NAMED related persons
// (GPs, officers, signatories) and placement agents — i.e., real names for outreach.
//
// LP identities are confidential and never disclosed. This is public competitive
// intelligence; outreach must be relationship-building under 506(b), not solicitation.

const UA = "Cascade Investor Engine prototype (contact: investor-engine@example.com)";

function tag(xml, name) {
  const m = xml.match(new RegExp("<" + name + ">([\\s\\S]*?)</" + name + ">", "i"));
  return m ? m[1].trim() : "";
}
function numOrNull(v) { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
function pickExemption(items) {
  const it = (items || []).map((x) => String(x).toUpperCase());
  if (it.includes("06C")) return "506(c)";
  if (it.includes("06B")) return "506(b)";
  return "—";
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
    if (first === "-") first = "";
    if (!first) continue; // keep humans, skip GP entity rows
    const name = [first, mid, last].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    if (!name) continue;
    const roles = (info.match(/<relationship>([\s\S]*?)<\/relationship>/gi) || [])
      .map((r) => r.replace(/<[^>]+>/g, "").trim()).filter(Boolean);
    out.push({ name, roles });
  }
  return out;
}

function parseAgents(xml) {
  const block = (xml.match(/<salesCompensationList>([\s\S]*?)<\/salesCompensationList>/i) || [])[1] || "";
  const recips = block.match(/<recipient>([\s\S]*?)<\/recipient>/gi) || [];
  const out = [];
  for (const r of recips) {
    const name = tag(r, "recipientName");
    if (!name || /^none$/i.test(name)) continue;
    const crd = tag(r, "recipientCRDNumber");
    out.push({ name, crd: crd && !/^none$/i.test(crd) ? crd : "" });
  }
  return out;
}

function parseOffering(xml) {
  const inv = (xml.match(/<investors>([\s\S]*?)<\/investors>/i) || [])[1] || "";
  return {
    sold: numOrNull(tag(xml, "totalAmountSold")),
    minInvestment: numOrNull(tag(xml, "minimumInvestmentAccepted")),
    investorCount: numOrNull(tag(inv, "totalNumberAlreadyInvested")),
  };
}

function classify(name) {
  const n = (name || "").toLowerCase();
  if (/access fund|feeder/.test(n)) return "feeder";
  if (/holdings|co-?invest|spv/.test(n)) return "spv";
  return "fund";
}
// In a feeder like "IEQ Capital Access Fund - 137 Ventures Fund VII", the sponsor is the prefix.
function sponsorOf(name) {
  const m = (name || "").match(/^(.*?)\s+access fund/i);
  return m ? m[1].trim() : "";
}

async function fetchText(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error("SEC " + r.status);
  return r.text();
}

module.exports = async (req, res) => {
  try {
    const u = new URL(req.url, "http://localhost");
    const query = (u.searchParams.get("query") || "").trim();
    if (!query) { res.status(400).json({ error: "Provide a competitor name (?query=...)." }); return; }

    const end = new Date();
    const start = new Date(end.getTime() - 1095 * 86400000); // last ~3 years
    const ymd = (d) => d.toISOString().slice(0, 10);
    const fts = "https://efts.sec.gov/LATEST/search-index?q=" + encodeURIComponent('"' + query + '"') +
      "&forms=D&dateRange=custom&startdt=" + ymd(start) + "&enddt=" + ymd(end);
    const r = await fetch(fts, { headers: { "User-Agent": UA, "Accept": "application/json" } });
    if (!r.ok) throw new Error("SEC FTS " + r.status);
    const data = await r.json();
    const hits = (data.hits && data.hits.hits) || [];

    let vehicles = hits.slice(0, 40).map((h) => {
      const s = h._source || {};
      const cik = (s.ciks && s.ciks[0]) || "";
      const adsh = s.adsh || "";
      const name = ((s.display_names && s.display_names[0]) || "").replace(/\s*\(CIK[^)]*\)\s*$/i, "").trim();
      return {
        name, cik, adsh, form: s.form || "", date: s.file_date || "",
        location: (s.biz_locations && s.biz_locations[0]) || "",
        exemption: pickExemption(s.items),
        klass: classify(name), sponsor: sponsorOf(name),
        persons: [], agents: [], offering: null,
        filingUrl: cik ? "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=" + cik + "&type=D&dateb=&owner=include&count=40" : "https://www.sec.gov/cgi-bin/browse-edgar",
      };
    }).sort((a, b) => (b.date || "").localeCompare(a.date || ""));

    // Enrich the most recent filings with named people + agents + raise size.
    const top = vehicles.slice(0, 14);
    const enrichOne = async (v) => {
      try {
        if (!v.cik || !v.adsh) return;
        const accNo = v.adsh.replace(/-/g, "");
        const xml = await fetchText("https://www.sec.gov/Archives/edgar/data/" + parseInt(v.cik, 10) + "/" + accNo + "/primary_doc.xml");
        v.persons = parsePersons(xml).slice(0, 8);
        v.agents = parseAgents(xml).slice(0, 4);
        v.offering = parseOffering(xml);
      } catch (e) { /* leave unenriched */ }
    };
    for (let i = 0; i < top.length; i += 4) await Promise.all(top.slice(i, i + 4).map(enrichOne));

    // Aggregate: dedup named people, tag with source vehicle + whether they're a channel contact.
    const peopleMap = {};
    for (const v of vehicles) {
      const isChannel = v.klass === "feeder" || !!v.sponsor;
      for (const p of (v.persons || [])) {
        const key = p.name.toLowerCase();
        if (!peopleMap[key]) peopleMap[key] = { name: p.name, roles: [], vehicle: v.name, sponsor: v.sponsor || "", channel: isChannel };
        for (const role of p.roles) if (!peopleMap[key].roles.includes(role)) peopleMap[key].roles.push(role);
        if (isChannel) peopleMap[key].channel = true;
      }
    }
    const people = Object.values(peopleMap).sort((a, b) => (b.channel - a.channel));

    // Channels: feeders + named placement agents.
    const feeders = vehicles.filter((v) => v.klass === "feeder" || v.sponsor).map((v) => ({
      name: v.name, sponsor: v.sponsor, date: v.date, exemption: v.exemption,
      sold: v.offering && v.offering.sold, investors: v.offering && v.offering.investorCount,
    }));
    const agentMap = {};
    for (const v of vehicles) for (const a of (v.agents || [])) {
      const k = a.name.toLowerCase(); if (!agentMap[k]) agentMap[k] = a;
    }
    const placementAgents = Object.values(agentMap);

    const counts = vehicles.reduce((m, v) => { m[v.klass] = (m[v.klass] || 0) + 1; return m; }, {});

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
    res.status(200).json({
      query, asOf: new Date().toISOString(),
      totalFilings: hits.length, counts,
      vehicles, feeders, placementAgents, people,
    });
  } catch (e) {
    res.setHeader("Content-Type", "application/json");
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};

// Exposed for local unit testing.
module.exports.parsePersons = parsePersons;
module.exports.parseAgents = parseAgents;
module.exports.classify = classify;
module.exports.sponsorOf = sponsorOf;
