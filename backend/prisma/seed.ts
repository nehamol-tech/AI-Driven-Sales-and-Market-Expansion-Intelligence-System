import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * All 28 Indian states + 8 union territories with ISO/commonly-used codes
 * and their conventional region. Factual reference data only — no invented
 * statistics.
 */
const STATES: { name: string; code: string; region: string }[] = [
  { name: "Andhra Pradesh", code: "AP", region: "South" },
  { name: "Arunachal Pradesh", code: "AR", region: "Northeast" },
  { name: "Assam", code: "AS", region: "Northeast" },
  { name: "Bihar", code: "BR", region: "East" },
  { name: "Chhattisgarh", code: "CG", region: "Central" },
  { name: "Goa", code: "GA", region: "West" },
  { name: "Gujarat", code: "GJ", region: "West" },
  { name: "Haryana", code: "HR", region: "North" },
  { name: "Himachal Pradesh", code: "HP", region: "North" },
  { name: "Jharkhand", code: "JH", region: "East" },
  { name: "Karnataka", code: "KA", region: "South" },
  { name: "Kerala", code: "KL", region: "South" },
  { name: "Madhya Pradesh", code: "MP", region: "Central" },
  { name: "Maharashtra", code: "MH", region: "West" },
  { name: "Manipur", code: "MN", region: "Northeast" },
  { name: "Meghalaya", code: "ML", region: "Northeast" },
  { name: "Mizoram", code: "MZ", region: "Northeast" },
  { name: "Nagaland", code: "NL", region: "Northeast" },
  { name: "Odisha", code: "OD", region: "East" },
  { name: "Punjab", code: "PB", region: "North" },
  { name: "Rajasthan", code: "RJ", region: "North" },
  { name: "Sikkim", code: "SK", region: "Northeast" },
  { name: "Tamil Nadu", code: "TN", region: "South" },
  { name: "Telangana", code: "TG", region: "South" },
  { name: "Tripura", code: "TR", region: "Northeast" },
  { name: "Uttar Pradesh", code: "UP", region: "North" },
  { name: "Uttarakhand", code: "UK", region: "North" },
  { name: "West Bengal", code: "WB", region: "East" },
  // Union territories
  { name: "Andaman and Nicobar Islands", code: "AN", region: "South" },
  { name: "Chandigarh", code: "CH", region: "North" },
  { name: "Dadra and Nagar Haveli and Daman and Diu", code: "DN", region: "West" },
  { name: "Delhi", code: "DL", region: "North" },
  { name: "Jammu and Kashmir", code: "JK", region: "North" },
  { name: "Ladakh", code: "LA", region: "North" },
  { name: "Lakshadweep", code: "LD", region: "South" },
  { name: "Puducherry", code: "PY", region: "South" },
];

const TIER_1_CITIES = new Set(["Mumbai", "Delhi", "Bengaluru", "Chennai", "Hyderabad", "Pune", "Kolkata", "Ahmedabad"]);

/**
 * Curated list of well-known major business cities per state/UT. Cities are
 * category/reference data (real place names), not market-size claims.
 * Tier-1 metros get tier=1, other well-recognized business hubs get tier=2,
 * anything else is left untiered (null).
 */
