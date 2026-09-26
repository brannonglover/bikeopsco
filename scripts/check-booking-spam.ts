/**
 * Exercise the booking spam scorer against the real September 2026 spam
 * bookings and a set of legitimate bookings, including the awkward ones —
 * unusual names, obscure brands, terse notes, international phone numbers.
 *
 * Run with: npm run check:booking-spam
 *
 * The legitimate cases are the ones that matter. A miss on spam costs a click
 * in the review queue; a false positive holds a paying customer's booking.
 */
import {
  assessBookingForSpam,
  QUARANTINE_THRESHOLD,
  type BookingSpamInput,
} from "../src/lib/booking-spam";

type Case = { name: string; booking: BookingSpamInput };

/** Transcribed from the four spam bookings that reached the production board. */
const SPAM: Case[] = [
  {
    name: "spam #1",
    booking: {
      firstName: "Vwxogt",
      lastName: "Ujfrgepu",
      email: "vwxogt@mailinator.com",
      phone: "5551234567",
      bikes: [{ make: "bUlyDdUbbPCAhKLVtMZotMPP", model: "OxtrCTbqkVWaAjWobiLn" }],
    },
  },
  {
    name: "spam #2",
    booking: {
      firstName: "Vxwdrn",
      lastName: "Gzngg",
      email: "kjhgfd8827@tempmail.com",
      phone: "0000000000",
      bikes: [{ make: "CiSLyJjOKZgKJKZIH", model: "FLfeVMfLAuspnTWy" }],
    },
  },
  {
    name: "spam #3",
    booking: {
      firstName: "Zixubany",
      lastName: "Safydgakd",
      email: "zixubany@gmail.com",
      phone: "5550000000",
      bikes: [{ make: "ykNtrpIgCSVeZAxye", model: "lPryXZnyfQZwUjfhOSTAe" }],
    },
  },
  {
    name: "spam #4 (link payload variant)",
    booking: {
      firstName: "Qwertyuio",
      lastName: "Asdfghjkl",
      email: "seo.outreach@guerrillamail.com",
      phone: "1",
      customerNotes:
        "Boost your shop ranking! Visit https://cheap-seo-backlinks.top and www.rank-fast.xyz now",
      bikes: [{ make: "Trek", model: "Domane" }],
    },
  },
];

const LEGITIMATE: Case[] = [
  {
    name: "ordinary local customer",
    booking: {
      firstName: "Brannon",
      lastName: "Glover",
      email: "brannonglover@gmail.com",
      phone: "(704) 555-0147",
      address: "812 Hawthorne Ln, Charlotte, NC",
      customerNotes: "Rear derailleur skips under load. Tune up please.",
      bikes: [{ make: "Trek", model: "Domane AL 3" }],
    },
  },
  {
    name: "Polish name, consonant heavy",
    booking: {
      firstName: "Krzysztof",
      lastName: "Wojciechowski",
      email: "k.wojciechowski@outlook.com",
      phone: "704-555-0192",
      bikes: [{ make: "Specialized", model: "Rockhopper" }],
    },
  },
  {
    name: "Irish name with apostrophe",
    booking: {
      firstName: "Siobhán",
      lastName: "O'Connor",
      email: "siobhan.oconnor@protonmail.com",
      phone: "+353 85 123 4567",
      bikes: [{ make: "Cannondale", model: "Synapse" }],
    },
  },
  {
    name: "Vietnamese name, short words",
    booking: {
      firstName: "Nguyen",
      lastName: "Tran",
      email: "nguyen.tran@yahoo.com",
      phone: "9805550133",
      bikes: [{ make: "Giant", model: "Escape 3" }],
    },
  },
  {
    name: "Greek surname, obscure boutique brand",
    booking: {
      firstName: "Dimitrios",
      lastName: "Papadopoulos",
      email: "dpapadopoulos@gmail.com",
      phone: "704 555 0111",
      customerNotes: "Creaking bottom bracket",
      bikes: [{ make: "Chumba", model: "Stella Ti" }],
    },
  },
  {
    name: "Turkish name, e-bike",
    booking: {
      firstName: "Özgür",
      lastName: "Yılmaz",
      email: "ozgur.yilmaz@gmail.com",
      phone: "980-555-0188",
      bikes: [{ make: "Haibike", model: "Trekking 5" }],
    },
  },
  {
    name: "Nigerian name, no model given",
    booking: {
      firstName: "Oluwaseun",
      lastName: "Adeyemi",
      email: "oluwaseun.adeyemi@gmail.com",
      phone: "7045550166",
      bikes: [{ make: "Schwinn", model: null }],
    },
  },
  {
    name: "Chinese name in Latin script, two bikes",
    booking: {
      firstName: "Xiaoming",
      lastName: "Zhang",
      email: "xzhang2291@gmail.com",
      phone: "704-555-0120",
      bikes: [
        { make: "Bianchi", model: "Sprint" },
        { make: "Brompton", model: "C Line" },
      ],
    },
  },
  {
    name: "name in non-Latin script",
    booking: {
      firstName: "محمد",
      lastName: "الحسيني",
      email: "m.alhusseini@gmail.com",
      phone: "704-555-0177",
      bikes: [{ make: "Canyon", model: "Endurace" }],
    },
  },
  {
    name: "typo'd brand and terse notes",
    booking: {
      firstName: "Dave",
      lastName: "Kim",
      email: "dkim@gmail.com",
      phone: "7045550199",
      customerNotes: "flat",
      bikes: [{ make: "Speciailzed", model: "Allez" }],
    },
  },
  {
    name: "shop referral mentioning a website",
    booking: {
      firstName: "Maria",
      lastName: "Gonzalez",
      email: "maria.gonzalez@gmail.com",
      phone: "980-555-0144",
      customerNotes: "Found you via bikeops.co — need a brake bleed before Saturday",
      bikes: [{ make: "Cervelo", model: "Caledonia" }],
    },
  },
  {
    name: "vintage bike, unusual make",
    booking: {
      firstName: "Hal",
      lastName: "Wu",
      email: "hal.wu@icloud.com",
      phone: "704-555-0155",
      customerNotes: "1978 frame, needs full overhaul",
      bikes: [{ make: "Motobecane", model: "Grand Record" }],
    },
  },
];

function run() {
  let failures = 0;

  const show = (cases: Case[], expectQuarantine: boolean) => {
    for (const { name, booking } of cases) {
      const result = assessBookingForSpam(booking);
      const ok = result.quarantine === expectQuarantine;
      if (!ok) failures++;

      const verdict = result.quarantine ? "QUARANTINE" : "allow";
      const mark = ok ? "  " : "!!";
      console.log(
        `${mark} ${verdict.padEnd(10)} score ${String(result.score).padStart(3)}  ${name}`
      );
      if (result.signals.length > 0) {
        console.log(
          `        ${result.signals.map((s) => `${s.code}(+${s.weight})`).join(" ")}`
        );
      }
    }
  };

  console.log(`\nThreshold: ${QUARANTINE_THRESHOLD}\n`);
  console.log("Known spam — expected to be quarantined:");
  show(SPAM, true);
  console.log("\nLegitimate bookings — must all be allowed:");
  show(LEGITIMATE, false);

  console.log(
    `\n${failures === 0 ? "PASS" : `FAIL (${failures} case${failures === 1 ? "" : "s"})`}`
  );
  process.exit(failures === 0 ? 0 : 1);
}

run();
