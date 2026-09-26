#!/usr/bin/env node
/**
 * Regenerate `src/lib/gibberish-model.ts`.
 *
 * The public booking form was hit by an automated filler that submits random
 * letter strings in every field ("Vwxogt Ujfrgepu" booking a
 * "bUlyDdUbbPCAhKLVtMZotMPP"). Rules like "four consonants in a row" catch
 * those but also catch Krzysztof and Schwinn, so detection instead scores each
 * word against a character bigram model trained on real English words, real
 * given names and surnames, and real bike brands. Random strings score far
 * below anything a person would actually type.
 *
 * The model is committed as data so the app has no build-time dependency on a
 * word list that only exists on macOS. Rerun this when the training corpus
 * changes:
 *
 *   node scripts/build-gibberish-model.js
 *
 * It prints a calibration report — the score distribution for real names and
 * brands against known spam samples — so the threshold in `booking-spam.ts`
 * can be checked against the separation it actually gets.
 */
const fs = require("fs");
const path = require("path");

const WORD_LISTS = ["/usr/share/dict/web2", "/usr/share/dict/propernames"];

/**
 * Corpora the system word list does not cover. Bike brands matter because a
 * make is one of the fields being scored; the names matter because a booking
 * must never look suspicious merely for belonging to someone whose name is not
 * Anglo-American. Consonant-heavy Slavic, Vietnamese and Irish names are
 * deliberately over-represented here — they are the false positives a naive
 * detector produces.
 */
const BIKE_BRANDS = `
trek specialized giant cannondale schwinn santacruz yeti cervelo bianchi pinarello
colnago scott merida canyon orbea bmc felt kona norco devinci rockymountain salsa
surly allcity cinelli fuji gt haro mongoose raleigh diamondback marin ibis pivot
intense transition evil guerrilla knolly commencal nukeproof vitus whyte ragley
cube ghost focus haibike rose radon propain lapierre look time ridley ribble
boardman genesis brompton dahon tern bromptonelectric moulton pashley bobbin
electra linus priority statebicycle sixthreezero aventon rad radpower lectric
specialized turbo vado como tero levo kenevo stumpjumper epic roubaix tarmac
allez diverge rockhopper chisel fuse status demo enduro camber crosstrail sirrus
domane emonda madone checkpoint fx dualsport verve marlin roscoe procaliber
supercaliber slash fuel remedy rail powerfly allant district farley
synapse topstone caad supersix scalpel trail habit moterra tesoro quick treadwell
defy tcr propel revolt fastroad escape talon fathom trance reign anthem
liv avail langma embolden intrigue pique
ebike emtb gravel hardtail
`;

const EXTRA_NAMES = `
siobhan niamh saoirse aoife caoimhe roisin eoin cillian oisin padraig
mcdonald mcdonough macleod obrien oconnor osullivan oneill
krzysztof wojciech szymon grzegorz przemyslaw zbigniew stanislaw wladyslaw
kowalski nowak wisniewski wojcik kowalczyk kaminski lewandowski zielinski
szymanski dabrowski kozlowski jankowski mazur wojciechowski kwiatkowski
jaroslav vaclav dvorak novak svoboda cermak prochazka kucera vesely horak
horvath szabo toth nagy kovacs varga kiss molnar farkas balogh
nguyen tran pham hoang phan vuong dang bui doan ngo duong ly truong
zhang wang chen liu yang huang zhao zhou xu sun zhu guo lin gao luo zheng
liang xie song tang deng feng cao peng zeng xiao tian dong yuan pan cai
nakamura yamamoto tanaka watanabe kobayashi suzuki takahashi sato ito saito
jeong hyun seung woo jae min ji eun hye
rajesh priya anjali venkatesh krishnan subramanian chandrasekhar ramachandran
mukherjee chatterjee bhattacharya gopalakrishnan balasubramanian
ahmed mohammed fatima aisha youssef khaled hussein ibrahim abdullah rahman
hassan mahmoud mustafa zainab khadija omar bilal yusuf
ivanov petrov smirnov volkov dmitri sergei yevgeny mikhail aleksandr
papadopoulos nikolaidis georgiou dimitriou konstantinidis
yilmaz demir kaya ozturk cetin arslan dogan sahin celik
kwame chidi ngozi adaeze oluwaseun ayodele abebe tesfaye mwangi otieno
kiptoo adeyemi okonkwo chukwu nwosu okafor
bjork bjorn sven lars nils mikkel soren jorgensen andersen nielsen hansen
larsson johansson karlsson eriksson olsson persson
silva santos oliveira pereira rodrigues fernandes goncalves almeida
martinez gonzalez hernandez ramirez gutierrez dominguez vasquez jimenez
schmidt schneider fischer weber meyer wagner becker hoffmann schulz
`;

