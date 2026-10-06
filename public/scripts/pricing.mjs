// ORI — interactive pricing calculator.
// Reads unit economics from /data/pricing.json, recomputes on every slider
// move, and animates the headline figure + comparison bars.

const fmtUSD = (n) => n >= 1000
  ? '$' + (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
  : '$' + n.toFixed(n < 100 ? 2 : 0);

export async function initPricing(root) {
  if (!root) return;
  let cfg;
  try {
    cfg = await fetch('/data/pricing.json').then((r) => r.json());
  } catch {
    cfg = { unit: { requestsPerMillion: 0.18, cpuMsPerMillion: 0.0000021, gpuMultiplier: 7.5, egressPerTB: 24, basePlatform: 0 }, legacyMultiplier: 2.9 };
  }

  const inputs = {
    requests: root.querySelector('[data-calc-input="requests"]'),
    cpu: root.querySelector('[data-calc-input="cpu"]'),
    gpu: root.querySelector('[data-calc-input="gpu"]'),
    egress: root.querySelector('[data-calc-input="egress"]'),
  };
  const outs = {
    requests: root.querySelector('[data-calc-out="requests"]'),
    cpu: root.querySelector('[data-calc-out="cpu"]'),
    gpu: root.querySelector('[data-calc-out="gpu"]'),
    egress: root.querySelector('[data-calc-out="egress"]'),
  };
  const totalEl = root.querySelector('[data-calc-total]');
  const vsEl = root.querySelector('[data-calc-vs]');
  const barOri = root.querySelector('[data-calc-bar="ori"]');
  const barLegacy = root.querySelector('[data-calc-bar="legacy"]');

  let displayed = 0;

  function compute() {
    const reqM = +inputs.requests.value;        // millions
    const cpuMs = +inputs.cpu.value;             // ms avg
    const gpuShare = +inputs.gpu.value / 100;    // 0..1
    const egressTB = +inputs.egress.value;       // TB

    const u = cfg.unit;
    const requestCost = reqM * u.requestsPerMillion;
    const cpuUnits = reqM * 1e6 * cpuMs;
    const computeCost = cpuUnits * u.cpuMsPerMillion * (1 + gpuShare * (u.gpuMultiplier - 1));
    const egressCost = egressTB * u.egressPerTB;
    const total = (u.basePlatform || 0) + requestCost + computeCost + egressCost;
    const legacy = total * cfg.legacyMultiplier;

    outs.requests.textContent = reqM >= 1000 ? (reqM / 1000) + 'B' : reqM + 'M';
    outs.cpu.textContent = cpuMs + 'ms';
    outs.gpu.textContent = inputs.gpu.value + '%';
    outs.egress.textContent = egressTB + 'TB';

    const savedPct = Math.round((1 - total / legacy) * 100);
    vsEl.textContent = `Save ~${savedPct}% vs. a provisioned hyperscaler`;

    const max = Math.max(total, legacy);
    barOri.style.width = (total / max * 100) + '%';
    barLegacy.style.width = (legacy / max * 100) + '%';

    animateTo(total);
  }

  function animateTo(target) {
    const start = displayed;
    const t0 = performance.now();
    const dur = 350;
    function step(now) {
      const k = Math.min((now - t0) / dur, 1);
      const eased = 1 - Math.pow(1 - k, 3);
      displayed = start + (target - start) * eased;
      totalEl.textContent = fmtUSD(displayed);
      if (k < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  Object.values(inputs).forEach((i) => i && i.addEventListener('input', compute));
  compute();
}

export default initPricing;
