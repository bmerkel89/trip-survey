// Re-pulls seats.aero award availability for the East Africa honeymoon
// (US -> KGL arriving by Jan 22 2027, DAR -> US departing Feb 5-9 2027)
// and writes a digest to data/awards-latest.json for updating flight-finder.html.
//
// Usage: SEATS_API_KEY=pro_... node scripts/refresh-flights.mjs
// Falls back to the seats MCP server entry in ~/.claude.json if the env var is unset.
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';

let KEY = process.env.SEATS_API_KEY;
if (!KEY) {
  try {
    const cfg = JSON.parse(readFileSync(homedir() + '/.claude.json', 'utf8'));
    for (const proj of Object.values(cfg.projects || {}))
      KEY = KEY || proj.mcpServers?.seats?.env?.SEATS_API_KEY;
  } catch {}
}
if (!KEY) {
  console.error('No SEATS_API_KEY found in env or ~/.claude.json — cannot refresh.');
  process.exit(1);
}

// Programs Chase Ultimate Rewards points can reach (1:1 transfer, or via Avios interchange)
const UR = new Set(['aeroplan', 'united', 'virginatlantic', 'flyingblue', 'emirates', 'qatar']);
const US = 'JFK,EWR,PHL,IAD,BWI,LGA';
const HUBS_OUT = 'ADD,IST,DOH,DXB,AMS,BRU,NBO,LHR,CDG';
const HUBS_RET = 'ADD,IST,DOH,DXB,AMS,NBO,ZRH,CDG';

const QUERIES = {
  out_long:   { o: US, d: HUBS_OUT, s: '2027-01-19', e: '2027-01-21' },
  out_feed:   { o: HUBS_OUT, d: 'KGL', s: '2027-01-20', e: '2027-01-22' },
  ret_feed:   { o: 'DAR', d: HUBS_RET, s: '2027-02-05', e: '2027-02-08' },
  ret_long:   { o: HUBS_RET, d: US, s: '2027-02-06', e: '2027-02-09' },
};

const CA = '/root/.ccr/ca-bundle.crt';
const fetchQ = q => {
  const url = `https://seats.aero/partnerapi/search?origin_airport=${q.o}&destination_airport=${q.d}&start_date=${q.s}&end_date=${q.e}&take=1000`;
  return JSON.parse(execSync(
    `curl -s --cacert ${CA} -H "Partner-Authorization: ${KEY}" "${url}"`,
    { maxBuffer: 64e6 }
  ));
};

const out = { pulledAt: new Date().toISOString(), queries: {} };
for (const [name, q] of Object.entries(QUERIES)) {
  const r = fetchQ(q);
  const rows = [];
  for (const a of r.data || []) {
    if (!UR.has(a.Route.Source)) continue;
    if (a.Route.Source === 'emirates') continue; // tax data unreliable in their feed
    for (const [c, cab] of [['J', 'biz'], ['F', 'first'], ['W', 'prem'], ['Y', 'econ']]) {
      if (!a[c + 'Available']) continue;
      const seats = a[c + 'RemainingSeatsRaw'];
      if (seats > 0 && seats < 2) continue; // need 2 seats for the couple
      rows.push({
        rt: a.Route.OriginAirport + '-' + a.Route.DestinationAirport,
        src: a.Route.Source, date: a.Date, cab,
        miles: a[c + 'MileageCostRaw'],
        tax: Math.round(a[c + 'TotalTaxesRaw'] / 100),
        seats: seats || null,
        direct: a[c + 'DirectMileageCostRaw'] > 0,
      });
    }
  }
  rows.sort((a, b) => a.miles - b.miles);
  out.queries[name] = { total: r.count, rows };
  console.log(`${name}: ${rows.length} UR-usable fares (${r.count} raw)`);
}

mkdirSync('data', { recursive: true });
writeFileSync('data/awards-latest.json', JSON.stringify(out, null, 1));
console.log('Wrote data/awards-latest.json — pulled ' + out.pulledAt);
