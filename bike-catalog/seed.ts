import type { UpsertBikeInput } from "./lib/upsert";
import { upsertCatalogBike } from "./lib/upsert";
import { catalogPrisma, isCatalogConfigured } from "./lib/db";

const seedBikes: UpsertBikeInput[] = [
  {
    brandName: "Specialized",
    brandAliases: ["Specialized Bicycle Components", "SBC"],
    scraperKey: "specialized",
    model: "Stumpjumper Comp",
    family: "Stumpjumper",
    year: 2024,
    category: "Mountain",
    subcategory: "Trail",
    sourceUrl: "https://www.specialized.com/",
    components: [
      { slot: "FRAME_MATERIAL", value: "FACT 11m carbon" },
      { slot: "FORK", value: "Fox Float 34 Rhythm, 140mm" },
      { slot: "REAR_SHOCK", value: "Fox Float Performance" },
      { slot: "FRONT_TRAVEL", value: "140 mm" },
      { slot: "REAR_TRAVEL", value: "130 mm" },
      { slot: "SHIFTERS", value: "SRAM GX Eagle" },
      { slot: "REAR_DERAILLEUR", value: "SRAM GX Eagle, 12-speed" },
      { slot: "CASSETTE", value: "SRAM NX Eagle PG-1230, 11-50t" },
      { slot: "CRANKSET", value: "SRAM NX Eagle, 30t" },
      { slot: "CHAIN", value: "SRAM NX Eagle" },
      { slot: "BOTTOM_BRACKET", value: "SRAM DUB", standard: "BSA threaded" },
      { slot: "BRAKES", value: "SRAM Code R, 4-piston" },
      { slot: "DISC_ROTORS", value: "200/180mm" },
      { slot: "WHEEL_SIZE", value: '29"' },
      { slot: "TIRES", value: "Specialized Eliminator Grid Trail 2.3" },
      { slot: "DERAILLEUR_HANGER", value: "SRAM UDH", standard: "UDH" },
      { slot: "AXLE", value: "Boost 148mm rear / 110mm front" },
      { slot: "SADDLE", value: "Bridge Comp" },
      { slot: "HANDLEBAR", value: "Specialized Alloy Trail" },
    ],
  },
  {
    brandName: "Specialized",
    brandAliases: ["Specialized Bicycle Components", "SBC"],
    scraperKey: "specialized",
    model: "Allez Sport",
    family: "Allez",
    year: 2023,
    category: "Road",
    sourceUrl: "https://www.specialized.com/",
    components: [
      { slot: "FRAME_MATERIAL", value: "E5 Premium Aluminum" },
      { slot: "FORK", value: "Specialized FACT carbon" },
      { slot: "SHIFTERS", value: "Shimano Tiagra" },
      { slot: "REAR_DERAILLEUR", value: "Shimano Tiagra" },
      { slot: "FRONT_DERAILLEUR", value: "Shimano Tiagra" },
      { slot: "CASSETTE", value: "Shimano Tiagra, 12-28t" },
      { slot: "CRANKSET", value: "Shimano Tiagra, 50/34t" },
      { slot: "BOTTOM_BRACKET", value: "Shimano threaded", standard: "BSA 68mm" },
      { slot: "BRAKES", value: "Tektro rim brakes" },
      { slot: "WHEEL_SIZE", value: '700c' },
      { slot: "TIRES", value: "Specialized Espoir Sport 700x28" },
      { slot: "DERAILLEUR_HANGER", value: "Specialized replaceable" },
      { slot: "SADDLE", value: "Body Geometry Bridge" },
    ],
  },
  {
    brandName: "Schwinn",
    brandAliases: ["Schwinn Bicycle"],
    scraperKey: "schwinn",
    model: "High Timber",
    family: "High Timber",
    year: 2022,
    category: "Mountain",
    sourceUrl: "https://www.schwinnbikes.com/",
    components: [
      { slot: "FRAME_MATERIAL", value: "Aluminum" },
      { slot: "FORK", value: "SR Suntour XCT, 80mm" },
      { slot: "FRONT_TRAVEL", value: "80 mm" },
      { slot: "SHIFTERS", value: "Shimano Tourney" },
      { slot: "REAR_DERAILLEUR", value: "Shimano Tourney" },
      { slot: "CASSETTE", value: "7-speed freewheel" },
      { slot: "BRAKES", value: "Mechanical disc" },
      { slot: "WHEEL_SIZE", value: '27.5"' },
      { slot: "TIRES", value: "Schwinn MTB 27.5x2.1" },
      { slot: "BOTTOM_BRACKET", value: "Square taper", standard: "BSA" },
    ],
  },
  {
    brandName: "Trek",
    brandAliases: ["Trek Bicycle"],
    scraperKey: "trek",
    model: "Marlin 7",
    family: "Marlin",
    year: 2024,
    category: "Mountain",
    subcategory: "Trail",
    sourceUrl: "https://www.trekbikes.com/",
    components: [
      { slot: "FRAME_MATERIAL", value: "Alpha Gold Aluminum" },
      { slot: "FORK", value: "RockShox Judy Silver TK, 100mm" },
      { slot: "FRONT_TRAVEL", value: "100 mm" },
      { slot: "SHIFTERS", value: "Shimano Deore M4100" },
      { slot: "REAR_DERAILLEUR", value: "Shimano Deore M5120" },
      { slot: "CASSETTE", value: "Shimano Deore M4100, 11-46, 10-speed" },
      { slot: "CRANKSET", value: "Shimano MT511, 30t" },
      { slot: "BOTTOM_BRACKET", value: "Shimano BB52", standard: "BSA threaded" },
      { slot: "BRAKES", value: "Shimano MT200 hydraulic disc" },
      { slot: "DISC_ROTORS", value: "Shimano RT26 180/160mm" },
      { slot: "WHEEL_SIZE", value: '29"' },
      { slot: "TIRES", value: "Bontrager XR3 Comp 29x2.20" },
      { slot: "DERAILLEUR_HANGER", value: "Trek/Bontrager" },
      { slot: "AXLE", value: "Boost 148mm" },
      { slot: "SADDLE", value: "Bontrager Arvada" },
    ],
  },
  {
    brandName: "Giant",
    scraperKey: "giant",
    model: "Escape 3",
    family: "Escape",
    year: 2023,
    category: "Hybrid",
    sourceUrl: "https://www.giant-bicycles.com/",
    components: [
      { slot: "FRAME_MATERIAL", value: "ALUXX aluminum" },
      { slot: "FORK", value: "High-tensile steel" },
      { slot: "SHIFTERS", value: "Shimano Altus" },
      { slot: "REAR_DERAILLEUR", value: "Shimano Tourney" },
      { slot: "CASSETTE", value: "Shimano HG200, 12-32, 7-speed" },
      { slot: "BRAKES", value: "Tektro linear-pull" },
      { slot: "WHEEL_SIZE", value: '700c' },
      { slot: "TIRES", value: "Giant S-X3 700x38c" },
      { slot: "BOTTOM_BRACKET", value: "Cartridge", standard: "BSA" },
    ],
  },
];

async function main() {
  if (!isCatalogConfigured()) {
    throw new Error("CATALOG_DATABASE_URL or DATABASE_URL must be set to seed the catalog");
  }

  let bikes = 0;
  let components = 0;
  for (const bike of seedBikes) {
    const result = await upsertCatalogBike(bike);
    bikes += 1;
    components += result.componentsUpserted;
    console.log(`Upserted ${result.brand.name} ${bike.year ?? ""} ${bike.model}`);
  }

  console.log(`Seed complete: ${bikes} bikes, ${components} components`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await catalogPrisma.$disconnect();
  });