const CITIES_BY_STATE: Record<string, { name: string; tier: 1 | 2 | null }[]> = {
  "Andhra Pradesh": [
    { name: "Visakhapatnam", tier: 2 },
    { name: "Vijayawada", tier: 2 },
    { name: "Guntur", tier: null },
    { name: "Tirupati", tier: null },
  ],
  Assam: [
    { name: "Guwahati", tier: 2 },
    { name: "Dibrugarh", tier: null },
  ],
  Bihar: [
    { name: "Patna", tier: 2 },
    { name: "Gaya", tier: null },
    { name: "Muzaffarpur", tier: null },
  ],
  Chhattisgarh: [
    { name: "Raipur", tier: 2 },
    { name: "Bhilai", tier: null },
  ],
  Goa: [
    { name: "Panaji", tier: null },
    { name: "Margao", tier: null },
  ],
  Gujarat: [
    { name: "Ahmedabad", tier: 1 },
    { name: "Surat", tier: 2 },
    { name: "Vadodara", tier: 2 },
    { name: "Rajkot", tier: 2 },
    { name: "Gandhinagar", tier: null },
  ],
  Haryana: [
    { name: "Gurugram", tier: 2 },
    { name: "Faridabad", tier: 2 },
    { name: "Panipat", tier: null },
  ],
  "Himachal Pradesh": [
    { name: "Shimla", tier: null },
    { name: "Solan", tier: null },
  ],
  Jharkhand: [
    { name: "Ranchi", tier: 2 },
    { name: "Jamshedpur", tier: 2 },
    { name: "Dhanbad", tier: null },
  ],
  Karnataka: [
    { name: "Bengaluru", tier: 1 },
    { name: "Mysuru", tier: 2 },
    { name: "Hubballi", tier: null },
    { name: "Mangaluru", tier: 2 },
  ],
  Kerala: [
    { name: "Kochi", tier: 2 },
    { name: "Thiruvananthapuram", tier: 2 },
    { name: "Kozhikode", tier: null },
  ],
  "Madhya Pradesh": [
    { name: "Indore", tier: 2 },
    { name: "Bhopal", tier: 2 },
    { name: "Gwalior", tier: null },
    { name: "Jabalpur", tier: null },
  ],
  Maharashtra: [
    { name: "Mumbai", tier: 1 },
    { name: "Pune", tier: 1 },
    { name: "Nagpur", tier: 2 },
    { name: "Nashik", tier: 2 },
    { name: "Aurangabad", tier: null },
  ],
  Odisha: [
    { name: "Bhubaneswar", tier: 2 },
    { name: "Cuttack", tier: null },
  ],
  Punjab: [
    { name: "Ludhiana", tier: 2 },
    { name: "Amritsar", tier: 2 },
    { name: "Jalandhar", tier: null },
    { name: "Chandigarh", tier: 2 },
  ],
  Rajasthan: [
    { name: "Jaipur", tier: 2 },
    { name: "Jodhpur", tier: 2 },
    { name: "Udaipur", tier: null },
    { name: "Kota", tier: null },
  ],
  "Tamil Nadu": [
    { name: "Chennai", tier: 1 },
    { name: "Coimbatore", tier: 2 },
    { name: "Madurai", tier: 2 },
    { name: "Tiruppur", tier: null },
  ],
  Telangana: [
    { name: "Hyderabad", tier: 1 },
    { name: "Warangal", tier: null },
  ],
  "Uttar Pradesh": [
    { name: "Lucknow", tier: 2 },
    { name: "Noida", tier: 2 },
    { name: "Kanpur", tier: 2 },
    { name: "Ghaziabad", tier: 2 },
    { name: "Varanasi", tier: null },
    { name: "Agra", tier: null },
  ],
  Uttarakhand: [
    { name: "Dehradun", tier: 2 },
    { name: "Haridwar", tier: null },
  ],
  "West Bengal": [
    { name: "Kolkata", tier: 1 },
    { name: "Howrah", tier: null },
    { name: "Siliguri", tier: null },
  ],
  Delhi: [{ name: "New Delhi", tier: 1 }],
  "Jammu and Kashmir": [
    { name: "Srinagar", tier: null },
    { name: "Jammu", tier: null },
  ],
  Puducherry: [{ name: "Puducherry", tier: null }],
  Chandigarh: [{ name: "Chandigarh", tier: 2 }],
  "Andaman and Nicobar Islands": [{ name: "Port Blair", tier: null }],
  "Dadra and Nagar Haveli and Daman and Diu": [{ name: "Daman", tier: null }],
  Ladakh: [{ name: "Leh", tier: null }],
  Lakshadweep: [{ name: "Kavaratti", tier: null }],
};

