// SEMAPHORE headless tests. Run: node test.mjs — exit 0 = green.
import * as F from './flags.mjs';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error('FAIL:', name); }
}
function approx(a, b, tol) { return Math.abs(a - b) <= tol; }

// 1. Alphabet is complete: exactly 26 letters, A-Z.
check('alphabet has 26 letters', F.LETTERS.length === 26);
check('alphabet covers A-Z', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').every((l) => F.ALPHABET[l]));

// 2. Alphabet is bijective: no two letters share a position pair.
{
  const seen = new Set();
  let allUnique = true;
  for (const l of F.LETTERS) {
    const p = F.ALPHABET[l];
    const key = `${p.left},${p.right}`;
    if (seen.has(key)) allUnique = false;
    seen.add(key);
  }
  check('alphabet positions are all unique (bijective)', allUnique && seen.size === 26);
}

// 3. Reverse lookup round-trips every letter's exact positions.
{
  let ok = true;
  for (const l of F.LETTERS) {
    const p = F.ALPHABET[l];
    if (F.letterFromPositions(p.left, p.right) !== l) ok = false;
  }
  check('letterFromPositions round-trips every letter', ok);
}

// 4. Reverse lookup rejects a position pair that is not a real letter.
check('letterFromPositions rejects unused pair', F.letterFromPositions(0, 0) === null);

// 5. mulberry32 is deterministic: same seed -> same sequence.
{
  const a = F.mulberry32('seed-x');
  const b = F.mulberry32('seed-x');
  const seqA = [a(), a(), a()];
  const seqB = [b(), b(), b()];
  check('mulberry32 deterministic per seed', seqA.every((v, i) => v === seqB[i]));
}
check('mulberry32 differs across seeds', F.mulberry32('a')() !== F.mulberry32('b')());

// 6. Noise model calibrated: error rate is monotonic non-decreasing in fog,
// and empirical rate matches the formula within tolerance across seeds.
{
  let monotonic = true;
  let prevRate = -1;
  for (const fog of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
    const rate = F.errorRateForFog(fog);
    if (rate < prevRate) monotonic = false;
    prevRate = rate;
  }
  check('errorRateForFog monotonic non-decreasing', monotonic);

  let calibrated = true;
  for (const fog of [0, 0.25, 0.5, 0.75, 1]) {
    const rand = F.mulberry32(`calib-${fog}`);
    const trials = 4000;
    let errs = 0;
    for (let i = 0; i < trials; i++) {
      const out = F.relayMessage('A', fog, rand, { allowLengthMutation: false });
      if (out !== 'A') errs++;
    }
    const empirical = errs / trials;
    const expected = F.errorRateForFog(fog);
    if (!approx(empirical, expected, 0.03)) calibrated = false;
  }
  check('empirical error rate matches errorRateForFog within tolerance (100+ trials/fog)', calibrated);
}

// 7. Error rate bounds: never negative, never exceeds FOG_MAX.
{
  let bounded = true;
  for (let f = -0.5; f <= 1.5; f += 0.1) {
    const r = F.errorRateForFog(f);
    if (r < 0 || r > F.FOG_MAX) bounded = false;
  }
  check('errorRateForFog bounded in [0, FOG_MAX] even for out-of-range fog', bounded);
}

// 8. Mutation engine is deterministic per seed.
{
  const r1 = F.mulberry32('mutate-seed');
  const r2 = F.mulberry32('mutate-seed');
  const out1 = F.relayMessage('SUPPLIES SAFE', 0.6, r1);
  const out2 = F.relayMessage('SUPPLIES SAFE', 0.6, r2);
  check('relayMessage deterministic per seed', out1 === out2);
}

// 9. Mutation engine preserves length within a bounded delta, over many seeds/fogs.
{
  let ok = true;
  for (let i = 0; i < 200; i++) {
    const msg = 'SEND MORE POWDER';
    const rand = F.mulberry32(`len-${i}`);
    const out = F.relayMessage(msg, 0.9, rand);
    const maxDelta = Math.max(2, Math.ceil(msg.length * 0.3));
    if (Math.abs(out.length - msg.length) > maxDelta) ok = false;
  }
  check('relayMessage keeps length within bounded delta over 200 seeds', ok);
}

// 10. Mutation engine only ever produces real letters or spaces (pronounceable garbles).
{
  let ok = true;
  for (let i = 0; i < 100; i++) {
    const rand = F.mulberry32(`chars-${i}`);
    const out = F.relayMessage('HOLD THE LINE', 0.95, rand);
    for (const ch of out) {
      if (ch !== ' ' && !F.ALPHABET[ch]) ok = false;
    }
  }
  check('mutated output is always real letters or spaces', ok);
}

// 11. Downstream chain fidelity is (approximately) multiplicative across stations.
{
  const message = 'HOLDTHELINE'; // no spaces: every position is a letter, so per-position accuracy is clean
  const perStationFog = 0.3;
  const perStationAccuracy = 1 - F.errorRateForFog(perStationFog);
  const trials = 400;

  function meanFidelity(stationCount) {
    let sum = 0;
    for (let i = 0; i < trials; i++) {
      const stations = Array.from({ length: stationCount }, () => ({ fog: perStationFog, allowLengthMutation: false }));
      const r = F.simulateChain(message, stations, `mult-${stationCount}-${i}`);
      sum += r.fidelity;
    }
    return sum / trials;
  }

  const f1 = meanFidelity(1);
  const f2 = meanFidelity(2);
  const f3 = meanFidelity(3);
  const expected1 = perStationAccuracy;
  const expected2 = perStationAccuracy ** 2;
  const expected3 = perStationAccuracy ** 3;
  check(
    'chain fidelity approximates product of per-station accuracies (1,2,3 stations)',
    approx(f1, expected1, 0.06) && approx(f2, expected2, 0.06) && approx(f3, expected3, 0.06)
  );
  check('adding stations strictly reduces expected fidelity (multiplicative decay)', f1 > f2 && f2 > f3);
}

// 12. simulateChain is deterministic per seed.
{
  const stations = [{ fog: 0.3 }, { fog: 0.4 }];
  const r1 = F.simulateChain('COAST IS CLEAR', stations, 'chain-seed');
  const r2 = F.simulateChain('COAST IS CLEAR', stations, 'chain-seed');
  check('simulateChain deterministic per seed', r1.received === r2.received && r1.fidelity === r2.fidelity);
}

// 13. Fidelity scorer: every verdict path.
check('fidelity of identical strings is 1', F.fidelity('HOLD THE LINE', 'HOLD THE LINE') === 1);
check('fidelity of totally different strings is low', F.fidelity('AAAA', 'ZZZZ') === 0);
check('fidelity is between 0 and 1 for partial match', (() => {
  const f = F.fidelity('SUPPLIES SAFE', 'SUPPLIES SALE');
  return f > 0 && f < 1;
})());
check('levenshtein of empty strings handled', F.levenshtein('', '') === 0 && F.levenshtein('ABC', '') === 3);

// 14. Dispatch selector is keyed to the actual received text, not just fidelity score.
{
  const sameScore = 0.6;
  const d1 = F.dispatchFor('SUPPLIES SAFE', 'SUPPLIES SALE', sameScore);
  const d2 = F.dispatchFor('SUPPLIES SAFE', 'SUPPLIES SANE', sameScore);
  check('dispatchFor differs for different received text at the same fidelity score', d1 !== d2);
  const d1b = F.dispatchFor('SUPPLIES SAFE', 'SUPPLIES SALE', sameScore);
  check('dispatchFor deterministic for the same inputs', d1 === d1b);
  check('dispatchFor echoes the received text when no specific garble is known', F.dispatchFor('X Y', 'X Z', 0.5).includes('X Z'));
  check('dispatchFor clean-chain path fires on exact match', F.dispatchFor('RETREAT NOW', 'RETREAT NOW', 1).toLowerCase().includes('clean'));
}

// 15. Required tests from the concept block: crisis night is solvable at the
// required fidelity by clean play (a solver run), over many seeds.
{
  const trials = 400;
  let sum = 0, passCount = 0;
  for (let i = 0; i < trials; i++) {
    const r = F.solveDay(F.CRISIS_DAY, `crisis-${i}`);
    sum += r.fidelity;
    if (r.fidelity >= F.CRISIS_REQUIRED_FIDELITY) passCount++;
  }
  const meanFidelity = sum / trials;
  check('crisis night: clean-play mean fidelity clears the required threshold', meanFidelity >= F.CRISIS_REQUIRED_FIDELITY);
  check('crisis night: clean play meets the threshold on a strong majority of seeds', passCount / trials >= 0.6);
}

// 16. Day configuration: deterministic, escalates, and stays inside day-1..13
// difficulty always below the dedicated crisis-night configuration.
{
  let escalating = true;
  let lastFog = -1;
  for (let d = 1; d <= F.CRISIS_DAY - 1; d++) {
    const c = F.dayConfig(d, 'escalation-seed');
    if (c.fog < lastFog) escalating = false;
    lastFog = c.fog;
  }
  check('day fog escalates (non-decreasing) across days 1-13', escalating);
  check('day 13 fog stays below crisis base fog', F.dayConfig(13, 'x').fog < F.CRISIS_BASE_FOG);

  const c1 = F.dayConfig(9, 'stable-seed');
  const c2 = F.dayConfig(9, 'stable-seed');
  check('dayConfig deterministic per seed', c1.message === c2.message && c1.fog === c2.fog);
}

// 17. Bounds over >=100 seeds/days: every day 1-14 produces a valid, in-vocabulary
// message with only real letters/spaces, and every crisis day is CRISIS_MESSAGE.
{
  let ok = true;
  for (let seedIdx = 0; seedIdx < 120; seedIdx++) {
    for (let d = 1; d <= F.DAY_COUNT; d++) {
      const c = F.dayConfig(d, `bounds-${seedIdx}`);
      for (const ch of c.message) {
        if (ch !== ' ' && !F.ALPHABET[ch]) ok = false;
      }
      if (d === F.CRISIS_DAY && c.message !== F.CRISIS_MESSAGE) ok = false;
      if (c.stations.length < 1) ok = false;
    }
  }
  check('every day (1-14) over 120 seeds produces a valid in-alphabet message', ok);
}

// 18. Share text format and round-trip parse.
{
  const share = F.shareText(9, 'SUPPLIES SAFE', 'SUPPLIES SAFE');
  check('shareText matches the concept block format (clean chain)', share === '\u{1F6A9} SEMAPHORE day 9 · sent SUPPLIES SAFE · the coast heard SUPPLIES SAFE · a clean chain · http://semaphore.defimagic.io');
  const parsed = F.parseShareText(share);
  check('parseShareText round-trips day/sent/received', parsed && parsed.day === 9 && parsed.sent === 'SUPPLIES SAFE' && parsed.received === 'SUPPLIES SAFE');

  const garbled = F.shareText(3, 'HOLD THE LINE', 'HOLD THE LIME');
  const parsedGarbled = F.parseShareText(garbled);
  check('parseShareText round-trips a garbled share line without the clean-chain suffix', parsedGarbled && parsedGarbled.received === 'HOLD THE LIME' && !garbled.includes('clean chain'));
}

// 19. NEIGHBORS table: every letter has at least one confusable neighbor, and
// nearest-neighbor distance is never zero (a neighbor is never the letter itself).
{
  let ok = true;
  for (const l of F.LETTERS) {
    const list = F.NEIGHBORS[l];
    if (!list || list.length !== 25) ok = false;
    if (list[0].d <= 0) ok = false;
    if (list.some((x) => x.b === l)) ok = false;
  }
  check('NEIGHBORS table is well-formed for every letter', ok);
}

// 20. Fog level 0 still allows rare misreads (telescope, hands, fatigue are never perfect)
// but stays clearly below a mid-fog level, over many trials.
{
  const rand0 = F.mulberry32('fog0');
  const randMid = F.mulberry32('fogmid');
  let errs0 = 0, errsMid = 0;
  const trials = 3000;
  for (let i = 0; i < trials; i++) {
    if (F.relayMessage('M', 0, rand0, { allowLengthMutation: false }) !== 'M') errs0++;
    if (F.relayMessage('M', 0.6, randMid, { allowLengthMutation: false }) !== 'M') errsMid++;
  }
  check('fog 0 error rate is low but nonzero, and clearly below fog 0.6', errs0 / trials < 0.08 && errs0 / trials < errsMid / trials);
}

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail === 0 ? 0 : 1);
