// Writes the CSV files behind the figures from js/data.js. Run: node tools/figures.mjs
import fs from 'node:fs'; import vm from 'node:vm'; import path from 'node:path'; import url from 'node:url';
const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const ctx = { window: {} }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'js/data.js'), 'utf8'), ctx);
const D = ctx.window.CFC_DATA, out = path.join(root, 'data/figures');
fs.mkdirSync(out, { recursive: true });
const csv = (rows) => rows.map(r => r.map(v => (v === undefined || v === null) ? '' : (/[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v)).join(',')).join('\n') + '\n';
fs.writeFileSync(path.join(out, 'fig1-counts-burnt-area.csv'), csv([['measure', 'method', 'season', 'value', 'unit', 'note', 'source_key'],
  ...D.counts.map(c => ['fire count', 'official', c.season, c.fires, 'fires', c.partial || '', c.ref]),
  ...D.burnt.map(b => ['burnt area', b.method, b.season, b.lakhHa, 'lakh hectares', b.partial || '', b.ref])]));
fs.writeFileSync(path.join(out, 'fig3-hire-costs.csv'), csv([['route', 'detail', 'farmers', 'p25_inr_per_acre', 'median_inr_per_acre', 'p75_inr_per_acre'],
  ...D.costs.map(c => [c.route, c.detail, c.n, c.p25, c.med, c.p75])]));
fs.writeFileSync(path.join(out, 'fig4-trial.csv'), csv([['measure', 'control_share_pct', 'arm', 'effect_pp', 'se_pp', 'ci95_low', 'ci95_high'],
  ...D.trial.map(t => [t.measure, t.control, t.arm, t.est, t.se, (t.est - 1.96 * t.se).toFixed(1), (t.est + 1.96 * t.se).toFixed(1)])]));
console.log('wrote', fs.readdirSync(out).join(', '));
