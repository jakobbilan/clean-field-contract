/* Numbers behind the figures. Each entry names its source; the keys match the reference list in index.html.
   After editing, run: node tools/figures.mjs (rewrites the CSV files in data/figures). */
window.CFC_DATA = {
  // Official counts of paddy-residue burning events in Punjab, 15 September to 30 November
  counts: [
    { season: 2021, fires: 71304, ref: "pib2022" },
    { season: 2022, fires: 49922, ref: "pib2022" },
    { season: 2023, fires: 36663, ref: "pib2023" },
    { season: 2024, fires: 10909, ref: "air2025" },
    { season: 2025, fires: 5114, ref: "trib2025" },
    { season: 2026, fires: 7159, partial: "to 25 Nov", ref: "nh2026" }
  ],
  // Burnt area in lakh hectares (1 lakh hectares = 1,000 km2)
  burnt: [
    { method: "PRSC", season: 2021, lakhHa: 15.47, ref: "ht2022" },
    { method: "PRSC", season: 2023, lakhHa: 19.14, ref: "newsdrum2025" },
    { method: "PRSC", season: 2024, lakhHa: 19.17, ref: "newsdrum2025" },
    { method: "iFOREST", season: 2022, lakhHa: 31.447, ref: "iforest2025" },
    { method: "iFOREST", season: 2025, lakhHa: 20.0, partial: "images to 27 Nov", ref: "iforest2025" }
  ],
  // Timing of burning, local time in hours: satellite passes and share after 15:00 from iFOREST (SEVIRI);
  // peak hour from Singh et al. 2025 (Current Science)
  clock: {
    passes: [ { t: 10.5, time: "10:30", sats: "Terra, Sentinel-2" }, { t: 13.5, time: "13:30", sats: "Aqua, VIIRS" } ],
    peaks: [ { year: 2020, t: 13.5, label: "about 13:30" }, { year: 2024, t: 17, label: "about 17:00" } ],
    shares: [ { label: "2021", after: 3 }, { label: "2024 and 2025", after: 90, more: true } ]
  },
  // Price paid per acre in the 2022 rice season; CEEW survey microdata, our calculation
  costs: [
    { route: "Super Seeder", detail: "hired with a tractor", n: 249, p25: 2000, med: 2200, p75: 2500 },
    { route: "Happy Seeder", detail: "hired with a tractor", n: 40, p25: 1775, med: 2000, p75: 2400 },
    { route: "Rotavator", detail: "hired with a tractor", n: 58, p25: 1500, med: 1750, p75: 2000 },
    { route: "Straw removal", detail: "paid to an aggregator", n: 135, p25: 700, med: 1000, p75: 1500 }
  ],
  // Jack, Jayachandran, Kala and Pande (2025), Table 1, p. 48: effects in percentage points, standard errors
  trial: [
    { measure: "Satellite measure, maximum accuracy", control: 9.1, arm: "Paid only after verification", est: 2.0, se: 3.0 },
    { measure: "Satellite measure, maximum accuracy", control: 9.1, arm: "Part paid up front", est: 7.7, se: 3.2 },
    { measure: "Satellite measure, balanced accuracy", control: 20.2, arm: "Paid only after verification", est: 0.8, se: 4.2 },
    { measure: "Satellite measure, balanced accuracy", control: 20.2, arm: "Part paid up front", est: 11.5, se: 4.2 }
  ],
  // Contract terms (group design, Weeks 7 to 9)
  contract: { advance: 500, final: 2000, fullAcres: 10, halfToAcres: 25 },
  // Cost model, workbook of 27 October 2026; full-scale year unless stated
  model: {
    enrolledLakhAcres: 54.04,          // 85% take-up of 63.58 lakh acres of non-basmati paddy
    deathsPerAcre: 0.008022,           // 380 deaths per 1% cut (Lan et al. 2022) over 47.37 lakh burnt acres (2024)
    publicFixedCrore: 679,             // payments that do not depend on the effect (621) plus administration (58)
    publicPerPointCrore: 7.6,          // extra final payments per percentage point of effect
    breakEven: 0.21, assumed: 10, passMark: 5, trialLow: 7.7, trialHigh: 11.5,
    punjabCrore: 281, centreCrore: 355, delhiCrore: 118, publicCrore: 755,
    npv: [ { label: "Cautious case", crore: 18027, bcr: 6.8 }, { label: "Indian value of a statistical life", crore: 35571, bcr: 19.1 }, { label: "Workbook central values", crore: 127279, bcr: 42.1 } ]
  },
  // Places on the map
  cities: [
    { name: "Delhi", lon: 77.209, lat: 28.6139 },
    { name: "Chandigarh", lon: 76.7794, lat: 30.7333 },
    { name: "Lahore", lon: 74.3587, lat: 31.5204 },
    { name: "Ludhiana", lon: 75.8573, lat: 30.901 },
    { name: "Jalandhar", lon: 75.5762, lat: 31.326 },
    { name: "Amritsar", lon: 74.8723, lat: 31.634 },
    { name: "Bathinda", lon: 74.9455, lat: 30.211 },
    { name: "Patiala", lon: 76.3869, lat: 30.3398 },
    { name: "Sangrur", lon: 75.8421, lat: 30.2458 }
  ],
  // Field view: the area of the 30 m satellite image (same bounds as FIELD_SCENE in pipeline/config.py)
  field: { bounds: [75.35, 29.95, 76.35, 30.55] }
};