/** Boundary symbol plus a-z; index 0 is the start/end marker. */
const ALPHABET_SIZE = 27;

function symbolIndex(ch) {
  if (ch === undefined) return 0;
  const code = ch.charCodeAt(0);
  if (code < 97 || code > 122) return -1;
  return code - 96;
}

/** Strip accents and punctuation so "Siobhán" and "O'Brien" train as letters. */
function normalizeWord(raw) {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function collectWords() {
  const words = new Set();

  for (const file of WORD_LISTS) {
    if (!fs.existsSync(file)) {
      console.warn(`! missing corpus ${file} — model will be weaker`);
      continue;
    }
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const word = normalizeWord(line.trim());
      if (word.length >= 2) words.add(word);
    }
  }

  // Weighted in by repetition: the curated lists are tiny next to 235k
  // dictionary words, and without extra weight a lone "krzysztof" does not
  // move the bigram probabilities enough to protect names shaped like it.
  const curated = `${BIKE_BRANDS} ${EXTRA_NAMES}`
    .split(/\s+/)
    .map(normalizeWord)
    .filter((w) => w.length >= 2);

  return { words: [...words], curated };
}

function train() {
  const { words, curated } = collectWords();
  const counts = new Float64Array(ALPHABET_SIZE * ALPHABET_SIZE).fill(1); // Laplace
  const CURATED_WEIGHT = 1500;

  const countWord = (word, weight) => {
    let prev = 0; // start boundary
    for (const ch of word) {
      const idx = symbolIndex(ch);
      if (idx < 0) continue;
      counts[prev * ALPHABET_SIZE + idx] += weight;
      prev = idx;
    }
    counts[prev * ALPHABET_SIZE] += weight; // end boundary
  };

  for (const word of words) countWord(word, 1);
  for (const word of curated) countWord(word, CURATED_WEIGHT);

  // Row-normalize into log probabilities.
  const logProbs = new Float64Array(ALPHABET_SIZE * ALPHABET_SIZE);
  for (let row = 0; row < ALPHABET_SIZE; row++) {
    let total = 0;
    for (let col = 0; col < ALPHABET_SIZE; col++) {
      total += counts[row * ALPHABET_SIZE + col];
    }
    for (let col = 0; col < ALPHABET_SIZE; col++) {
      logProbs[row * ALPHABET_SIZE + col] = Math.log(
        counts[row * ALPHABET_SIZE + col] / total
      );
    }
  }

  return { logProbs, wordCount: words.length, curatedCount: curated.length };
}

/**
 * Quantize to one byte per cell. Log probabilities run from about -14 (a pair
 * that never occurs) to 0; a 1/18th-of-a-nat step keeps far more resolution
 * than the threshold needs while fitting the table in 729 bytes.
 */
const QUANT_SCALE = 18;
const QUANT_FLOOR = -14;

function quantize(logProbs) {
  const bytes = Buffer.alloc(logProbs.length);
  for (let i = 0; i < logProbs.length; i++) {
    const clamped = Math.max(QUANT_FLOOR, Math.min(0, logProbs[i]));
    bytes[i] = Math.round((clamped - QUANT_FLOOR) * QUANT_SCALE);
  }
  return bytes;
}

function dequantize(bytes) {
  const out = new Float64Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = bytes[i] / QUANT_SCALE + QUANT_FLOOR;
  }
  return out;
}

/** Mean bigram log probability of a word, matching the runtime scorer. */
function scoreWord(table, raw) {
  const word = normalizeWord(raw);
  if (word.length < 4) return 0;
  let total = 0;
  let transitions = 0;
  let prev = 0;
  for (const ch of word) {
    const idx = symbolIndex(ch);
    if (idx < 0) continue;
    total += table[prev * ALPHABET_SIZE + idx];
    transitions++;
    prev = idx;
  }
  total += table[prev * ALPHABET_SIZE];
  transitions++;
  return total / transitions;
}

const REAL_SAMPLES = [
  "Brannon", "Glover", "Siobhan", "OConnor", "Krzysztof", "Wojciechowski",
  "Nguyen", "Zhang", "Schwinn", "Specialized", "Cannondale", "Trek", "Domane",
  "Rockhopper", "Stumpjumper", "Bianchi", "Cervelo", "Papadopoulos", "Yilmaz",
  "Oluwaseun", "Bjornsson", "Chatterjee", "Mikkelsen", "Dvorak", "Horvath",
  "Ramirez", "Hoffmann", "Takahashi", "Marlin", "Checkpoint", "Roubaix",
];

