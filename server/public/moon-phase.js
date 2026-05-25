/**
 * Fázy Mesiaca — čistý JS (synodický mesiac 29,53 dňa) + inline SVG.
 * Severná pologuľa (SK): dorastá = svetlo vpravo, ubúda = vľavo.
 */
(function (global) {
  const SYNODIC_DAYS = 29.53;
  const EPOCH_UTC = Date.UTC(2000, 0, 6, 18, 14, 0);

  const PHASE_NAMES = [
    'Nov',
    'Dorastajúci srpek',
    'Prvá štvrť',
    'Dorastajúci štvrtinový Mesiac',
    'Spln',
    'Ubúdajúci štvrtinový Mesiac',
    'Posledná štvrť',
    'Ubúdajúci srpek'
  ];

  function computeMoonPhase(date) {
    const t = date instanceof Date ? date : new Date(date);
    const days = (t.getTime() - EPOCH_UTC) / 86400000;
    const age = ((days % SYNODIC_DAYS) + SYNODIC_DAYS) % SYNODIC_DAYS;
    const phase = age / SYNODIC_DAYS;
    const illumination = (1 - Math.cos(phase * 2 * Math.PI)) / 2;
    const waxing = age < SYNODIC_DAYS / 2;
    return {
      age,
      phase,
      illumination,
      waxing,
      name: phaseNameFromAge(age),
      label: phaseLabel(age, illumination, waxing),
      illuminationPct: Math.round(illumination * 1000) / 10
    };
  }

  function phaseNameFromAge(age) {
    const s = SYNODIC_DAYS;
    if (age < s * 0.03) return PHASE_NAMES[0];
    if (age < s * 0.22) return PHASE_NAMES[1];
    if (age < s * 0.28) return PHASE_NAMES[2];
    if (age < s * 0.47) return PHASE_NAMES[3];
    if (age < s * 0.53) return PHASE_NAMES[4];
    if (age < s * 0.72) return PHASE_NAMES[5];
    if (age < s * 0.78) return PHASE_NAMES[6];
    return PHASE_NAMES[7];
  }

  function phaseLabel(age, illumination, waxing) {
    const name = phaseNameFromAge(age);
    const pct = Math.round(illumination * 100);
    return `${name} (${pct} %)`;
  }

  function fullDiskPath(cx, cy, r) {
    return `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy} Z`;
  }

  /**
   * Osvetlená časť disku — dva prekrývajúce sa kruhy (zakrivený terminator).
   * @param {number} phase 0..1 (0 nov, 0.5 spln, 1 nov)
   */
  function litDiskPath(cx, cy, r, phase) {
    const p = ((phase % 1) + 1) % 1;
    const waxing = p <= 0.5;
    const t = waxing ? p * 2 : (1 - p) * 2;

    if (t <= 0.001) return '';
    if (t >= 0.999) return fullDiskPath(cx, cy, r);

    const sign = waxing ? 1 : -1;

    if (t <= 0.5) {
      const offset = r * Math.cos(t * Math.PI);
      const termR = r * Math.sin(t * Math.PI);
      const sweepOut = sign > 0 ? 1 : 0;
      const sweepIn = sign > 0 ? 0 : 1;
      return [
        `M ${cx} ${cy - r}`,
        `A ${r} ${r} 0 0 ${sweepOut} ${cx} ${cy + r}`,
        `A ${termR} ${termR} 0 0 ${sweepIn} ${cx} ${cy - r}`,
        'Z'
      ].join(' ');
    }

    const offset = r * Math.cos((1 - t) * Math.PI);
    const termR = r * Math.sin((1 - t) * Math.PI);
    const sweepOut = sign > 0 ? 0 : 1;
    const sweepIn = sign > 0 ? 1 : 0;
    return [
      `M ${cx + sign * r} ${cy}`,
      `A ${r} ${r} 0 0 ${sweepOut} ${cx} ${cy - r}`,
      `A ${r} ${r} 0 0 ${sweepOut} ${cx} ${cy + r}`,
      `A ${termR} ${termR} 0 0 ${sweepIn} ${cx + sign * r} ${cy}`,
      'Z'
    ].join(' ');
  }

  /** SVG pre widget (viewBox 0 0 100 100). */
  function moonSvgMarkup(phaseInfo, size) {
    const cx = 50;
    const cy = 50;
    const r = 42;
    const phase = phaseInfo.phase;
    const lit = litDiskPath(cx, cy, r, phase);
    const uid = `mg${Math.random().toString(36).slice(2, 9)}`;
    return `
<svg class="moon-phase-svg" viewBox="0 0 100 100" width="${size}" height="${size}" role="img" aria-label="${phaseInfo.name}">
  <defs>
    <radialGradient id="${uid}" cx="38%" cy="32%">
      <stop offset="0%" stop-color="#f8fafc"/>
      <stop offset="100%" stop-color="#94a3b8"/>
    </radialGradient>
  </defs>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="rgba(15,23,42,.65)"/>
  <path fill="url(#${uid})" d="${lit || `M ${cx} ${cy} m 0 0`}"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(148,163,184,.4)" stroke-width="1.2"/>
</svg>`.trim();
  }

  function applyMoonToElement(svgRoot, phaseInfo) {
    if (!svgRoot) return;
    const cx = 50;
    const cy = 50;
    const r = 42;
    const lit = document.getElementById('liveMoonLit');
    const label = document.getElementById('liveMoonLabel');
    if (lit) {
      lit.setAttribute('d', litDiskPath(cx, cy, r, phaseInfo.phase) || `M ${cx} ${cy} m 0 0`);
    }
    if (label) {
      label.textContent = phaseInfo.label;
    }
    svgRoot.setAttribute('aria-label', phaseInfo.name);
  }

  global.MoonPhase = {
    SYNODIC_DAYS,
    computeMoonPhase,
    litDiskPath,
    moonSvgMarkup,
    applyMoonToElement,
    PHASE_NAMES
  };
})(typeof window !== 'undefined' ? window : globalThis);
