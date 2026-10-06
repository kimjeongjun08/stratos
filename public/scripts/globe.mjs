// ORI — WebGL globe.
// Builds a stylized dot-grid planet with a fresnel atmosphere, glowing region
// nodes, and animated data arcs with travelling pulses. Shares one render loop
// per instance; pauses when offscreen. Custom GLSL is fetched from /shaders.

import * as THREE from 'three';

const CYAN = new THREE.Color(0.22, 0.91, 1.0);
const VIOLET = new THREE.Color(0.55, 0.48, 1.0);
const RADIUS = 1.0;

// cache shader sources across instances
let shaderCache = null;
async function loadShaders() {
  if (shaderCache) return shaderCache;
  const [vert, frag, atmo] = await Promise.all([
    fetch('/shaders/globe.vert.glsl').then((r) => r.text()),
    fetch('/shaders/globe.frag.glsl').then((r) => r.text()),
    fetch('/shaders/atmosphere.frag.glsl').then((r) => r.text()),
  ]);
  shaderCache = { vert, frag, atmo };
  return shaderCache;
}

function latLonToVec3(lat, lon, r = RADIUS) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta)
  );
}

export async function createGlobe(canvas, options = {}) {
  const { interactive = false, regions = [], arcs = true, onRegionHover } = options;
  const { vert, frag, atmo } = await loadShaders();

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 0.35, 3.2);

  // pivot handles pointer parallax; root spins continuously inside it.
  const pivot = new THREE.Group();
  scene.add(pivot);
  const root = new THREE.Group();
  root.rotation.z = 0.35; // axial tilt
  pivot.add(root);

  // --- globe surface ---
  const uniforms = {
    uTime: { value: 0 },
    uColorA: { value: CYAN },
    uColorB: { value: VIOLET },
  };
  const globeMat = new THREE.ShaderMaterial({
    vertexShader: vert, fragmentShader: frag, uniforms,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const globe = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 96, 96), globeMat);
  root.add(globe);

  // inner solid core so the back grid doesn't bleed through harshly
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(RADIUS * 0.985, 48, 48),
    new THREE.MeshBasicMaterial({ color: 0x05060a })
  );
  root.add(core);

  // --- atmosphere ---
  const atmoMat = new THREE.ShaderMaterial({
    vertexShader: vert, fragmentShader: atmo, uniforms,
    transparent: true, blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false,
  });
  const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(RADIUS * 1.22, 48, 48), atmoMat);
  root.add(atmosphere);

  // --- region nodes ---
  const nodeGroup = new THREE.Group();
  root.add(nodeGroup);
  const nodeMeshes = [];
  const nodeGeo = new THREE.SphereGeometry(0.022, 12, 12);
  regions.forEach((rg) => {
    const pos = latLonToVec3(rg.lat, rg.lon, RADIUS * 1.01);
    const color = rg.tier === 'core' ? CYAN : VIOLET;
    const mat = new THREE.MeshBasicMaterial({ color });
    const m = new THREE.Mesh(nodeGeo, mat);
    m.position.copy(pos);
    m.userData.region = rg;
    nodeGroup.add(m);

    // halo ring
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.03, 0.05, 20),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
    );
    ring.position.copy(pos);
    ring.lookAt(0, 0, 0);
    m.userData.ring = ring;
    nodeGroup.add(ring);
    nodeMeshes.push(m);
  });

  // --- data arcs with travelling pulses ---
  const arcGroup = new THREE.Group();
  root.add(arcGroup);
  const pulses = [];
  if (arcs && regions.length > 1) {
    const pairCount = Math.min(14, regions.length);
    for (let i = 0; i < pairCount; i++) {
      const a = regions[Math.floor(Math.random() * regions.length)];
      const b = regions[Math.floor(Math.random() * regions.length)];
      if (a === b) continue;
      const start = latLonToVec3(a.lat, a.lon, RADIUS * 1.01);
      const end = latLonToVec3(b.lat, b.lon, RADIUS * 1.01);
      const mid = start.clone().add(end).multiplyScalar(0.5).normalize()
        .multiplyScalar(RADIUS * (1.25 + start.distanceTo(end) * 0.18));
      const curve = new THREE.QuadraticBezierCurve3(start, mid, end);

      const pts = curve.getPoints(60);
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: CYAN, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending,
      }));
      arcGroup.add(line);

      const pulse = new THREE.Mesh(
        new THREE.SphereGeometry(0.018, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending })
      );
      arcGroup.add(pulse);
      pulses.push({ curve, mesh: pulse, t: Math.random(), speed: 0.12 + Math.random() * 0.18 });
    }
  }

  // --- starfield backdrop ---
  const starGeo = new THREE.BufferGeometry();
  const starCount = 600;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(8 + Math.random() * 6);
    starPos.set([v.x, v.y, v.z], i * 3);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x8b93a7, size: 0.02, transparent: true, opacity: 0.6 }));
  scene.add(stars);

  // --- interaction ---
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2(-2, -2);
  let hovered = null;
  const targetRot = { x: 0, y: 0 };

  function onPointerMove(e) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    targetRot.y = pointer.x * 0.4;
    targetRot.x = pointer.y * 0.25;
  }
  if (interactive) {
    canvas.addEventListener('pointermove', onPointerMove);
  } else {
    window.addEventListener('pointermove', (e) => {
      targetRot.y = (e.clientX / innerWidth - 0.5) * 0.3;
      targetRot.x = (e.clientY / innerHeight - 0.5) * 0.2;
    }, { passive: true });
  }

  // --- resize ---
  function resize() {
    const w = canvas.clientWidth || canvas.offsetWidth;
    const h = canvas.clientHeight || canvas.offsetHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  // --- visibility gate ---
  let visible = true;
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0 });
  io.observe(canvas);

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clock = new THREE.Clock();
  let raf;

  function frame() {
    raf = requestAnimationFrame(frame);
    if (!visible) return;
    const dt = clock.getDelta();
    const t = clock.elapsedTime;
    uniforms.uTime.value = t;

    if (!reduceMotion) root.rotation.y += dt * 0.08;
    // smooth pointer parallax on the pivot (independent of the spin)
    pivot.rotation.y += (targetRot.y - pivot.rotation.y) * 0.05;
    pivot.rotation.x += (targetRot.x - pivot.rotation.x) * 0.05;

    // pulse node rings
    nodeMeshes.forEach((m, i) => {
      const s = 1 + Math.sin(t * 2 + i) * 0.25;
      if (m.userData.ring) m.userData.ring.scale.setScalar(s);
    });

    // move arc pulses
    pulses.forEach((p) => {
      p.t = (p.t + dt * p.speed) % 1;
      p.curve.getPoint(p.t, p.mesh.position);
      p.mesh.scale.setScalar(0.6 + Math.sin(p.t * Math.PI) * 0.8);
    });

    // hover test
    if (interactive) {
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(nodeMeshes, false);
      const next = hits[0]?.object ?? null;
      if (next !== hovered) {
        if (hovered) hovered.scale.setScalar(1);
        hovered = next;
        if (hovered) {
          hovered.scale.setScalar(1.8);
          onRegionHover?.(hovered.userData.region);
        } else {
          onRegionHover?.(null);
        }
      }
    }

    renderer.render(scene, camera);
  }
  frame();

  return {
    // focus the globe on a given region (used by the region list hover)
    focusRegion(code) {
      const m = nodeMeshes.find((x) => x.userData.region.code === code);
      if (!m) return;
      nodeMeshes.forEach((x) => x.scale.setScalar(1));
      m.scale.setScalar(1.8);
      // spin the globe so the region rotates toward the camera
      const p = m.position.clone().normalize();
      root.rotation.y = Math.atan2(p.x, p.z) - Math.PI / 2;
    },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect(); io.disconnect();
      renderer.dispose();
    },
  };
}

export default createGlobe;