// Straight from the four spam bookings on the production board.
const SPAM_SAMPLES = [
  "Vwxogt", "Ujfrgepu", "bUlyDdUbbPCAhKLVtMZotMPP", "OxtrCTbqkVWaAjWobiLn",
  "Vxwdrn", "Gzngg", "CiSLyJjOKZggJKZIH", "FLfeVMfLAuspnTWy",
  "Zixubany", "Safydgakd", "ykNtrpIgCSVeZAxye", "lPryXZnyfQZwUjfhOSTAe",
];

/**
 * Must mirror `isGibberish` in `src/lib/booking-spam.ts`.
 *
 * A single short word cannot be classified reliably — "Yilmaz" and "Zixubany"
 * score the same to a bigram model — so short words are left unjudged and
 * longer ones are held to a threshold that tightens with length. Missing a
 * spam word here is cheap; the booking still has to clear every other field.
 */
function verdict(score, raw) {
  const length = normalizeWord(raw).length;
  if (length < 6) return "unscored";
  const threshold = length >= 10 ? -3.4 : -3.8;
  return score < threshold ? "GIBBERISH" : "ok";
}

function report(table) {
  const scoreAll = (samples) =>
    samples
      .map((sample) => ({
        sample,
        score: scoreWord(table, sample),
        length: normalizeWord(sample).length,
        verdict: verdict(scoreWord(table, sample), sample),
      }))
      .sort((a, b) => a.score - b.score);

  const real = scoreAll(REAL_SAMPLES);
  const spam = scoreAll(SPAM_SAMPLES);

  const falsePositives = real.filter((r) => r.verdict === "GIBBERISH");
  const caught = spam.filter((s) => s.verdict === "GIBBERISH");

  console.log("\nCalibration (mean bigram log-probability; higher is more word-like)");
  console.log(`  real words flagged (must be 0): ${falsePositives.length}/${real.length}`);
  for (const { sample, score, length } of falsePositives) {
    console.log(`    !! ${score.toFixed(3)}  len ${length}  ${sample}`);
  }
  console.log(`  spam words caught:              ${caught.length}/${spam.length}`);

  const line = ({ sample, score, length, verdict: v }) =>
    `    ${score.toFixed(3)}  len ${String(length).padStart(2)}  ${v.padEnd(9)}  ${sample}`;

  console.log("\n  real samples closest to being flagged:");
  for (const row of real.slice(0, 6)) console.log(line(row));
  console.log("  spam samples closest to slipping through:");
  for (const row of spam.slice(-6)) console.log(line(row));
}

function main() {
  const { logProbs, wordCount, curatedCount } = train();
  const bytes = quantize(logProbs);
  const table = dequantize(bytes);

  report(table);

  const outPath = path.join(__dirname, "..", "src", "lib", "gibberish-model.ts");
  const source = `/**
 * Character bigram model used to tell typed-by-a-person text from the random
 * letter strings an automated form filler submits. Generated data — do not
 * hand-edit. Regenerate with \`node scripts/build-gibberish-model.js\`, which
 * also prints the score separation the threshold relies on.
 *
 * Trained on ${wordCount.toLocaleString()} dictionary words and proper names plus ${curatedCount.toLocaleString()} weighted
 * entries covering bike brands and names the system word list misses.
 */

/** Boundary symbol plus a-z; index 0 marks the start and end of a word. */
export const ALPHABET_SIZE = ${ALPHABET_SIZE};

const QUANT_SCALE = ${QUANT_SCALE};
const QUANT_FLOOR = ${QUANT_FLOOR};

const PACKED_TABLE =
  "${bytes.toString("base64")}";

/** Row-major [prev][next] table of bigram log probabilities. */
export const BIGRAM_LOG_PROBS: Float64Array = (() => {
  const raw =
    typeof atob === "function"
      ? Uint8Array.from(atob(PACKED_TABLE), (c) => c.charCodeAt(0))
      : new Uint8Array(Buffer.from(PACKED_TABLE, "base64"));
  const out = new Float64Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    out[i] = raw[i] / QUANT_SCALE + QUANT_FLOOR;
  }
  return out;
})();
`;

  fs.writeFileSync(outPath, source);
  console.log(`\nWrote ${outPath} (${bytes.length} byte table)`);
}

main();
