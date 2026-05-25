/**
 * Fázy Mesiaca — čistý JS (synodický mesiac 29,53 dňa) + inline SVG.
 * Severná pologuľa (SK): dorastá = svetlo vpravo, ubúda = vľavo.
 * Vizuál: maska + posunutý kruh tieňa (prirodzený zakrivený terminator).
 */
(function (global) {
  const SYNODIC_DAYS = 29.53;
  const EPOCH_UTC = Date.UTC(2000, 0, 6, 18, 14, 0);

  const PHASE_NAMES = [
    'Nov',
    'Dorastajúci srpek',
    'Prvá štvrť',
    'Dorastajúci vypuklý Mesiac',
    'Spln',
    'Ubúdajúci vypuklý Mesiac',
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
      label: phaseLabel(age, illumination),
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

  function phaseLabel(age, illumination) {
    const pct = Math.round(illumination * 100);
    return `${phaseNameFromAge(age)} (${pct} %)`;
  }

  /** Stred kruhu tieňa v maske (čierna = skryté). k=0 nov, k=1 spln. */
  function shadowCircleX(cx, r, illumination, waxing) {
    const k = Math.max(0, Math.min(1, illumination));
    const shift = 2 * r * k;
    return waxing ? cx - shift : cx + shift;
  }

  function applyMoonToElement(svgRoot, phaseInfo) {
    if (!svgRoot) return;
    const cx = 50;
    const cy = 50;
    const r = 42;
    const k = phaseInfo.illumination;
    const shadow = document.getElementById('liveMoonShadow');
    const label = document.getElementById('liveMoonLabel');
    const disk = document.getElementById('liveMoonDisk');

    if (shadow) {
      const sx = shadowCircleX(cx, r, k, phaseInfo.waxing);
      shadow.setAttribute('cx', String(sx));
      shadow.setAttribute('cy', String(cy));
      shadow.setAttribute('r', String(r));
    }
    if (disk) {
      disk.setAttribute('opacity', k < 0.02 ? '0.12' : '1');
    }
    if (label) {
      label.textContent = phaseInfo.label;
    }
    svgRoot.setAttribute('aria-label', phaseInfo.name);
  }

  global.MoonPhase = {
    SYNODIC_DAYS,
    EPOCH_UTC,
    computeMoonPhase,
    shadowCircleX,
    applyMoonToElement,
    PHASE_NAMES
  };
})(typeof window !== 'undefined' ? window : globalThis);
