// SEMAPHORE — pure core. No DOM, no WebAudio, no Date.now(), no Math.random() in logic paths.
// Seeds and time are always injected. mulberry32 PRNG pattern throughout.

// ---------- PRNG ----------

export function hashSeed(input) {
  if (typeof input === 'number') return input >>> 0;
  let h = 5381;
  const s = String(input);
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

export function mulberry32(seedInput) {
  let seed = hashSeed(seedInput) >>> 0;
  return function rand() {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- The real flag semaphore alphabet ----------
// Two arms, eight compass directions each (45-degree steps, 0 = straight up).
// Right arm's own-side positions: up=0 high=45 out=90 low=135 down=180.
// Left arm's own-side positions:  up=0 high=315 out=270 low=225 down=180.
// "Across" positions are the arm crossing to the opposite diagonal at low or
// high height. Source: cross-checked against the Australian National Botanic
// Gardens semaphore reference and the standard sweep-teaching grouping
// (A-D sweep the right arm against a fixed left; E-G sweep the left against a
// fixed right, and so on) that the historical alphabet is taught in.
const R = { up: 0, high: 45, out: 90, low: 135, down: 180, acrossLow: 225, acrossHigh: 315 };
const L = { up: 0, high: 315, out: 270, low: 225, down: 180, acrossLow: 135, acrossHigh: 45 };

export const ALPHABET = {
  A: { left: L.down, right: R.low },
  B: { left: L.down, right: R.out },
  C: { left: L.down, right: R.high },
  D: { left: L.down, right: R.up },
  E: { left: L.high, right: R.down },
  F: { left: L.out, right: R.down },
  G: { left: L.low, right: R.down },
  H: { left: L.acrossLow, right: R.out },
  I: { left: L.acrossLow, right: R.up },
  J: { left: L.out, right: R.up },
  K: { left: L.up, right: R.low },
  L: { left: L.high, right: R.low },
  M: { left: L.out, right: R.low },
  N: { left: L.low, right: R.low },
  O: { left: L.acrossHigh, right: R.out },
  P: { left: L.up, right: R.out },
  Q: { left: L.high, right: R.out },
  R: { left: L.out, right: R.out },
  S: { left: L.low, right: R.out },
  T: { left: L.up, right: R.high },
  U: { left: L.high, right: R.high },
  V: { left: L.low, right: R.up },
  W: { left: L.out, right: R.acrossHigh },
  X: { left: L.low, right: R.acrossHigh },
  Y: { left: L.out, right: R.high },
  Z: { left: L.out, right: R.acrossLow },
};

export const LETTERS = Object.keys(ALPHABET);

function circDist(a, b) {
  const diff = Math.abs(a - b) % 360;
  return Math.round(Math.min(diff, 360 - diff) / 45);
}

export function pairDistance(letterA, letterB) {
  const a = ALPHABET[letterA], b = ALPHABET[letterB];
  return circDist(a.left, b.left) + circDist(a.right, b.right);
}

// Exact reverse lookup: positions -> letter, or null if not a real letter.
export function letterFromPositions(left, right) {
  for (const ltr of LETTERS) {
    const p = ALPHABET[ltr];
    if (p.left === left && p.right === right) return ltr;
  }
  return null;
}

// Nearest-letter table, precomputed once: for each letter, the other letters
// sorted by geometric closeness (angle-distance), nearest first. Used so a
// misread position always resolves to a real, pronounceable, plausible letter.
export const NEIGHBORS = (() => {
  const table = {};
  for (const a of LETTERS) {
    const dists = LETTERS.filter((b) => b !== a).map((b) => ({ b, d: pairDistance(a, b) }));
    dists.sort((x, y) => x.d - y.d);
    table[a] = dists;
  }
  return table;
})();

function nearestConfusable(letter, rand) {
  const list = NEIGHBORS[letter];
  const minD = list[0].d;
  const tier = list.filter((x) => x.d === minD);
  const pick = tier[Math.floor(rand() * tier.length) % tier.length];
  return pick.b;
}

// ---------- Fog / noise model ----------
// fog in [0,1]. Probability a given letter is misread by the station reading it.
export const FOG_BASE = 0.03;
export const FOG_SCALE = 0.55;
export const FOG_MAX = 0.8;

export function errorRateForFog(fog) {
  const clampedFog = Math.max(0, Math.min(1, fog));
  return Math.max(0, Math.min(FOG_MAX, FOG_BASE + FOG_SCALE * clampedFog));
}

const DROP_SHARE = 0.10;
const DUP_SHARE = 0.05;

// Relays one message through one station under one fog level. Deterministic
// given rand. Length can drift by drops/duplicates but never past maxDelta.
export function relayMessage(message, fog, rand, opts = {}) {
  const allowLengthMutation = opts.allowLengthMutation !== false;
  const p = errorRateForFog(fog);
  const chars = message.split('');
  const maxDelta = Math.max(2, Math.ceil(chars.length * 0.3));
  let delta = 0;
  const out = [];
  for (const ch of chars) {
    if (ch === ' ') { out.push(' '); continue; }
    if (!ALPHABET[ch]) { out.push(ch); continue; }
    const roll = rand();
    if (roll < p) {
      const kindRoll = rand();
      if (allowLengthMutation && kindRoll < DROP_SHARE && delta > -maxDelta) {
        delta -= 1;
        continue; // letter lost in the fog
      }
      if (allowLengthMutation && kindRoll < DROP_SHARE + DUP_SHARE && delta < maxDelta) {
        delta += 1;
        out.push(ch, ch); // arm hesitates, station reads it twice
        continue;
      }
      out.push(nearestConfusable(ch, rand));
    } else {
      out.push(ch);
    }
  }
  return out.join('');
}

// ---------- Chain simulation ----------
// stations: array of { fog, allowLengthMutation? }, in relay order.
export function simulateChain(sentMessage, stations, seed) {
  const rand = mulberry32(seed);
  let current = sentMessage;
  const intermediates = [current];
  for (const station of stations) {
    current = relayMessage(current, station.fog, rand, station);
    intermediates.push(current);
  }
  return {
    sent: sentMessage,
    received: current,
    intermediates,
    fidelity: fidelity(sentMessage, current),
  };
}

// ---------- Fidelity ----------
export function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const row = new Array(n + 1);
  for (let j = 0; j <= n; j++) row[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      row[j] = a[i - 1] === b[j - 1]
        ? prev
        : 1 + Math.min(prev, row[j], row[j - 1]);
      prev = tmp;
    }
  }
  return row[n];
}

export function fidelity(sent, received) {
  const maxLen = Math.max(sent.length, received.length, 1);
  return Math.max(0, 1 - levenshtein(sent, received) / maxLen);
}

// ---------- Dispatch text, keyed to the actual received string ----------
const KNOWN_GARBLES = {
  'SUPPLIES SAFE|SUPPLIES SALE': 'The quartermaster wants to know who is buying and at what price. Nobody is amused but you.',
  'SUPPLIES SAFE|SUPPLIES SANE': "The coast reports the supplies are of sound mind. So is the clerk who logged it, apparently.",
  'HOLD THE LINE|HOLD THE LIME': 'A crate of citrus arrives at the front by express order. The surgeon is delighted; the captain is not.',
  'RETREAT NOW|RETREAT NOW': 'Received clean. Boots are already moving.',
};

export function dispatchFor(sent, received, fidelityScore) {
  const key = `${sent}|${received}`;
  if (KNOWN_GARBLES[key]) return KNOWN_GARBLES[key];
  if (received === sent) {
    return `The coast heard "${received}" — word for word. A clean chain end to end.`;
  }
  if (fidelityScore >= 0.75) {
    return `The coast heard "${received}". Not quite what you sent, but close enough to act on.`;
  }
  if (fidelityScore >= 0.45) {
    return `The coast heard "${received}". That is not what you meant to say — someone downstream will be confused before they are corrected.`;
  }
  return `The coast heard "${received}". The message that left your arms and the one that landed are barely kin. Send it again.`;
}

// ---------- Campaign: 14 days of escalating weather + one crisis night ----------
const VOCAB = [
  'SUPPLIES SAFE', 'HOLD THE LINE', 'SHIPS SIGHTED', 'POWDER LOW',
  'RETREAT NOW', 'WOUNDED ABOARD', 'COAST IS CLEAR', 'ADVANCE AT DAWN',
  'ENEMY IN THE BAY', 'SEND MORE POWDER',
];

export const DAY_COUNT = 14;
export const CRISIS_DAY = 14;
export const CRISIS_MESSAGE = 'HOLD THE LINE';
export const CRISIS_REQUIRED_FIDELITY = 0.5;
export const CRISIS_BASE_FOG = 0.32;
export const CRISIS_STATION_COUNT = 3;
export const CRISIS_STATION_STEP = 0.03;

export function dayFog(day) {
  if (day >= CRISIS_DAY) return CRISIS_BASE_FOG;
  const t = (day - 1) / (CRISIS_DAY - 2); // days 1..13 span the ramp, staying below crisis fog
  return Math.max(0, Math.min(1, 0.05 + t * 0.26));
}

export function dayStationCount(day) {
  if (day >= CRISIS_DAY) return CRISIS_STATION_COUNT;
  return day <= 6 ? 2 : CRISIS_STATION_COUNT; // 2 for days 1-6, 3 for days 7-13
}

export function dayMessage(day, seed) {
  if (day >= CRISIS_DAY) return CRISIS_MESSAGE;
  const rand = mulberry32(`${hashSeed(seed)}-${day}`);
  return VOCAB[Math.floor(rand() * VOCAB.length) % VOCAB.length];
}

export function dayConfig(day, seed) {
  const fog = dayFog(day);
  const stationCount = dayStationCount(day);
  const step = day >= CRISIS_DAY ? CRISIS_STATION_STEP : 0.02;
  const stations = [];
  for (let i = 0; i < stationCount; i++) {
    // downstream stations drift slightly harder toward the coast
    stations.push({ fog: Math.min(FOG_MAX, fog + i * step) });
  }
  return {
    day,
    message: dayMessage(day, seed),
    fog,
    stations,
    requiredFidelity: day >= CRISIS_DAY ? CRISIS_REQUIRED_FIDELITY : 0,
  };
}

// "Clean play": the player transcribes and resends every letter perfectly.
// The message enters the downstream chain unmodified by the player; only the
// NPC stations beyond the player's post can still garble it. This is the
// difficulty floor the campaign is tuned against.
export function solveDay(day, seed) {
  const config = dayConfig(day, seed);
  return simulateChain(config.message, config.stations, seed);
}

export function shareText(day, sent, received) {
  const clean = sent === received;
  return `\u{1F6A9} SEMAPHORE day ${day} · sent ${sent} · the coast heard ${received}` +
    (clean ? ' · a clean chain' : '') + ' · http://semaphore.defimagic.io';
}

// Simple parser for a pasted share line, reconstructing structured data
// (day/sent/received) so a share string can be round-tripped and verified.
export function parseShareText(text) {
  const m = text.match(/day (\d+) . sent ([A-Z ]+) . the coast heard ([A-Z ]+)/u);
  if (!m) return null;
  return { day: Number(m[1]), sent: m[2].trim(), received: m[3].trim() };
}