const INDUSTRIES: { name: string; description: string }[] = [
  { name: "Manufacturing", description: "General industrial and product manufacturing" },
  { name: "Textiles & Apparel", description: "Textile mills, garment manufacturing and apparel brands" },
  { name: "Pharmaceuticals", description: "Drug manufacturing, formulation and pharma distribution" },
  { name: "IT & Software Services", description: "Software development, IT services and technology firms" },
  { name: "FMCG", description: "Fast-moving consumer goods manufacturing and distribution" },
  { name: "Automotive & Auto Components", description: "Vehicle manufacturing and auto parts/components" },
  { name: "Construction & Real Estate", description: "Construction, infrastructure and real estate development" },
  { name: "Agriculture & Agro-processing", description: "Farming inputs, agri-produce and agro-processing" },
  { name: "Chemicals", description: "Industrial and specialty chemical manufacturing" },
  { name: "Electronics & Electrical Equipment", description: "Electronics, electrical goods and equipment manufacturing" },
  { name: "Logistics & Warehousing", description: "Freight, transportation, warehousing and supply chain" },
  { name: "Healthcare", description: "Hospitals, clinics and healthcare service providers" },
  { name: "Retail & E-commerce", description: "Retail chains and e-commerce businesses" },
  { name: "Hospitality", description: "Hotels, restaurants and hospitality services" },
  { name: "Education", description: "Schools, colleges, training and educational institutions" },
];

const BUSINESS_TYPES: { name: string; description: string }[] = [
  { name: "Manufacturer", description: "Produces goods from raw materials or components" },
  { name: "Wholesaler", description: "Buys in bulk and sells to retailers or other businesses" },
  { name: "Distributor", description: "Distributes products on behalf of manufacturers to a region" },
  { name: "Retailer", description: "Sells goods directly to end consumers" },
  { name: "Trader/Reseller", description: "Buys and resells goods without significant transformation" },
  { name: "Exporter/Importer", description: "Trades goods across international borders" },
  { name: "Service Provider", description: "Delivers services rather than physical goods" },
];

async function seedStates(): Promise<Map<string, string>> {
  const nameToId = new Map<string, string>();
  for (const state of STATES) {
    const record = await prisma.state.upsert({
      where: { name: state.name },
      create: { name: state.name, code: state.code, region: state.region },
      update: { code: state.code, region: state.region },
    });
    nameToId.set(state.name, record.id);
  }
  console.log(`Seeded ${STATES.length} states/union territories.`);
  return nameToId;
}

async function seedCities(stateNameToId: Map<string, string>): Promise<void> {
  let count = 0;
  for (const [stateName, cities] of Object.entries(CITIES_BY_STATE)) {
    const stateId = stateNameToId.get(stateName);
    if (!stateId) {
      console.warn(`Skipping cities for unknown state "${stateName}"`);
      continue;
    }
    for (const city of cities) {
      const tier = TIER_1_CITIES.has(city.name) ? 1 : city.tier;
      await prisma.city.upsert({
        where: { name_stateId: { name: city.name, stateId } },
        create: { name: city.name, stateId, tier },
        update: { tier },
      });
      count += 1;
    }
  }
  console.log(`Seeded ${count} cities.`);
}

async function seedIndustries(): Promise<void> {
  for (const industry of INDUSTRIES) {
    await prisma.industry.upsert({
      where: { name: industry.name },
      create: industry,
      update: { description: industry.description },
    });
  }
  console.log(`Seeded ${INDUSTRIES.length} industries.`);
}

async function seedBusinessTypes(): Promise<void> {
  for (const businessType of BUSINESS_TYPES) {
    await prisma.businessType.upsert({
      where: { name: businessType.name },
      create: businessType,
      update: { description: businessType.description },
    });
  }
  console.log(`Seeded ${BUSINESS_TYPES.length} business types.`);
}

async function main(): Promise<void> {
  console.log("Seeding reference data (states, cities, industries, business types)...");
  const stateNameToId = await seedStates();
  await seedCities(stateNameToId);
  await seedIndustries();
  await seedBusinessTypes();
  console.log("Seed complete.");
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
