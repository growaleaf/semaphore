import * as F from './flags.mjs';

const SAVE_KEY = 'semaphore_v1';

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.day !== 'number' || !parsed.seed) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

function saveGame(save) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch (e) {
    /* storage unavailable — the tower keeps no logbook today */
  }
}

function freshRun() {
  return { day: 1, seed: `run-${Math.floor(Math.random() * 1e9)}`, completedDays: [] };
}

function degToRad(deg) {
  return (deg * Math.PI) / 180;
}

function armEndpoint(cx, cy, deg, len) {
  const rad = degToRad(deg);
  return { x: cx + Math.sin(rad) * len, y: cy - Math.cos(rad) * len };
}

// Draws the signalman: head, torso, two arms at the given degrees.
// fogAmount (0..1) adds a soft blur overlay and a small visual sway —
// cosmetic only, never fed back into scoring logic.
function drawStation(ctx, w, h, leftDeg, rightDeg, fogAmount, swayPhase) {
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.translate(w / 2, h * 0.62);

  // All measurements below are tuned for a 220px-tall reference canvas and
  // scaled down for smaller diagrams (the how-to screen's mini stations) so
  // arms never clip off a small canvas.
  const scale = Math.min(w, h) / 220;
  const sway = Math.sin(swayPhase) * fogAmount * 6 * scale;

  ctx.strokeStyle = '#e9e4d6';
  ctx.fillStyle = '#e9e4d6';
  ctx.lineWidth = Math.max(1.5, 5 * scale);
  ctx.lineCap = 'round';

  // torso
  ctx.beginPath();
  ctx.moveTo(0, -40 * scale);
  ctx.lineTo(0, 40 * scale);
  ctx.stroke();

  // head
  ctx.beginPath();
  ctx.arc(0, -54 * scale, 12 * scale, 0, Math.PI * 2);
  ctx.fill();

  // arms (from shoulder)
  const shoulderY = -32 * scale;
  const armLen = 58 * scale;
  const left = armEndpoint(0, shoulderY, leftDeg + sway, armLen);
  const right = armEndpoint(0, shoulderY, rightDeg - sway, armLen);

  ctx.strokeStyle = '#c9a961';
  ctx.beginPath();
  ctx.moveTo(0, shoulderY);
  ctx.lineTo(left.x, left.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, shoulderY);
  ctx.lineTo(right.x, right.y);
  ctx.stroke();

  // flags
  const flagHalf = 9 * scale;
  ctx.fillStyle = '#c0392b';
  ctx.fillRect(left.x - flagHalf, left.y - flagHalf, flagHalf * 2, flagHalf * 2);
  ctx.fillRect(right.x - flagHalf, right.y - flagHalf, flagHalf * 2, flagHalf * 2);

  ctx.restore();

  if (fogAmount > 0.02) {
    ctx.save();
    ctx.fillStyle = `rgba(180,190,200,${Math.min(0.55, fogAmount * 0.6)})`;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
}

function weatherLabel(fog) {
  if (fog < 0.12) return 'clear';
  if (fog < 0.25) return 'hazy';
  if (fog < 0.4) return 'fog rolling in';
  if (fog < 0.55) return 'thick fog';
  if (fog < 0.7) return 'failing light';
  return 'storm-blind';
}

function tokenizeMessage(message) {
  return message.split(''); // includes spaces as their own tokens
}

function perLetterMs(fog) {
  return Math.max(900, Math.round(4200 - fog * 3200));
}

export function initGame(root) {
  const titleScreen = root.querySelector('#screen-title');
  const howtoScreen = root.querySelector('#screen-howto');
  const playScreen = root.querySelector('#screen-play');
  const dispatchScreen = root.querySelector('#screen-dispatch');
  const campaignDoneScreen = root.querySelector('#screen-campaign-done');

  const startBtn = root.querySelector('#btn-start');
  const howtoPlayBtn = root.querySelector('#btn-howto-play');
  const hudDay = root.querySelector('#hud-day');
  const hudWeather = root.querySelector('#hud-weather');
  const hudPhase = root.querySelector('#hud-phase');
  const canvas = root.querySelector('#station');
  const ctx = canvas.getContext('2d');
  const timerBar = root.querySelector('#timer-bar');
  const transcriptStrip = root.querySelector('#transcript-strip');
  const letterGrid = root.querySelector('#letter-grid');
  const resendBody = root.querySelector('#resend-body');
  const resendMessage = root.querySelector('#resend-message');
  const sendBtn = root.querySelector('#btn-send');

  const dispatchTitle = root.querySelector('#dispatch-title');
  const dispatchBody = root.querySelector('#dispatch-body');
  const dispatchFidelity = root.querySelector('#dispatch-fidelity');
  const dispatchShare = root.querySelector('#dispatch-share');
  const copyBtn = root.querySelector('#btn-copy');
  const nextBtn = root.querySelector('#btn-next');

  const campaignSummary = root.querySelector('#campaign-summary');
  const restartBtn = root.querySelector('#btn-restart');

  let save = loadSave() || freshRun();
  saveGame(save);

  // Letter grid buttons, built once.
  for (const l of F.LETTERS) {
    const b = document.createElement('button');
    b.textContent = l;
    b.dataset.letter = l;
    b.addEventListener('click', () => onLetterTap(l));
    letterGrid.appendChild(b);
  }

  function showScreen(el) {
    for (const s of [titleScreen, howtoScreen, playScreen, dispatchScreen, campaignDoneScreen]) {
      s.classList.toggle('hidden', s !== el);
    }
  }

  function currentScreenName() {
    if (!titleScreen.classList.contains('hidden')) return 'title';
    if (!howtoScreen.classList.contains('hidden')) return 'howto';
    if (!playScreen.classList.contains('hidden')) return 'play';
    if (!dispatchScreen.classList.contains('hidden')) return 'dispatch';
    if (!campaignDoneScreen.classList.contains('hidden')) return 'campaign-done';
    return 'unknown';
  }

  // ---------- how-to diagrams ----------
  function buildHowtoDiagrams() {
    const wrap = root.querySelector('#howto-diagrams');
    wrap.innerHTML = '';
    const sample = ['A', 'H', 'R', 'Z'];
    for (const l of sample) {
      const holder = document.createElement('div');
      const c = document.createElement('canvas');
      c.width = 80; c.height = 90;
      holder.appendChild(c);
      const lbl = document.createElement('div');
      lbl.className = 'diagram-label';
      lbl.textContent = l;
      holder.appendChild(lbl);
      wrap.appendChild(holder);
      const cctx = c.getContext('2d');
      const p = F.ALPHABET[l];
      drawStation(cctx, 80, 90, p.left, p.right, 0, 0);
    }
  }

  // ---------- play state ----------
  let dayConfig = null;
  let tokens = [];
  let tokenIndex = 0;
  let transcript = [];
  let phase = 'idle'; // 'transcribe' | 'resend'
  let letterDeadline = 0;
  let rafId = null;
  let swayPhase = 0;

  function startDay() {
    dayConfig = F.dayConfig(save.day, save.seed);
    tokens = tokenizeMessage(dayConfig.message);
    tokenIndex = 0;
    transcript = [];
    phase = 'transcribe';
    hudDay.textContent = save.day >= F.CRISIS_DAY
      ? `Crisis night — day ${save.day} of ${F.DAY_COUNT}`
      : `Day ${save.day} of ${F.DAY_COUNT}`;
    hudWeather.textContent = weatherLabel(dayConfig.fog);
    hudPhase.textContent = 'Watching the incoming station.';
    resendBody.classList.add('hidden');
    letterGrid.classList.remove('hidden');
    canvas.parentElement.classList.remove('hidden');
    showScreen(playScreen);
    advanceTranscribe();
  }

  function advanceTranscribe() {
    if (tokenIndex >= tokens.length) {
      finishTranscribe();
      return;
    }
    const token = tokens[tokenIndex];
    if (token === ' ') {
      transcript.push(' ');
      tokenIndex++;
      transcriptStrip.textContent = transcript.join('');
      advanceTranscribe();
      return;
    }
    const p = F.ALPHABET[token];
    const duration = perLetterMs(dayConfig.fog);
    letterDeadline = performance.now() + duration;
    render();
    tickTimer();
  }

  function render() {
    if (phase !== 'transcribe' || tokenIndex >= tokens.length) return;
    const token = tokens[tokenIndex];
    const p = F.ALPHABET[token];
    if (!p) return;
    swayPhase += 0.12;
    drawStation(ctx, canvas.width, canvas.height, p.left, p.right, dayConfig.fog, swayPhase);
  }

  function tickTimer() {
    cancelAnimationFrame(rafId);
    const step = () => {
      const now = performance.now();
      const remain = Math.max(0, letterDeadline - now);
      const duration = perLetterMs(dayConfig.fog);
      timerBar.style.width = `${(remain / duration) * 100}%`;
      render();
      if (remain <= 0) {
        transcript.push(null); // lost in the fog
        tokenIndex++;
        transcriptStrip.textContent = transcript.map((c) => c ?? '·').join('');
        advanceTranscribe();
        return;
      }
      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
  }

  function onLetterTap(letter) {
    if (phase !== 'transcribe' || tokenIndex >= tokens.length) return;
    cancelAnimationFrame(rafId);
    transcript.push(letter);
    tokenIndex++;
    transcriptStrip.textContent = transcript.map((c) => c ?? '·').join('');
    advanceTranscribe();
  }

  function finishTranscribe() {
    cancelAnimationFrame(rafId);
    phase = 'resend';
    hudPhase.textContent = 'Setting your own arms. Send when ready.';
    letterGrid.classList.add('hidden');
    canvas.parentElement.classList.add('hidden');
    timerBar.style.width = '100%';
    const believed = transcript.filter((c) => c !== null).join('');
    resendMessage.textContent = believed || '(nothing legible)';
    resendBody.classList.remove('hidden');
    resendBody.dataset.believed = believed;
  }

  function onSend() {
    if (phase !== 'resend') return;
    const believed = resendBody.dataset.believed || '';
    const result = F.simulateChain(believed || ' ', dayConfig.stations, `${save.seed}-day${save.day}`);
    const dispatch = F.dispatchFor(dayConfig.message, result.received, result.fidelity);

    save.completedDays.push({
      day: save.day,
      sent: dayConfig.message,
      believed,
      received: result.received,
      fidelity: result.fidelity,
    });
    saveGame(save);

    showDispatch(result, dispatch);
  }

  function showDispatch(result, dispatchText) {
    const isCrisis = save.day >= F.CRISIS_DAY;
    dispatchTitle.textContent = isCrisis ? 'The admiralty replies' : 'The coast replies';
    dispatchBody.textContent = dispatchText;
    dispatchFidelity.textContent = `Fidelity: ${Math.round(result.fidelity * 100)}%` +
      (isCrisis ? ` · crisis threshold ${Math.round(F.CRISIS_REQUIRED_FIDELITY * 100)}%` : '');
    const share = F.shareText(save.day, dayConfig.message, result.received);
    dispatchShare.value = share;
    nextBtn.textContent = save.day >= F.DAY_COUNT ? 'Finish the watch' : 'Next day';
    showScreen(dispatchScreen);
  }

  function onNext() {
    if (save.day >= F.DAY_COUNT) {
      showCampaignDone();
      return;
    }
    save.day += 1;
    saveGame(save);
    startDay();
  }

  function showCampaignDone() {
    const days = save.completedDays;
    const avg = days.length ? days.reduce((s, d) => s + d.fidelity, 0) / days.length : 0;
    const crisisEntry = days.find((d) => d.day === F.CRISIS_DAY);
    const crisisLine = crisisEntry
      ? (crisisEntry.fidelity >= F.CRISIS_REQUIRED_FIDELITY
        ? 'The crisis night message held together. The coast knew what to do.'
        : 'The crisis night message came apart in the chain. The coast did something, but not quite what you meant.')
      : '';
    campaignSummary.textContent = `Fourteen days on the hilltop. Average fidelity ${Math.round(avg * 100)}%. ${crisisLine}`;
    showScreen(campaignDoneScreen);
  }

  startBtn.addEventListener('click', () => {
    buildHowtoDiagrams();
    showScreen(howtoScreen);
  });
  howtoPlayBtn.addEventListener('click', () => startDay());
  sendBtn.addEventListener('click', onSend);
  nextBtn.addEventListener('click', onNext);
  copyBtn.addEventListener('click', () => {
    dispatchShare.select();
    try { document.execCommand('copy'); } catch (e) { /* clipboard may be unavailable */ }
  });
  restartBtn.addEventListener('click', () => {
    save = freshRun();
    saveGame(save);
    showScreen(titleScreen);
  });

  showScreen(titleScreen);

  // dev hook for headless verification (?dev=1)
  if (new URLSearchParams(location.search).get('dev') === '1') {
    window.__g = {
      getState: () => ({
        screen: currentScreenName(),
        day: save.day,
        phase,
        tokenIndex,
        transcript: transcript.slice(),
        dayConfig,
        completedDays: save.completedDays.slice(),
      }),
      goto: (name) => {
        if (name === 'title') showScreen(titleScreen);
        else if (name === 'howto') { buildHowtoDiagrams(); showScreen(howtoScreen); }
        else if (name === 'play') startDay();
        else if (name === 'dispatch') showScreen(dispatchScreen);
        else if (name === 'campaign-done') showCampaignDone();
      },
      tapLetter: (l) => onLetterTap(l),
      send: () => onSend(),
      next: () => onNext(),
      // Drives one full day with perfect transcription (mirrors flags.mjs
      // solveDay's "clean play" definition) without waiting on real timers.
      autoPlayDayClean: () => {
        startDay();
        while (phase === 'transcribe' && tokenIndex < tokens.length) {
          const token = tokens[tokenIndex];
          if (token === ' ') { advanceTranscribe(); continue; }
          onLetterTap(token);
        }
        onSend();
        return save.completedDays[save.completedDays.length - 1];
      },
      resetSave: () => { save = freshRun(); saveGame(save); showScreen(titleScreen); },
    };
  }
}
