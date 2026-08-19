import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { ThemeId } from "../types";

interface AmbientCanvasProps {
  currentTheme: ThemeId;
}

function makeGlowTexture(inner: string, mid: string, outer: string): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.32, mid);
  grad.addColorStop(1, outer);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function makeSoftSpriteTexture(inner: string, outer: string): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.55, outer);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

// Soft round particle (hot core â†’ transparent halo) for embers & stars
function makeSoftDotTexture(inner: string, mid: string): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.28, mid);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

// Crystalline six-armed snowflake with a bright core
function makeFlakeTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.translate(size / 2, size / 2);
  ctx.lineCap = "round";
  for (let i = 0; i < 6; i++) {
    const ang = (i * Math.PI) / 3;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    const grad = ctx.createLinearGradient(0, 0, dx * 26, dy * 26);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(1, "rgba(200,225,255,0)");
    ctx.strokeStyle = grad;
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(dx * 26, dy * 26);
    ctx.stroke();
  }
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, 7);
  core.addColorStop(0, "rgba(255,255,255,0.95)");
  core.addColorStop(1, "rgba(210,235,255,0)");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(0, 0, 7, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

// Vertical gradient (night sky backdrop)
function makeVerticalGradientTexture(stops: Array<[number, string]>): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createLinearGradient(0, 0, 0, size);
  for (const [off, color] of stops) grad.addColorStop(off, color);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function makeSprite(material: THREE.SpriteMaterial, x: number, y: number, z: number, sx: number, sy: number) {
  const sprite = new THREE.Sprite(material);
  sprite.position.set(x, y, z);
  sprite.scale.set(sx, sy, 1);
  return sprite;
}

// Recreation of the official Skyrim Imperial Dragon emblem:

export default function AmbientCanvas3D({ currentTheme }: AmbientCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Only activate for immersive animated themes
    if (
      currentTheme !== "cyberpunk" &&
      currentTheme !== "matrix" &&
      currentTheme !== "outrun" &&
      currentTheme !== "makora" &&
      currentTheme !== "skyrim" &&
      currentTheme !== "dragons_dogma"
    ) {
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    let isDisposed = false;
    let animId = 0;
    let isVisible = !document.hidden;

    // Visibility change handler to save GPU / battery
    const onVisibilityChange = () => {
      isVisible = !document.hidden;
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    // =========================================================================
    // 1. MATRIX DIGITAL RAIN (Canvas 2D Stream)
    // =========================================================================
    if (currentTheme === "matrix") {
      const canvas = document.createElement("canvas");
      canvas.className = "ambient-bg-canvas";
      container.appendChild(canvas);

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        document.removeEventListener("visibilitychange", onVisibilityChange);
        if (container.contains(canvas)) {
          container.removeChild(canvas);
        }
        return;
      }

      const resize = () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
      };
      resize();
      window.addEventListener("resize", resize);

      const chars = "ï½¦ï½±ï½³ï½´ï½µï½¶ï½·ï½¹ï½ºï½»ï½¼ï½½ï½¾ï½¿ï¾€ï¾‚ï¾ƒï¾…ï¾†ï¾‡ï¾ˆï¾Šï¾‹ï¾Žï¾ï¾ï¾‘ï¾’ï¾“ï¾”ï¾•ï¾—ï¾˜ï¾œ10234567890ABCDEF$#%&*+-=<>";
      const fontSize = 13;
      let columns = Math.floor(canvas.width / fontSize);
      let drops: number[] = Array(columns).fill(1).map(() => Math.floor(Math.random() * -50));

      const renderMatrix = () => {
        if (isDisposed) return;
        animId = requestAnimationFrame(renderMatrix);
        if (!isVisible) return;

        // Fading dark green phosphor trail
        ctx.fillStyle = "rgba(2, 7, 3, 0.07)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.font = `${fontSize}px "Consolas", monospace`;

        for (let i = 0; i < drops.length; i++) {
          const char = chars[Math.floor(Math.random() * chars.length)];
          const x = i * fontSize;
          const y = drops[i] * fontSize;

          // Leading bright glyph
          ctx.fillStyle = "#e8ffe8";
          ctx.shadowBlur = 8;
          ctx.shadowColor = "#00ff66";
          ctx.fillText(char, x, y);

          // Trail glyph behind
          if (drops[i] > 1) {
            ctx.fillStyle = "#00e65c";
            ctx.shadowBlur = 3;
            ctx.shadowColor = "#00bb44";
            const prevChar = chars[Math.floor(Math.random() * chars.length)];
            ctx.fillText(prevChar, x, y - fontSize);
          }

          ctx.shadowBlur = 0;

          if (y > canvas.height && Math.random() > 0.975) {
            drops[i] = 0;
          }
          drops[i]++;
        }
      };

      renderMatrix();

      return () => {
        isDisposed = true;
        cancelAnimationFrame(animId);
        window.removeEventListener("resize", resize);
        document.removeEventListener("visibilitychange", onVisibilityChange);
        if (container.contains(canvas)) {
          container.removeChild(canvas);
        }
      };
    }

    // =========================================================================
    // 2. CYBERPUNK 2077 & OUTRUN (Three.js 3D Engine)
    // =========================================================================
    const width = window.innerWidth;
    const height = window.innerHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    camera.position.set(0, 2, 8);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.className = "ambient-bg-canvas";
    container.appendChild(renderer.domElement);

    let mouseX = 0;
    let mouseY = 0;
    const onMouseMove = (e: MouseEvent) => {
      mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
      mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener("mousemove", onMouseMove);

    const onResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    // Objects group
    const group = new THREE.Group();
    scene.add(group);

    // Dynamic animation references
    let avPositionsRef: Float32Array | null = null;
    let avGeoRef: THREE.BufferGeometry | null = null;
    let frostPositionsRef: Float32Array | null = null;
    let frostSpeedsRef: Float32Array | null = null;
    let frostGeoRef: THREE.BufferGeometry | null = null;
    let skyrimLogoRef: THREE.Group | null = null;
    let ddDragonRingRef: THREE.Group | null = null;
    let ddHeartGroupRef: THREE.Group | null = null;
    let ddHeartCoreRef: THREE.Sprite | null = null;
    let ddHeartGlowRef: THREE.Sprite | null = null;
    let ddSealRef: THREE.Mesh | null = null;
    let ddFloorGlowRef: THREE.Sprite | null = null;
    let ddEmberSystemsRef: Array<{
      positions: Float32Array;
      speeds: Float32Array;
      geo: THREE.BufferGeometry;
      count: number;
      floor: number;
      ceiling: number;
      spread: number;
      mat: THREE.PointsMaterial;
      baseOpacity: number;
      flickerFreq: number;
      flickerPhase: number;
    }> = [];
    let ddSmokeRefs: Array<{ sprite: THREE.Sprite; speed: number; baseX: number; phase: number; opacity: number }> = [];
    let skyStarRefs: Array<{ mat: THREE.PointsMaterial; phase: number; freq: number; baseOpacity: number }> = [];
    let skyFrostRefs: Array<{
      positions: Float32Array;
      speeds: Float32Array;
      drift: Float32Array;
      geo: THREE.BufferGeometry;
      count: number;
      mat: THREE.PointsMaterial;
      baseOpacity: number;
      freq: number;
      phase: number;
      floor: number;
      ceiling: number;
    }> = [];
    let skyMistRefs: Array<{ sprite: THREE.Sprite; speed: number; baseY: number; phase: number; opacity: number }> = [];
    let samuraiMaskRef: THREE.Group | null = null;

    if (currentTheme === "cyberpunk") {
      // =======================================================================
      // 1. CYBERPUNK 2077: SAMURAI ONI CYBER-MASK, NIGHT CITY SKYLINE & AVs
      // =======================================================================
      const cyberGroup = new THREE.Group();
      cyberGroup.position.set(0, 0, -10);

      const yellowMat = new THREE.MeshBasicMaterial({ color: 0xfcee09, wireframe: true, transparent: true, opacity: 0.75 });
      const cyanMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, wireframe: true, transparent: true, opacity: 0.75 });
      const redMat = new THREE.MeshBasicMaterial({ color: 0xff003c, wireframe: true, transparent: true, opacity: 0.8 });
      const neonCyanSolid = new THREE.MeshBasicMaterial({ color: 0x00f0ff });

      // --- 3D Samurai Oni Cyber-Mask ---
      const maskGroup = new THREE.Group();
      maskGroup.position.set(2.8, 0.4, 2.0);
      maskGroup.scale.set(0.95, 0.95, 0.95);

      // Faceplate
      const faceGeo = new THREE.CylinderGeometry(0.85, 0.5, 1.5, 6);
      const face = new THREE.Mesh(faceGeo, yellowMat);
      maskGroup.add(face);

      // Browplate / Forehead
      const browGeo = new THREE.BoxGeometry(1.4, 0.35, 0.7);
      const brow = new THREE.Mesh(browGeo, redMat);
      brow.position.set(0, 0.75, 0.15);
      maskGroup.add(brow);

      // Cyber Oni Horn Vents
      [-1, 1].forEach((side) => {
        const hornGeo = new THREE.ConeGeometry(0.18, 0.9, 4);
        const horn = new THREE.Mesh(hornGeo, yellowMat);
        horn.position.set(side * 0.65, 1.25, 0.1);
        horn.rotation.z = -side * 0.35;
        horn.rotation.x = -0.2;
        maskGroup.add(horn);

        // Cyan Optic Sensor
        const opticGeo = new THREE.BoxGeometry(0.28, 0.1, 0.12);
        const optic = new THREE.Mesh(opticGeo, neonCyanSolid);
        optic.position.set(side * 0.38, 0.32, 0.68);
        maskGroup.add(optic);

        // Oni Cyber Fangs
        const fangGeo = new THREE.ConeGeometry(0.09, 0.45, 4);
        const fang = new THREE.Mesh(fangGeo, cyanMat);
        fang.position.set(side * 0.28, -0.65, 0.55);
        fang.rotation.x = Math.PI;
        maskGroup.add(fang);
      });

      samuraiMaskRef = maskGroup;
      cyberGroup.add(maskGroup);

      // --- Night City Megabuildings ---
      for (let i = 0; i < 24; i++) {
        const bw = 1.0 + Math.random() * 1.8;
        const bh = 3.5 + Math.random() * 9.5;
        const bd = 1.0 + Math.random() * 1.8;
        const bx = (i - 12) * 1.7 + (Math.random() - 0.5) * 0.8;
        const bz = -Math.random() * 16 - 2;

        const bGeo = new THREE.BoxGeometry(bw, bh, bd);
        const mat = i % 3 === 0 ? yellowMat : i % 3 === 1 ? cyanMat : redMat;
        const building = new THREE.Mesh(bGeo, mat);
        building.position.set(bx, bh / 2 - 3.0, bz);
        cyberGroup.add(building);

        if (Math.random() > 0.4) {
          const antGeo = new THREE.CylinderGeometry(0.02, 0.02, 1.4);
          const beacon = new THREE.Mesh(antGeo, cyanMat);
          beacon.position.set(bx, bh - 3.0 + 0.7, bz);
          cyberGroup.add(beacon);
        }
      }

      // Ground Cyber Grid
      const gridHelper = new THREE.GridHelper(50, 30, 0xfcee09, 0x00f0ff);
      gridHelper.position.y = -3.0;
      cyberGroup.add(gridHelper);

      // Flying AV Traffic
      const avCount = 50;
      const avGeo = new THREE.BufferGeometry();
      const avPos = new Float32Array(avCount * 3);
      for (let i = 0; i < avCount; i++) {
        avPos[i * 3] = (Math.random() - 0.5) * 32;
        avPos[i * 3 + 1] = (Math.random() - 0.1) * 7.5;
        avPos[i * 3 + 2] = -Math.random() * 16;
      }
      avGeo.setAttribute("position", new THREE.BufferAttribute(avPos, 3));
      avPositionsRef = avPos;
      avGeoRef = avGeo;

      const avMat = new THREE.PointsMaterial({
        color: 0x00f0ff,
        size: 0.24,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
      });
      const avTraffic = new THREE.Points(avGeo, avMat);
      cyberGroup.add(avTraffic);

      group.add(cyberGroup);
    } else if (currentTheme === "outrun") {
      // 80s Synthwave Perspective Grid
      const gridHelper = new THREE.GridHelper(60, 50, 0xff007f, 0x7b2cbf);
      gridHelper.position.y = -2;
      group.add(gridHelper);

      // Distant Neon Horizon Sun Wireframe Ring
      const ringGeo = new THREE.RingGeometry(2.5, 2.7, 32);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xffbe0b,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.8,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.set(0, 0.5, -18);
      group.add(ring);
    } else if (currentTheme === "makora") {
      // =======================================================================
      // 2. MAKORA DIVINE GENERAL: 8-HANDLED WHEEL OF ADAPTATION (Dharmachakra)
      // =======================================================================
      const wheelGroup = new THREE.Group();
      wheelGroup.position.set(0, 0, -10);

      const goldMat = new THREE.MeshBasicMaterial({
        color: 0xffd700,
        wireframe: true,
        transparent: true,
        opacity: 0.75,
      });

      const goldSolidMat = new THREE.MeshBasicMaterial({
        color: 0xffe066,
        transparent: true,
        opacity: 0.9,
      });

      const jadeMat = new THREE.MeshBasicMaterial({
        color: 0x00f0ff,
        transparent: true,
        opacity: 0.95,
      });

      // Outer Torus Rim
      const outerTorusGeo = new THREE.TorusGeometry(3.0, 0.08, 16, 48);
      const outerTorus = new THREE.Mesh(outerTorusGeo, goldSolidMat);
      wheelGroup.add(outerTorus);

      const outerTorusWire = new THREE.Mesh(new THREE.TorusGeometry(3.3, 0.04, 16, 48), goldMat);
      wheelGroup.add(outerTorusWire);

      // Inner Torus Hub
      const innerTorusGeo = new THREE.TorusGeometry(1.0, 0.06, 16, 32);
      const innerTorus = new THREE.Mesh(innerTorusGeo, goldSolidMat);
      wheelGroup.add(innerTorus);

      // Central Sacred Core
      const coreGeo = new THREE.OctahedronGeometry(0.45, 0);
      const core = new THREE.Mesh(coreGeo, jadeMat);
      wheelGroup.add(core);

      // 8 Radiating Spokes & 8 Outer Handles
      for (let i = 0; i < 8; i++) {
        const angle = (i * Math.PI) / 4;

        const spokeGeo = new THREE.CylinderGeometry(0.03, 0.03, 2.0, 8);
        const spoke = new THREE.Mesh(spokeGeo, goldSolidMat);
        spoke.position.set(Math.cos(angle) * 2.0, Math.sin(angle) * 2.0, 0);
        spoke.rotation.z = angle - Math.PI / 2;
        wheelGroup.add(spoke);

        const handleGeo = new THREE.CylinderGeometry(0.08, 0.05, 0.6, 8);
        const handle = new THREE.Mesh(handleGeo, goldSolidMat);
        handle.position.set(Math.cos(angle) * 3.3, Math.sin(angle) * 3.3, 0);
        handle.rotation.z = angle - Math.PI / 2;
        wheelGroup.add(handle);

        const beadGeo = new THREE.SphereGeometry(0.08, 8, 8);
        const bead = new THREE.Mesh(beadGeo, jadeMat);
        bead.position.set(Math.cos(angle) * 3.65, Math.sin(angle) * 3.65, 0);
        wheelGroup.add(bead);
      }

      // Orbiting Divine Particles
      const particleCount = 180;
      const particleGeo = new THREE.BufferGeometry();
      const pPositions = new Float32Array(particleCount * 3);
      for (let i = 0; i < particleCount; i++) {
        const r = 2.5 + Math.random() * 2.5;
        const theta = Math.random() * Math.PI * 2;
        pPositions[i * 3] = Math.cos(theta) * r;
        pPositions[i * 3 + 1] = Math.sin(theta) * r;
        pPositions[i * 3 + 2] = (Math.random() - 0.5) * 2.0;
      }
      particleGeo.setAttribute("position", new THREE.BufferAttribute(pPositions, 3));
      const particleMat = new THREE.PointsMaterial({
        color: 0xffd700,
        size: 0.12,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
      });
      const particles = new THREE.Points(particleGeo, particleMat);
      wheelGroup.add(particles);

      group.add(wheelGroup);
    } else if (currentTheme === "skyrim") {
      // =======================================================================
      // 3. SKYRIM: IMPERIAL DRAGON SEAL OF AKATOSH & TAMRIEL FROST NIGHT
      // =======================================================================
      const skyrimGroup = new THREE.Group();
      skyrimGroup.position.set(0, 0, -10);

      // --- Deep Midnight Sky Gradient Backdrop (Darker cold frost) ---
      const nightMat = new THREE.MeshBasicMaterial({
        map: makeVerticalGradientTexture([
          [0, "#010204"],
          [0.35, "#010307"],
          [0.7, "#030711"],
          [1, "#050c1b"],
        ]),
        transparent: true,
        opacity: 0.99,
        depthWrite: false,
      });
      const nightGeo = new THREE.PlaneGeometry(90, 60);
      const night = new THREE.Mesh(nightGeo, nightMat);
      night.position.set(0, 2, -9);
      skyrimGroup.add(night);

      // --- Central Skyrim Imperial Dragon Crest (Seal of Akatosh) ---
      const skyrimLogo = new THREE.Group();
      skyrimLogo.position.set(0, 2.0, 0);

      const steelMat = new THREE.MeshBasicMaterial({
        color: 0xcfd8e3,
        side: THREE.DoubleSide,
      });
      const edgeLineMat = new THREE.LineBasicMaterial({
        color: 0x7dd3fc,
        transparent: true,
        opacity: 0.95,
      });

      const extrudeOpt = {
        depth: 0.22,
        bevelEnabled: true,
        bevelSegments: 3,
        steps: 1,
        bevelSize: 0.04,
        bevelThickness: 0.05,
      };

      // 1. Left Wing Blade (Hollow Diamond Outer Wing Frame)
      const leftWingShape = new THREE.Shape();
      leftWingShape.moveTo(-0.06, 3.8);
      leftWingShape.lineTo(-1.3, 2.2);
      leftWingShape.lineTo(-1.85, 0.7);
      leftWingShape.lineTo(-1.3, -1.3);
      leftWingShape.lineTo(-0.12, -3.9);
      leftWingShape.lineTo(-0.45, -2.8);
      leftWingShape.lineTo(-0.85, -1.3);
      leftWingShape.lineTo(-0.6, -0.4);
      leftWingShape.lineTo(-0.95, 0.45);
      leftWingShape.lineTo(-0.52, 1.25);
      leftWingShape.lineTo(-0.75, 1.6);
      leftWingShape.lineTo(-0.45, 2.6);
      leftWingShape.closePath();

      const leftHole = new THREE.Path();
      leftHole.moveTo(-0.55, 2.1);
      leftHole.lineTo(-1.15, 1.3);
      leftHole.lineTo(-1.45, 0.6);
      leftHole.lineTo(-1.05, -0.7);
      leftHole.lineTo(-0.35, -2.5);
      leftHole.lineTo(-0.6, -1.1);
      leftHole.lineTo(-0.75, 0.4);
      leftHole.lineTo(-0.5, 1.1);
      leftHole.closePath();
      leftWingShape.holes.push(leftHole);

      const leftWingGeo = new THREE.ExtrudeGeometry(leftWingShape, extrudeOpt);
      leftWingGeo.translate(0, 0, -0.11);
      const leftWing = new THREE.Mesh(leftWingGeo, steelMat);
      const leftWingEdges = new THREE.EdgesGeometry(leftWingGeo, 20);
      const leftWingLines = new THREE.LineSegments(leftWingEdges, edgeLineMat);
      skyrimLogo.add(leftWing);
      skyrimLogo.add(leftWingLines);

      // 2. Right Wing Blade (Lore-accurate broken / chipped bottom tip!)
      const rightWingShape = new THREE.Shape();
      rightWingShape.moveTo(0.06, 3.8);
      rightWingShape.lineTo(1.3, 2.2);
      rightWingShape.lineTo(1.85, 0.7);
      rightWingShape.lineTo(1.35, -0.6);
      // Jagged Broken Edge (Lore-accurate broken Akatosh wing tip!)
      rightWingShape.lineTo(1.15, -1.05);
      rightWingShape.lineTo(0.9, -0.85);
      rightWingShape.lineTo(0.65, -1.35); // Broken off point!
      rightWingShape.lineTo(0.6, -0.4);
      rightWingShape.lineTo(0.95, 0.45);
      rightWingShape.lineTo(0.52, 1.25);
      rightWingShape.lineTo(0.75, 1.6);
      rightWingShape.lineTo(0.45, 2.6);
      rightWingShape.closePath();

      const rightHole = new THREE.Path();
      rightHole.moveTo(0.55, 2.1);
      rightHole.lineTo(1.15, 1.3);
      rightHole.lineTo(1.45, 0.6);
      rightHole.lineTo(1.05, -0.5);
      rightHole.lineTo(0.75, 0.4);
      rightHole.lineTo(0.5, 1.1);
      rightHole.closePath();
      rightWingShape.holes.push(rightHole);

      const rightWingGeo = new THREE.ExtrudeGeometry(rightWingShape, extrudeOpt);
      rightWingGeo.translate(0, 0, -0.11);
      const rightWing = new THREE.Mesh(rightWingGeo, steelMat);
      const rightWingEdges = new THREE.EdgesGeometry(rightWingGeo, 20);
      const rightWingLines = new THREE.LineSegments(rightWingEdges, edgeLineMat);
      skyrimLogo.add(rightWing);
      skyrimLogo.add(rightWingLines);

      // 3. Central Akatosh Imperial Dragon (Head, S-neck, wing folds, zigzag tail)
      const dragonBodyShape = new THREE.Shape();
      // Dragon Head & Crown Horn
      dragonBodyShape.moveTo(0.0, 2.85);
      dragonBodyShape.lineTo(-0.16, 2.5);
      dragonBodyShape.lineTo(-0.35, 2.35);
      dragonBodyShape.lineTo(-0.58, 2.1);
      dragonBodyShape.lineTo(-0.5, 1.9);
      dragonBodyShape.lineTo(-0.32, 1.92);
      dragonBodyShape.lineTo(-0.16, 1.75);
      // S-Curved Neck
      dragonBodyShape.bezierCurveTo(0.32, 1.55, 0.52, 1.1, 0.25, 0.7);
      dragonBodyShape.lineTo(0.12, 0.55);
      // Left Wing Fold
      dragonBodyShape.bezierCurveTo(-0.45, 0.6, -1.35, 0.5, -1.5, 0.15);
      dragonBodyShape.lineTo(-1.3, -0.05);
      dragonBodyShape.bezierCurveTo(-0.9, -0.15, -0.4, -0.25, -0.15, -0.55);
      // Right Wing Fold
      dragonBodyShape.bezierCurveTo(0.4, -0.25, 0.9, -0.15, 1.3, -0.05);
      dragonBodyShape.lineTo(1.5, 0.15);
      dragonBodyShape.bezierCurveTo(1.35, 0.5, 0.45, 0.6, 0.15, 0.55);
      // Zigzag Tail
      dragonBodyShape.lineTo(0.08, -0.7);
      dragonBodyShape.lineTo(-0.18, -1.4);
      dragonBodyShape.lineTo(0.16, -2.1);
      dragonBodyShape.lineTo(-0.25, -2.9);
      dragonBodyShape.lineTo(0.2, -3.6);
      dragonBodyShape.lineTo(0.0, -4.3); // Arrow point tip
      dragonBodyShape.lineTo(-0.08, -3.6);
      dragonBodyShape.lineTo(0.04, -2.9);
      dragonBodyShape.lineTo(-0.06, -2.1);
      dragonBodyShape.lineTo(0.05, -1.4);
      dragonBodyShape.lineTo(-0.04, -0.7);
      dragonBodyShape.closePath();

      const dragonGeo = new THREE.ExtrudeGeometry(dragonBodyShape, {
        depth: 0.28,
        bevelEnabled: true,
        bevelSegments: 3,
        steps: 1,
        bevelSize: 0.05,
        bevelThickness: 0.06,
      });
      dragonGeo.translate(0, 0, -0.04);
      const dragonMesh = new THREE.Mesh(dragonGeo, steelMat);
      const dragonEdges = new THREE.EdgesGeometry(dragonGeo, 18);
      const dragonLines = new THREE.LineSegments(dragonEdges, edgeLineMat);
      skyrimLogo.add(dragonMesh);
      skyrimLogo.add(dragonLines);

      skyrimLogoRef = skyrimLogo;
      skyrimGroup.add(skyrimLogo);

      // --- Twinkling star field (three depth layers) ---
      skyStarRefs = [];
      const starTexture = makeSoftDotTexture("rgba(255,255,255,1)", "rgba(180,210,255,0.7)");
      const starLayers = [
        { count: 320, size: 0.045, yMin: 1.5, yMax: 13.5, opacity: 0.65, freq: 1.6 },
        { count: 180, size: 0.07, yMin: 2.5, yMax: 13.0, opacity: 0.5, freq: 1.1 },
        { count: 80, size: 0.1, yMin: 3.0, yMax: 12.0, opacity: 0.45, freq: 0.7 },
      ];
      for (const layer of starLayers) {
        const geo = new THREE.BufferGeometry();
        const pos = new Float32Array(layer.count * 3);
        for (let i = 0; i < layer.count; i++) {
          pos[i * 3] = (Math.random() - 0.5) * 40;
          pos[i * 3 + 1] = layer.yMin + Math.random() * (layer.yMax - layer.yMin);
          pos[i * 3 + 2] = -8 + Math.random() * 5;
        }
        geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        const mat = new THREE.PointsMaterial({
          size: layer.size,
          map: starTexture,
          color: 0xdfeaff,
          transparent: true,
          opacity: layer.opacity,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        skyrimGroup.add(new THREE.Points(geo, mat));
        skyStarRefs.push({
          mat,
          phase: Math.random() * Math.PI * 2,
          freq: layer.freq,
          baseOpacity: layer.opacity,
        });
      }

      // --- Drifting Frost Mist Banks (subtle) ---
      skyMistRefs = [];
      const mistTexture = makeSoftSpriteTexture("rgba(214,236,255,0.5)", "rgba(148,190,236,0.22)");
      for (let i = 0; i < 6; i++) {
        const mistMat = new THREE.SpriteMaterial({
          map: mistTexture,
          transparent: true,
          opacity: 0.025 + Math.random() * 0.035,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const sc = 3.5 + Math.random() * 4.2;
        const mist = makeSprite(
          mistMat,
          (Math.random() - 0.5) * 24,
          -3.2 + Math.random() * 5.8,
          -1.5 + Math.random() * 2.5,
          sc,
          sc * 0.45,
        );
        skyrimGroup.add(mist);
        skyMistRefs.push({
          sprite: mist,
          speed: (Math.random() > 0.5 ? 1 : -1) * (0.03 + Math.random() * 0.05),
          baseY: mist.position.y,
          phase: Math.random() * Math.PI * 2,
          opacity: mistMat.opacity,
        });
      }

      // --- Prominent Multi-Depth Frost & Snowflakes (Simulating Near & Far Parallax) ---
      skyFrostRefs = [];
      const flakeTexture = makeFlakeTexture();
      const frostLayers = [
        // 1. Foreground Mega-Flakes (CercanÃ­a inmediata: floating right past the screen!)
        { count: 28, size: 1.6, color: 0xffffff, min: 0.012, max: 0.022, spread: 32, zMin: 3.5, zMax: 6.5, opacity: 0.85, freq: 1.8 },
        // 2. Near Mid-Flakes
        { count: 160, size: 0.65, color: 0xeaf4ff, min: 0.009, max: 0.016, spread: 36, zMin: 0.5, zMax: 3.2, opacity: 0.92, freq: 2.2 },
        // 3. Main Emblem Layer Snow
        { count: 380, size: 0.28, color: 0xd9ecff, min: 0.006, max: 0.012, spread: 40, zMin: -4.0, zMax: 0.0, opacity: 0.88, freq: 1.6 },
        // 4. Deep Background Frost Dust (LejanÃ­a profunda)
        { count: 650, size: 0.12, color: 0xc0d8f8, min: 0.004, max: 0.008, spread: 44, zMin: -11.0, zMax: -5.0, opacity: 0.72, freq: 1.0 },
      ];
      for (const layer of frostLayers) {
        const geo = new THREE.BufferGeometry();
        const pos = new Float32Array(layer.count * 3);
        const speeds = new Float32Array(layer.count);
        const drift = new Float32Array(layer.count);
        for (let i = 0; i < layer.count; i++) {
          pos[i * 3] = (Math.random() - 0.5) * layer.spread;
          pos[i * 3 + 1] = (Math.random() - 0.5) * 24;
          pos[i * 3 + 2] = layer.zMin + Math.random() * (layer.zMax - layer.zMin);
          speeds[i] = layer.min + Math.random() * (layer.max - layer.min);
          drift[i] = Math.random() * Math.PI * 2;
        }
        geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        const mat = new THREE.PointsMaterial({
          size: layer.size,
          map: flakeTexture,
          color: layer.color,
          transparent: true,
          opacity: layer.opacity,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        skyrimGroup.add(new THREE.Points(geo, mat));
        skyFrostRefs.push({
          positions: pos,
          speeds,
          drift,
          geo,
          count: layer.count,
          mat,
          baseOpacity: layer.opacity,
          freq: layer.freq,
          phase: Math.random() * Math.PI * 2,
          floor: -12,
          ceiling: 12,
        });
      }

      // --- Rising Frost Dust (icy motes drifting upward) ---
      const frostCount = 160;
      const frostGeo = new THREE.BufferGeometry();
      const frostPos = new Float32Array(frostCount * 3);
      const frostSpeeds = new Float32Array(frostCount);
      for (let i = 0; i < frostCount; i++) {
        frostPos[i * 3] = (Math.random() - 0.5) * 28;
        frostPos[i * 3 + 1] = (Math.random() - 0.5) * 16;
        frostPos[i * 3 + 2] = (Math.random() - 0.5) * 10;
        frostSpeeds[i] = 0.02 + Math.random() * 0.05;
      }
      frostGeo.setAttribute("position", new THREE.BufferAttribute(frostPos, 3));
      frostPositionsRef = frostPos;
      frostSpeedsRef = frostSpeeds;
      frostGeoRef = frostGeo;

      const frostMat = new THREE.PointsMaterial({
        size: 0.07,
        map: starTexture,
        color: 0xd0e8ff,
        transparent: true,
        opacity: 0.62,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const frostDust = new THREE.Points(frostGeo, frostMat);
      skyrimGroup.add(frostDust);

      group.add(skyrimGroup);
    } else if (currentTheme === "dragons_dogma") {
      // =======================================================================
      // 4. DRAGON'S DOGMA: THE ARISEN'S BEATING HEART & RISING EMBERS
      // =======================================================================
      const ddGroup = new THREE.Group();
      ddGroup.position.set(0, 0, -10);

      // --- The Arisen's Heart (always visible, centered, lub-dub heartbeat) ---
      const heartGroup = new THREE.Group();
      heartGroup.position.set(0, 0.05, 0);

      const heartBody = new THREE.Group();
      heartBody.rotation.z = 0.1;
      heartGroup.add(heartBody);

      // Anatomical silhouette: asymmetric atria, bulging ventricles,
      // apex pointing down-left (no Valentine lobes, no vessels).
      const heartShape = new THREE.Shape();
      heartShape.moveTo(-0.52, -1.22);
      heartShape.bezierCurveTo(-1.02, -0.95, -1.14, -0.45, -1.05, -0.08);
      heartShape.bezierCurveTo(-0.99, 0.25, -0.82, 0.62, -0.66, 0.86);
      heartShape.bezierCurveTo(-0.55, 1.0, -0.38, 1.1, -0.22, 1.08);
      heartShape.bezierCurveTo(-0.08, 1.04, -0.02, 0.94, 0.02, 0.92);
      heartShape.bezierCurveTo(0.14, 1.02, 0.26, 1.14, 0.42, 1.12);
      heartShape.bezierCurveTo(0.68, 1.04, 0.88, 0.86, 0.96, 0.6);
      heartShape.bezierCurveTo(1.06, 0.28, 1.04, -0.05, 0.94, -0.3);
      heartShape.bezierCurveTo(0.82, -0.6, 0.6, -0.85, 0.28, -1.0);
      heartShape.bezierCurveTo(0.02, -1.1, -0.26, -1.16, -0.52, -1.22);

      const heartGeo = new THREE.ExtrudeGeometry(heartShape, {
        depth: 0.36,
        bevelEnabled: true,
        bevelThickness: 0.07,
        bevelSize: 0.05,
        bevelSegments: 5,
        curveSegments: 24,
      });
      heartGeo.translate(0.04, 0.04, -0.18);

      const heartMat = new THREE.MeshBasicMaterial({
        color: 0xc4160f,
        side: THREE.DoubleSide,
      });
      const heartMesh = new THREE.Mesh(heartGeo, heartMat);
      heartBody.add(heartMesh);

      // Brighter molten inner layer (glowing through the muscle)
      const innerHeartGeo = heartGeo.clone();
      innerHeartGeo.scale(0.74, 0.74, 0.74);
      innerHeartGeo.translate(0, 0.02, 0.09);
      const innerHeartMat = new THREE.MeshBasicMaterial({
        color: 0xe8482a,
        side: THREE.DoubleSide,
      });
      const innerHeart = new THREE.Mesh(innerHeartGeo, innerHeartMat);
      heartBody.add(innerHeart);

      // Surface grooves hugging the front face (sulci, flattened ribbons)
      const grooveMat = new THREE.MeshBasicMaterial({ color: 0x6e0f13 });
      const makeGroove = (pts: number[][], r: number) => {
        const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
        const tubeGeo = new THREE.TubeGeometry(curve, 14, r, 6, false);
        const tube = new THREE.Mesh(tubeGeo, grooveMat);
        tube.scale.set(1, 1, 0.16);
        heartBody.add(tube);
      };
      makeGroove(
        [[0.28, 0.5, 0.2], [0.12, 0.15, 0.2], [-0.1, -0.35, 0.2], [-0.32, -0.8, 0.2], [-0.48, -1.12, 0.2]],
        0.045,
      );
      makeGroove(
        [[-0.72, 0.62, 0.2], [-0.42, 0.4, 0.2], [0.0, 0.36, 0.2], [0.42, 0.44, 0.2], [0.75, 0.66, 0.2]],
        0.04,
      );

      // White-hot beating core sprite
      const coreMat = new THREE.SpriteMaterial({
        map: makeGlowTexture("rgba(255,240,210,1)", "rgba(255,170,90,0.6)", "rgba(255,90,30,0)"),
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const coreGlow = makeSprite(coreMat, 0, 0.15, 0.32, 1.05, 1.05);
      ddHeartCoreRef = coreGlow;
      heartGroup.add(coreGlow);

      // Wide molten halo behind the heart
      const haloMat = new THREE.SpriteMaterial({
        map: makeGlowTexture("rgba(255,190,120,0.95)", "rgba(255,90,40,0.5)", "rgba(255,60,20,0)"),
        transparent: true,
        opacity: 0.32,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const halo = makeSprite(haloMat, 0, 0.15, -0.4, 3.6, 3.6);
      ddHeartGlowRef = halo;
      heartGroup.add(halo);

      ddHeartGroupRef = heartGroup;
      ddGroup.add(heartGroup);

      // --- Dragon's Dogma Ouroboros Dragon Ring (Iconic Dragon Framing the Heart) ---
      const dragonRingGroup = new THREE.Group();
      dragonRingGroup.position.set(0, 0.05, -0.6);

      // Curved circular dragon body (Ouroboros ring)
      const ringGeo = new THREE.TorusGeometry(2.5, 0.12, 16, 64);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xef4444,
        wireframe: true,
        transparent: true,
        opacity: 0.85,
      });
      const ringSolidMat = new THREE.MeshBasicMaterial({
        color: 0x991b1b,
        transparent: true,
        opacity: 0.45,
      });
      dragonRingGroup.add(new THREE.Mesh(ringGeo, ringMat));
      dragonRingGroup.add(new THREE.Mesh(ringGeo, ringSolidMat));

      // Dragon scales / wyrm dorsal spikes along the Ouroboros ring
      for (let i = 0; i < 20; i++) {
        const ang = (i * Math.PI) / 10;
        const spikeGeo = new THREE.ConeGeometry(0.09, 0.45, 4);
        const spikeMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b, wireframe: true, transparent: true, opacity: 0.85 });
        const spike = new THREE.Mesh(spikeGeo, spikeMat);
        spike.position.set(Math.cos(ang) * 2.65, Math.sin(ang) * 2.65, 0);
        spike.rotation.z = ang - Math.PI / 2;
        dragonRingGroup.add(spike);
      }

      // Dragon Head on top-right of the ring
      const dHeadGeo = new THREE.ConeGeometry(0.35, 1.1, 5);
      dHeadGeo.rotateZ(-Math.PI / 3.5);
      const dHeadMat = new THREE.MeshBasicMaterial({ color: 0xef4444, wireframe: true, transparent: true, opacity: 0.95 });
      const dHead = new THREE.Mesh(dHeadGeo, dHeadMat);
      dHead.position.set(1.6, 1.9, 0.1);
      dragonRingGroup.add(dHead);

      // Crown Horns on the dragon head
      [-1, 1].forEach((side) => {
        const hGeo = new THREE.ConeGeometry(0.08, 0.85, 4);
        const hMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b, wireframe: true, transparent: true, opacity: 0.9 });
        const horn = new THREE.Mesh(hGeo, hMat);
        horn.position.set(1.6 + side * 0.22, 2.4, 0.1);
        horn.rotation.z = side * 0.35;
        dragonRingGroup.add(horn);
      });

      // Spreading Dragon Wings Framing Upper Arc
      [-1, 1].forEach((side) => {
        const wingCurve = [
          new THREE.Vector3(side * 1.0, 1.5, 0),
          new THREE.Vector3(side * 2.4, 2.6, 0.1),
          new THREE.Vector3(side * 3.8, 2.9, 0.2),
          new THREE.Vector3(side * 4.6, 2.2, 0.1),
        ];
        const wingGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(wingCurve), 14, 0.08, 6, false);
        const wingMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b, wireframe: true, transparent: true, opacity: 0.8 });
        dragonRingGroup.add(new THREE.Mesh(wingGeo, wingMat));
      });

      ddDragonRingRef = dragonRingGroup;
      ddGroup.add(dragonRingGroup);

      // --- Arisen's Sealing Rings (arcane gold rings behind the heart) ---
      const sealMat = new THREE.MeshBasicMaterial({
        color: 0xf59e0b,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
      });
      const sealGeo = new THREE.TorusGeometry(3.2, 0.02, 8, 72);
      const seal = new THREE.Mesh(sealGeo, sealMat);
      seal.position.set(0, 0.05, -1.0);
      seal.rotation.x = Math.PI / 2.6;
      ddSealRef = seal;
      ddGroup.add(seal);

      const seal2Mat = new THREE.MeshBasicMaterial({
        color: 0xef4444,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
      });
      const seal2Geo = new THREE.TorusGeometry(3.9, 0.015, 8, 72);
      const seal2 = new THREE.Mesh(seal2Geo, seal2Mat);
      seal2.position.set(0, 0.05, -1.15);
      seal2.rotation.x = Math.PI / 2.3;
      ddGroup.add(seal2);

      // --- Rising Molten Embers covering the WHOLE IDE (five depth layers) ---
      ddEmberSystemsRef = [];
      const emberTexture = makeSoftDotTexture("rgba(255,255,235,1)", "rgba(255,170,80,0.85)");
      const emberLayers = [
        { count: 620, size: 0.055, colors: [0xffb066, 0xff7a2a], min: 0.0035, max: 0.009, spread: 19.0, yMin: -9.5, yMax: 13.5, zMin: -3.5, zMax: 1.5, opacity: 0.55, flicker: 2.3 },
        { count: 430, size: 0.1, colors: [0xff8c42, 0xff5a1f], min: 0.0045, max: 0.011, spread: 18.0, yMin: -9.5, yMax: 13.5, zMin: -3.0, zMax: 2.0, opacity: 0.8, flicker: 1.7 },
        { count: 240, size: 0.19, colors: [0xff6b2a, 0xffb84d], min: 0.008, max: 0.017, spread: 16.5, yMin: -9.5, yMax: 13.5, zMin: -2.5, zMax: 2.5, opacity: 0.9, flicker: 1.3 },
        { count: 110, size: 0.34, colors: [0xffa04d, 0xffd066], min: 0.012, max: 0.024, spread: 14.5, yMin: -9.5, yMax: 13.5, zMin: -2.0, zMax: 2.8, opacity: 0.85, flicker: 1.0 },
        { count: 380, size: 0.04, colors: [0xffe0a0, 0xffc46b], min: 0.02, max: 0.035, spread: 17.0, yMin: -9.5, yMax: 13.5, zMin: -3.0, zMax: 2.0, opacity: 0.65, flicker: 3.1 },
      ];
      for (const layer of emberLayers) {
        const geo = new THREE.BufferGeometry();
        const pos = new Float32Array(layer.count * 3);
        const col = new Float32Array(layer.count * 3);
        const speeds = new Float32Array(layer.count);
        const cA = new THREE.Color(layer.colors[0]);
        const cB = new THREE.Color(layer.colors[1]);
        for (let i = 0; i < layer.count; i++) {
          pos[i * 3] = (Math.random() - 0.5) * layer.spread;
          pos[i * 3 + 1] = layer.yMin + Math.random() * (layer.yMax - layer.yMin);
          pos[i * 3 + 2] = layer.zMin + Math.random() * (layer.zMax - layer.zMin);
          const c = Math.random() > 0.5 ? cA : cB;
          col[i * 3] = c.r;
          col[i * 3 + 1] = c.g;
          col[i * 3 + 2] = c.b;
          speeds[i] = layer.min + Math.random() * (layer.max - layer.min);
        }
        geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
        const mat = new THREE.PointsMaterial({
          size: layer.size,
          map: emberTexture,
          vertexColors: true,
          transparent: true,
          opacity: layer.opacity,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        ddGroup.add(new THREE.Points(geo, mat));
        ddEmberSystemsRef.push({
          positions: pos,
          speeds,
          geo,
          count: layer.count,
          floor: layer.yMin,
          ceiling: layer.yMax,
          spread: layer.spread,
          mat,
          baseOpacity: layer.opacity,
          flickerFreq: layer.flicker,
          flickerPhase: Math.random() * Math.PI * 2,
        });
      }

      // --- Drifting Cinder Smoke Wisps ---
      ddSmokeRefs = [];
      const smokeTexture = makeSoftSpriteTexture("rgba(112,78,58,0.85)", "rgba(86,58,42,0.5)");
      for (let i = 0; i < 6; i++) {
        const smokeMat = new THREE.SpriteMaterial({
          map: smokeTexture,
          transparent: true,
          opacity: 0.05 + Math.random() * 0.05,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const sc = 2.4 + Math.random() * 2.6;
        const smoke = makeSprite(
          smokeMat,
          (Math.random() - 0.5) * 12,
          -4.5 + Math.random() * 7.5,
          (Math.random() - 0.5) * 2.0,
          sc,
          sc * 0.6,
        );
        ddGroup.add(smoke);
        ddSmokeRefs.push({
          sprite: smoke,
          speed: 0.06 + Math.random() * 0.12,
          baseX: smoke.position.x,
          phase: Math.random() * Math.PI * 2,
          opacity: smokeMat.opacity,
        });
      }

      // --- Smoldering ground glow ---
      const floorGlowMat = new THREE.SpriteMaterial({
        map: makeGlowTexture("rgba(255,130,45,0.85)", "rgba(255,70,30,0.4)", "rgba(255,40,20,0)"),
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const floorGlow = makeSprite(floorGlowMat, 0, -3.5, -0.2, 11.5, 3.8);
      ddFloorGlowRef = floorGlow;
      ddGroup.add(floorGlow);

      group.add(ddGroup);
    }

    // Animation Loop
    let clock = new THREE.Clock();
    const renderThree = () => {
      if (isDisposed) return;
      animId = requestAnimationFrame(renderThree);
      if (!isVisible) return;

      const elapsed = clock.getElapsedTime();

      // Cyberpunk flying AVs and Samurai Oni Mask subtle breathing
      if (currentTheme === "cyberpunk") {
        if (samuraiMaskRef) {
          samuraiMaskRef.rotation.y = Math.sin(elapsed * 0.8) * 0.12 + mouseX * 0.1;
          samuraiMaskRef.rotation.x = Math.cos(elapsed * 0.6) * 0.08 + mouseY * 0.08;
          samuraiMaskRef.position.y = 0.4 + Math.sin(elapsed * 1.5) * 0.06;
        }

        if (avPositionsRef && avGeoRef) {
          for (let i = 0; i < avPositionsRef.length / 3; i++) {
            avPositionsRef[i * 3] += 0.08 + (i % 5) * 0.02;
            if (avPositionsRef[i * 3] > 16) {
              avPositionsRef[i * 3] = -16;
            }
          }
          avGeoRef.attributes.position.needsUpdate = true;
        }
      }

      // Skyrim night: Skyrim Akatosh Dragon Crest breathing, twinkling stars, falling frost & mist banks
      if (currentTheme === "skyrim") {
        if (skyrimLogoRef) {
          skyrimLogoRef.rotation.y = Math.sin(elapsed * 0.4) * 0.08 + mouseX * 0.06;
          skyrimLogoRef.rotation.x = Math.cos(elapsed * 0.3) * 0.04 + mouseY * 0.04;
          skyrimLogoRef.position.y = 2.0 + Math.sin(elapsed * 0.6) * 0.08;
        }

        for (const s of skyStarRefs) {
          s.mat.opacity = s.baseOpacity * (0.65 + 0.35 * (0.5 + 0.5 * Math.sin(elapsed * s.freq + s.phase)));
        }

        for (const w of skyMistRefs) {
          w.sprite.position.x += w.speed;
          if (w.sprite.position.x > 14) w.sprite.position.x = -14;
          if (w.sprite.position.x < -14) w.sprite.position.x = 14;
          w.sprite.position.y = w.baseY + Math.sin(elapsed * 0.25 + w.phase) * 0.4;
          (w.sprite.material as THREE.SpriteMaterial).opacity =
            w.opacity * (0.75 + 0.25 * Math.sin(elapsed * 0.8 + w.phase));
        }

        for (const sys of skyFrostRefs) {
          for (let i = 0; i < sys.count; i++) {
            sys.positions[i * 3 + 1] -= sys.speeds[i];
            sys.positions[i * 3] += Math.sin(elapsed * 0.9 + sys.drift[i]) * 0.0035;
            if (sys.positions[i * 3 + 1] < sys.floor) {
              sys.positions[i * 3 + 1] = sys.ceiling;
              sys.positions[i * 3] = (Math.random() - 0.5) * 38;
            }
          }
          sys.geo.attributes.position.needsUpdate = true;
          sys.mat.opacity = sys.baseOpacity * (0.78 + 0.22 * Math.sin(elapsed * sys.freq + sys.phase));
        }

        if (frostPositionsRef && frostSpeedsRef && frostGeoRef) {
          for (let i = 0; i < frostPositionsRef.length / 3; i++) {
            frostPositionsRef[i * 3 + 1] += frostSpeedsRef[i];
            frostPositionsRef[i * 3] += Math.sin(elapsed * 0.9 + i * 0.8) * 0.003;
            if (frostPositionsRef[i * 3 + 1] > 8) {
              frostPositionsRef[i * 3 + 1] = -8;
            }
          }
          frostGeoRef.attributes.position.needsUpdate = true;
        }
      }

      // Dragon's Dogma: the Arisen's heart beating (lub-dub) amid Ouroboros dragon and rising embers
      if (currentTheme === "dragons_dogma") {
        const t = elapsed % 1.3;
        const lub = Math.exp(-Math.pow(t / 0.1, 2));
        const dub = Math.exp(-Math.pow((t - 0.24) / 0.12, 2));
        const beat = lub + dub * 0.8;

        if (ddDragonRingRef) {
          ddDragonRingRef.rotation.z = Math.sin(elapsed * 0.25) * 0.04;
          ddDragonRingRef.rotation.y = Math.sin(elapsed * 0.4) * 0.06;
          ddDragonRingRef.scale.set(1.0 + beat * 0.03, 1.0 + beat * 0.03, 1.0);
        }

        if (ddHeartGroupRef) {
          const s = 1.32 * (1 + beat * 0.13);
          ddHeartGroupRef.scale.set(s, s, s);
          ddHeartGroupRef.rotation.y = Math.sin(elapsed * 0.5) * 0.12;
          ddHeartGroupRef.rotation.z = Math.sin(elapsed * 0.7) * 0.05;
          ddHeartGroupRef.position.y = 0.05 + Math.sin(elapsed * 0.8) * 0.06;
        }

        if (ddHeartCoreRef) {
          const cs = 1.0 + beat * 0.7;
          ddHeartCoreRef.scale.set(cs, cs, 1);
          (ddHeartCoreRef.material as THREE.SpriteMaterial).opacity = 0.35 + beat * 0.55;
        }

        if (ddHeartGlowRef) {
          const gs = 3.4 + beat * 1.0;
          ddHeartGlowRef.scale.set(gs, gs, 1);
          (ddHeartGlowRef.material as THREE.SpriteMaterial).opacity = 0.2 + beat * 0.3;
        }

        if (ddSealRef) {
          ddSealRef.rotation.z = elapsed * 0.25;
          (ddSealRef.material as THREE.MeshBasicMaterial).opacity = 0.26 + beat * 0.15;
        }

        for (const sys of ddEmberSystemsRef) {
          for (let i = 0; i < sys.count; i++) {
            sys.positions[i * 3 + 1] += sys.speeds[i];
            sys.positions[i * 3] += Math.sin(elapsed * 1.2 + i * 0.53) * 0.002;
            if (sys.positions[i * 3 + 1] > sys.ceiling) {
              sys.positions[i * 3 + 1] = sys.floor;
              sys.positions[i * 3] = (Math.random() - 0.5) * sys.spread;
            }
          }
          sys.geo.attributes.position.needsUpdate = true;
          sys.mat.opacity =
            sys.baseOpacity * (0.76 + 0.24 * Math.sin(elapsed * sys.flickerFreq + sys.flickerPhase));
        }

        for (const w of ddSmokeRefs) {
          w.sprite.position.y += w.speed;
          if (w.sprite.position.y > 6.5) w.sprite.position.y = -4.5;
          w.sprite.position.x = w.baseX + Math.sin(elapsed * 0.3 + w.phase) * 0.9;
          (w.sprite.material as THREE.SpriteMaterial).opacity =
            w.opacity * (0.7 + 0.3 * Math.sin(elapsed * 1.1 + w.phase));
        }

        if (ddFloorGlowRef) {
          (ddFloorGlowRef.material as THREE.SpriteMaterial).opacity =
            0.26 + Math.sin(elapsed * 6.0) * 0.05 + beat * 0.16;
        }
      }

      // Subtle rotation and parallax
      if (currentTheme === "makora") {
        group.rotation.z = elapsed * 0.08;
        group.rotation.y = Math.sin(elapsed * 0.2) * 0.12 + mouseX * 0.08;
        group.rotation.x = Math.cos(elapsed * 0.2) * 0.08 + mouseY * 0.06;
      } else if (currentTheme === "dragons_dogma") {
        group.rotation.y = Math.sin(elapsed * 0.3) * 0.03 + mouseX * 0.05;
        group.position.y = Math.sin(elapsed * 0.4) * 0.1 - mouseY * 0.15;
      } else if (currentTheme === "skyrim") {
        group.rotation.y = Math.sin(elapsed * 0.25) * 0.03 + mouseX * 0.04;
        group.position.y = Math.sin(elapsed * 0.45) * 0.08 - mouseY * 0.12;
      } else {
        group.rotation.y = elapsed * 0.04 + mouseX * 0.08;
      }
      if (currentTheme !== "dragons_dogma" && currentTheme !== "skyrim") {
        group.position.x = mouseX * 0.3;
        group.position.y = -mouseY * 0.2;
      }

      renderer.render(scene, camera);
    };

    renderThree();

    return () => {
      isDisposed = true;
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("visibilitychange", onVisibilityChange);

      // Deep Three.js cleanup
      scene.traverse((obj) => {
        if (
          obj instanceof THREE.Mesh ||
          obj instanceof THREE.Points ||
          obj instanceof THREE.LineSegments ||
          obj instanceof THREE.Sprite
        ) {
          obj.geometry?.dispose();
          const disposeMaterial = (m: THREE.Material | THREE.Material[] | undefined) => {
            if (!m) return;
            if (Array.isArray(m)) {
              m.forEach((x) => x.dispose());
            } else {
              const mat = m as THREE.MeshBasicMaterial & THREE.SpriteMaterial;
              mat.map?.dispose();
              m.dispose();
            }
          };
          disposeMaterial(obj.material as THREE.Material | THREE.Material[] | undefined);
        }
      });
      renderer.dispose();

      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [currentTheme]);

  if (
    currentTheme !== "cyberpunk" &&
    currentTheme !== "matrix" &&
    currentTheme !== "outrun" &&
    currentTheme !== "makora" &&
    currentTheme !== "skyrim" &&
    currentTheme !== "dragons_dogma"
  ) {
    return null;
  }

  return <div ref={containerRef} className="ambient-3d-backdrop" aria-hidden="true" />;
}
