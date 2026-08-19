import { useEffect, useRef } from "react";
import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import type { ThemeId } from "../types";

const SKYRIM_SVG_DATA = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 724 1024"><path d="M 311.0 63.5 L 313.5 66.0 L 314.5 70.0 L 314.5 84.0 L 316.5 100.0 L 326.5 118.0 L 329.5 128.0 L 328.0 128.5 L 320.0 120.5 L 314.0 117.5 L 311.0 117.5 L 307.5 121.0 L 304.5 127.0 L 290.5 173.0 L 269.5 259.0 L 262.5 295.0 L 262.5 310.0 L 266.5 317.0 L 285.5 338.0 L 288.5 343.0 L 291.5 354.0 L 277.0 341.5 L 270.0 337.5 L 259.0 335.5 L 247.5 339.0 L 233.5 415.0 L 233.5 434.0 L 236.5 440.0 L 245.0 446.5 L 260.0 449.5 L 274.0 448.5 L 285.0 445.5 L 290.5 440.0 L 291.5 433.0 L 286.5 424.0 L 272.5 411.0 L 284.0 411.5 L 296.0 417.5 L 310.5 431.0 L 319.5 446.0 L 324.0 458.5 L 323.5 444.0 L 320.5 433.0 L 315.5 422.0 L 319.0 422.5 L 327.0 428.5 L 339.5 442.0 L 339.5 438.0 L 326.5 401.0 L 324.5 391.0 L 324.5 367.0 L 330.5 353.0 L 344.0 338.5 L 350.0 334.5 L 364.0 327.5 L 384.0 320.5 L 401.0 311.5 L 408.5 305.0 L 416.5 294.0 L 417.5 279.0 L 415.5 272.0 L 411.5 266.0 L 399.0 255.5 L 379.0 248.5 L 367.0 248.5 L 359.0 250.5 L 344.0 259.5 L 331.5 273.0 L 325.0 289.5 L 318.5 283.0 L 315.5 273.0 L 315.5 267.0 L 323.5 255.0 L 325.5 234.0 L 337.5 209.0 L 337.5 182.0 L 336.5 181.0 L 337.5 168.0 L 346.0 153.5 L 347.5 154.0 L 345.5 164.0 L 346.5 177.0 L 353.5 197.0 L 360.0 207.5 L 369.0 209.5 L 396.0 208.5 L 410.0 203.5 L 415.5 198.0 L 414.5 203.0 L 407.0 210.5 L 387.0 223.5 L 382.5 228.0 L 381.5 233.0 L 387.0 236.5 L 398.0 239.5 L 413.0 247.5 L 422.5 256.0 L 427.5 263.0 L 431.5 272.0 L 431.5 297.0 L 427.5 307.0 L 421.5 316.0 L 415.0 322.5 L 405.0 329.5 L 367.0 350.5 L 359.5 358.0 L 356.5 366.0 L 357.5 379.0 L 363.5 390.0 L 389.5 426.0 L 395.5 438.0 L 401.5 459.0 L 403.5 457.0 L 405.5 449.0 L 410.5 440.0 L 423.0 426.5 L 431.0 421.5 L 432.5 422.0 L 424.5 443.0 L 424.0 457.5 L 431.5 439.0 L 438.5 429.0 L 454.0 415.5 L 468.0 410.5 L 475.5 411.0 L 459.5 426.0 L 457.5 430.0 L 456.5 439.0 L 461.0 444.5 L 475.0 448.5 L 498.0 448.5 L 505.0 445.5 L 512.5 437.0 L 514.5 432.0 L 514.5 416.0 L 500.5 339.0 L 491.0 335.5 L 484.0 335.5 L 478.0 337.5 L 470.0 342.5 L 456.5 354.0 L 458.5 345.0 L 464.5 335.0 L 483.5 314.0 L 485.5 309.0 L 485.5 296.0 L 477.5 255.0 L 462.5 193.0 L 449.5 145.0 L 442.5 125.0 L 437.0 117.5 L 433.0 117.5 L 427.0 120.5 L 418.5 129.0 L 420.5 120.0 L 431.5 101.0 L 433.5 71.0 L 436.0 63.5 L 437.5 64.0 L 446.5 82.0 L 609.5 437.0 L 440.0 805.5 L 438.5 790.0 L 438.5 667.0 L 452.0 661.5 L 464.0 652.5 L 477.5 637.0 L 487.5 620.0 L 480.5 578.0 L 478.5 536.0 L 477.0 535.5 L 464.0 542.5 L 449.5 555.0 L 440.5 570.0 L 435.0 588.5 L 432.5 583.0 L 431.5 574.0 L 432.0 546.5 L 426.0 549.5 L 412.5 563.0 L 406.5 574.0 L 403.5 588.0 L 404.5 618.0 L 407.5 641.0 L 406.5 664.0 L 399.5 681.0 L 371.5 724.0 L 360.5 745.0 L 360.5 754.0 L 369.5 786.0 L 370.5 797.0 L 339.5 846.0 L 339.5 853.0 L 347.5 868.0 L 356.0 876.5 L 362.0 879.5 L 387.0 878.5 L 395.0 875.5 L 413.0 861.5 L 414.5 862.0 L 376.5 947.0 L 372.0 953.5 L 365.5 942.0 L 335.5 876.0 L 325.5 850.0 L 325.5 841.0 L 327.5 837.0 L 348.5 806.0 L 353.5 796.0 L 353.5 789.0 L 351.5 783.0 L 339.5 755.0 L 338.5 742.0 L 351.5 715.0 L 373.5 675.0 L 376.5 664.0 L 376.5 650.0 L 374.5 634.0 L 368.5 608.0 L 361.5 587.0 L 353.5 574.0 L 343.0 562.5 L 331.0 553.5 L 316.0 546.5 L 315.5 581.0 L 314.5 587.0 L 313.0 588.5 L 307.5 570.0 L 298.5 555.0 L 284.0 542.5 L 269.5 536.0 L 267.5 576.0 L 261.5 614.0 L 261.5 621.0 L 267.5 633.0 L 280.0 649.5 L 296.0 661.5 L 309.5 667.0 L 309.5 782.0 L 308.5 783.0 L 308.0 805.5 L 138.5 438.0 L 141.5 429.0 L 258.5 177.0 L 297.5 90.0 L 311.0 63.5 Z"/></svg>`;

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
    let skyrimLogoRef: THREE.Group | null = null;
    let skyrimLightRef: THREE.PointLight | null = null;
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
    let skyMistRefs: Array<{ sprite: THREE.Sprite; speed: number; baseY: number; phase: number; opacity: number }> = [];
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
      // 3. SKYRIM: OFFICIAL AKATOSH IMPERIAL DRAGON SVG EXTRUSION & NORDIC FROST
      // =======================================================================
      const skyrimGroup = new THREE.Group();
      skyrimGroup.position.set(0, 0, -10);

      // --- Deep Midnight Sky Gradient Backdrop (Darker cold atmospheric void) ---
      const nightMat = new THREE.MeshBasicMaterial({
        map: makeVerticalGradientTexture([
          [0, "#000103"],
          [0.35, "#010206"],
          [0.7, "#02040c"],
          [1, "#040814"],
        ]),
        transparent: true,
        opacity: 0.99,
        depthWrite: false,
      });
      const nightGeo = new THREE.PlaneGeometry(90, 60);
      const night = new THREE.Mesh(nightGeo, nightMat);
      night.position.set(0, 2, -9);
      skyrimGroup.add(night);

      // --- Ambient and Point Lights for Metallic Standard Material Reflections ---
      const skyrimAmbLight = new THREE.AmbientLight(0x182436, 1.4);
      skyrimGroup.add(skyrimAmbLight);

      const wingTipLight1 = new THREE.PointLight(0xffffff, 3.8, 35);
      wingTipLight1.position.set(3.2, 4.5, 4.0);
      skyrimLightRef = wingTipLight1;
      skyrimGroup.add(wingTipLight1);

      const wingTipLight2 = new THREE.PointLight(0x7dd3fc, 2.8, 30);
      wingTipLight2.position.set(-3.5, -2.0, 3.5);
      skyrimGroup.add(wingTipLight2);

      // --- Central Skyrim Imperial Dragon Crest (Seal of Akatosh from Official Vector SVG) ---
      const skyrimLogo = new THREE.Group();
      skyrimLogo.position.set(0, 2.0, 0);

      // Parse the official Skyrim Seal of Akatosh SVG vector
      const loader = new SVGLoader();
      const svgData = loader.parse(SKYRIM_SVG_DATA);
      const shapes: THREE.Shape[] = [];
      for (const path of svgData.paths) {
        const s = SVGLoader.createShapes(path);
        shapes.push(...s);
      }

      // Extrude with user-specified parameters
      const extrudeGeo = new THREE.ExtrudeGeometry(shapes, {
        depth: 12,
        bevelEnabled: true,
        bevelThickness: 2,
        bevelSize: 1.5,
        bevelSegments: 3,
      });
      extrudeGeo.center();

      // Dragon Material: MeshStandardMaterial with metallic Nordic frost reflections
      const dragonMat = new THREE.MeshStandardMaterial({
        color: 0xd0e0f0,
        metalness: 0.85,
        roughness: 0.25,
        emissive: 0x1a3045,
        emissiveIntensity: 0.45,
        side: THREE.DoubleSide,
      });

      const dragonMesh = new THREE.Mesh(extrudeGeo, dragonMat);
      // Scale and invert SVG Y axis so it points upright and fits viewport
      dragonMesh.scale.set(0.0085, -0.0085, 0.0085);
      skyrimLogo.add(dragonMesh);

      skyrimLogoRef = skyrimLogo;
      skyrimGroup.add(skyrimLogo);

      // --- Drifting Frost Mist Banks (subtle realistic atmospheric fog) ---
      skyMistRefs = [];
      const mistTexture = makeSoftSpriteTexture("rgba(180,215,245,0.35)", "rgba(100,150,210,0.12)");
      for (let i = 0; i < 5; i++) {
        const mistMat = new THREE.SpriteMaterial({
          map: mistTexture,
          transparent: true,
          opacity: 0.025 + Math.random() * 0.03,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const sc = 5.0 + Math.random() * 5.0;
        const mist = makeSprite(
          mistMat,
          (Math.random() - 0.5) * 26,
          -3.5 + Math.random() * 6.0,
          -1.5 + Math.random() * 2.5,
          sc,
          sc * 0.45,
        );
        skyrimGroup.add(mist);
        skyMistRefs.push({
          sprite: mist,
          speed: (Math.random() > 0.5 ? 1 : -1) * (0.015 + Math.random() * 0.03),
          baseY: mist.position.y,
          phase: Math.random() * Math.PI * 2,
          opacity: mistMat.opacity,
        });
      }

      // --- Organic Falling Frost & Snow Flakes (Realistic soft drifting atmospheric frost) ---
      skyFrostRefs = [];
      const realisticFrostTexture = makeSoftDotTexture("rgba(230,245,255,0.9)", "rgba(160,205,250,0.25)");
      const frostLayers = [
        // 1. Foreground Bokeh Flakes (Soft, floating close past the camera)
        { count: 22, size: 0.9, color: 0xebf5ff, min: 0.008, max: 0.016, spread: 28, zMin: 3.5, zMax: 6.5, opacity: 0.45, freq: 1.4 },
        // 2. Mid-Foreground Soft Frost Motes
        { count: 90, size: 0.45, color: 0xd2e8ff, min: 0.006, max: 0.012, spread: 34, zMin: 0.5, zMax: 3.2, opacity: 0.55, freq: 1.8 },
        // 3. Background Depth Flakes
        { count: 180, size: 0.22, color: 0xbcd8f8, min: 0.004, max: 0.009, spread: 38, zMin: -5.0, zMax: 0.0, opacity: 0.48, freq: 1.2 },
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
          map: realisticFrostTexture,
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

      // Skyrim night: Skyrim Akatosh Dragon Crest breathing, metallic light glints, realistic frost & mist
      if (currentTheme === "skyrim") {
        if (skyrimLogoRef) {
          skyrimLogoRef.rotation.y = Math.sin(elapsed * 0.35) * 0.12 + mouseX * 0.08;
          skyrimLogoRef.rotation.x = Math.cos(elapsed * 0.25) * 0.04 + mouseY * 0.04;
          skyrimLogoRef.position.y = 2.0 + Math.sin(elapsed * 0.5) * 0.06;
        }

        if (skyrimLightRef) {
          skyrimLightRef.position.x = 2.8 + Math.sin(elapsed * 0.7) * 1.6;
          skyrimLightRef.position.y = 3.8 + Math.cos(elapsed * 0.5) * 1.0;
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
              sys.positions[i * 3] = (Math.random() - 0.5) * 36;
            }
          }
          sys.geo.attributes.position.needsUpdate = true;
          sys.mat.opacity = sys.baseOpacity * (0.78 + 0.22 * Math.sin(elapsed * sys.freq + sys.phase));
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
