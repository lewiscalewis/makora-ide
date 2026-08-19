import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { ThemeId } from "../types";

interface AmbientCanvasProps {
  currentTheme: ThemeId;
}

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
      if (!ctx) return;

      const resize = () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
      };
      resize();
      window.addEventListener("resize", resize);

      const chars = "ｦｱｳｴｵｶｷｹｺｻｼｽｾｿﾀﾂﾃﾅﾆﾇﾈﾊﾋﾎﾏﾐﾑﾒﾓﾔﾕﾗﾘﾜ10234567890ABCDEF$#%&*+-=<>";
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
    let auroraPositionsRef: Float32Array | null = null;
    let auroraGeoRef: THREE.BufferGeometry | null = null;
    let snowPositionsRef: Float32Array | null = null;
    let snowGeoRef: THREE.BufferGeometry | null = null;
    let emberPositionsRef: Float32Array | null = null;
    let emberGeoRef: THREE.BufferGeometry | null = null;
    let riftRing1Ref: THREE.Mesh | null = null;
    let riftRing2Ref: THREE.Mesh | null = null;
    let grigoriHeadRef: THREE.Group | null = null;
    let grigoriHeartRef: THREE.Mesh | null = null;
    let dovahkiinRef: THREE.Group | null = null;
    let shoutRingsRef: THREE.Mesh[] = [];
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
      // 3. SKYRIM: DOVAHKIIN HORNED HELMET, THU'UM SHOCKWAVES & AURORAS
      // =======================================================================
      const skyrimGroup = new THREE.Group();
      skyrimGroup.position.set(0, 0, -10);

      const steelWire = new THREE.MeshBasicMaterial({ color: 0x38bdf8, wireframe: true, transparent: true, opacity: 0.85 });
      const darkSteel = new THREE.MeshBasicMaterial({ color: 0x0284c7, wireframe: true, transparent: true, opacity: 0.65 });
      const goldHorn = new THREE.MeshBasicMaterial({ color: 0xfacc15, wireframe: true, transparent: true, opacity: 0.85 });
      const cyanEye = new THREE.MeshBasicMaterial({ color: 0x7dd3fc });

      // --- 3D Dovahkiin Horned Helmet ---
      const helmetGroup = new THREE.Group();
      helmetGroup.position.set(-2.6, 0.3, 1.5);
      helmetGroup.scale.set(1.0, 1.0, 1.0);

      // Dome
      const domeGeo = new THREE.SphereGeometry(1.0, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2);
      const dome = new THREE.Mesh(domeGeo, steelWire);
      helmetGroup.add(dome);

      // Lower Cheekguard Rim
      const rimGeo = new THREE.CylinderGeometry(1.0, 1.05, 0.8, 12, 1, true);
      const rim = new THREE.Mesh(rimGeo, darkSteel);
      rim.position.y = -0.4;
      helmetGroup.add(rim);

      // Nasal Guard
      const nasalGeo = new THREE.BoxGeometry(0.2, 0.7, 0.15);
      const nasal = new THREE.Mesh(nasalGeo, steelWire);
      nasal.position.set(0, -0.35, 1.0);
      helmetGroup.add(nasal);

      // Sweeping Viking Warrior Horns
      [-1, 1].forEach((side) => {
        const hornPoints = [
          new THREE.Vector3(side * 0.9, 0.1, 0.0),
          new THREE.Vector3(side * 1.5, 0.2, -0.2),
          new THREE.Vector3(side * 2.0, 0.7, -0.3),
          new THREE.Vector3(side * 2.2, 1.4, -0.1),
          new THREE.Vector3(side * 2.0, 2.0, 0.2),
        ];
        const hornCurve = new THREE.CatmullRomCurve3(hornPoints);
        const hornGeo = new THREE.TubeGeometry(hornCurve, 12, 0.16, 6, false);
        const horn = new THREE.Mesh(hornGeo, goldHorn);
        helmetGroup.add(horn);

        // Glowing Ethereal Eye Slit
        const eyeGeo = new THREE.SphereGeometry(0.08, 6, 6);
        const eye = new THREE.Mesh(eyeGeo, cyanEye);
        eye.position.set(side * 0.35, -0.2, 0.95);
        helmetGroup.add(eye);
      });

      dovahkiinRef = helmetGroup;
      skyrimGroup.add(helmetGroup);

      // --- Dragon Shout (Thu'um) Pulsing Shockwave Rings ---
      shoutRingsRef = [];
      for (let i = 0; i < 3; i++) {
        const shoutRingGeo = new THREE.RingGeometry(1.5 + i * 0.8, 1.6 + i * 0.8, 32);
        const shoutRingMat = new THREE.MeshBasicMaterial({
          color: 0x38bdf8,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.5 - i * 0.1,
        });
        const shoutRing = new THREE.Mesh(shoutRingGeo, shoutRingMat);
        shoutRing.position.set(-2.6, 0.0, 1.0);
        shoutRingsRef.push(shoutRing);
        skyrimGroup.add(shoutRing);
      }

      // Aurora Wave Particles
      const auroraCount = 400;
      const aGeo = new THREE.BufferGeometry();
      const aPos = new Float32Array(auroraCount * 3);
      const aCol = new Float32Array(auroraCount * 3);

      const aCyan = new THREE.Color(0x38bdf8);
      const aEmerald = new THREE.Color(0x34d399);

      for (let i = 0; i < auroraCount; i++) {
        const u = (i / auroraCount) * Math.PI * 4;
        aPos[i * 3] = (i / auroraCount - 0.5) * 34;
        aPos[i * 3 + 1] = 2.4 + Math.sin(u) * 1.5;
        aPos[i * 3 + 2] = -4 + Math.cos(u * 0.5) * 3.5;

        const c = i % 2 === 0 ? aCyan : aEmerald;
        aCol[i * 3] = c.r;
        aCol[i * 3 + 1] = c.g;
        aCol[i * 3 + 2] = c.b;
      }
      aGeo.setAttribute("position", new THREE.BufferAttribute(aPos, 3));
      aGeo.setAttribute("color", new THREE.BufferAttribute(aCol, 3));
      auroraPositionsRef = aPos;
      auroraGeoRef = aGeo;

      const aMat = new THREE.PointsMaterial({
        size: 0.3,
        vertexColors: true,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
      });
      const aurora = new THREE.Points(aGeo, aMat);
      skyrimGroup.add(aurora);

      // Gentle Snowfall Particles
      const snowCount = 200;
      const snowGeo = new THREE.BufferGeometry();
      const snowPos = new Float32Array(snowCount * 3);
      for (let i = 0; i < snowCount; i++) {
        snowPos[i * 3] = (Math.random() - 0.5) * 26;
        snowPos[i * 3 + 1] = (Math.random() - 0.5) * 16;
        snowPos[i * 3 + 2] = (Math.random() - 0.5) * 16;
      }
      snowGeo.setAttribute("position", new THREE.BufferAttribute(snowPos, 3));
      snowPositionsRef = snowPos;
      snowGeoRef = snowGeo;

      const snowMat = new THREE.PointsMaterial({
        color: 0xf0f9ff,
        size: 0.1,
        transparent: true,
        opacity: 0.8,
      });
      const snowfall = new THREE.Points(snowGeo, snowMat);
      skyrimGroup.add(snowfall);

      group.add(skyrimGroup);
    } else if (currentTheme === "dragons_dogma") {
      // =======================================================================
      // 4. DRAGON'S DOGMA: GRIGORI THE GREAT DRAGON & WYRMFIRE RIFT
      // =======================================================================
      const ddGroup = new THREE.Group();
      ddGroup.position.set(0, 0, -10);

      const redWire = new THREE.MeshBasicMaterial({ color: 0xef4444, wireframe: true, transparent: true, opacity: 0.85 });
      const darkRed = new THREE.MeshBasicMaterial({ color: 0x991b1b, wireframe: true, transparent: true, opacity: 0.65 });
      const goldHornMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b, wireframe: true, transparent: true, opacity: 0.9 });
      const eyeRed = new THREE.MeshBasicMaterial({ color: 0xff0033 });

      // --- 3D Grigori Dragon Head ---
      const dragonHead = new THREE.Group();
      dragonHead.position.set(2.4, 0.2, 1.2);
      dragonHead.scale.set(1.05, 1.05, 1.05);

      // Snout / Upper Jaw
      const snoutGeo = new THREE.CylinderGeometry(0.35, 0.75, 2.2, 6);
      snoutGeo.rotateX(Math.PI / 2);
      const snout = new THREE.Mesh(snoutGeo, redWire);
      snout.position.set(0, 0, 1.1);
      dragonHead.add(snout);

      // Skull Cranium
      const skullGeo = new THREE.DodecahedronGeometry(1.0, 1);
      const skull = new THREE.Mesh(skullGeo, redWire);
      skull.scale.set(1.1, 0.9, 1.4);
      skull.position.set(0, 0.2, -0.4);
      dragonHead.add(skull);

      // Lower Jaw
      const jawGeo = new THREE.ConeGeometry(0.5, 1.8, 5);
      jawGeo.rotateX(-Math.PI / 2);
      const jaw = new THREE.Mesh(jawGeo, darkRed);
      jaw.position.set(0, -0.45, 0.8);
      dragonHead.add(jaw);

      // Dragon Crown Horns & Glowing Crimson Eyes
      [-1, 1].forEach((side) => {
        // Main sweeping horn
        const curvePoints = [
          new THREE.Vector3(side * 0.6, 0.6, -0.6),
          new THREE.Vector3(side * 1.3, 1.4, -1.2),
          new THREE.Vector3(side * 1.9, 2.2, -1.8),
          new THREE.Vector3(side * 2.3, 2.8, -2.4),
        ];
        const hornCurve = new THREE.CatmullRomCurve3(curvePoints);
        const hornGeo = new THREE.TubeGeometry(hornCurve, 12, 0.14, 6, false);
        const horn = new THREE.Mesh(hornGeo, goldHornMat);
        dragonHead.add(horn);

        // Secondary crest horn
        const crestCurve = [
          new THREE.Vector3(side * 0.35, 0.8, -0.2),
          new THREE.Vector3(side * 0.7, 1.5, -0.7),
          new THREE.Vector3(side * 1.0, 2.0, -1.1),
        ];
        const crestGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(crestCurve), 8, 0.09, 5, false);
        const crest = new THREE.Mesh(crestGeo, redWire);
        dragonHead.add(crest);

        // Glowing red eye
        const eyeGeo = new THREE.SphereGeometry(0.14, 8, 8);
        const eye = new THREE.Mesh(eyeGeo, eyeRed);
        eye.position.set(side * 0.55, 0.35, 0.5);
        dragonHead.add(eye);
      });

      // Dragon's Molten Throat Heart Core
      const heartGeo = new THREE.OctahedronGeometry(0.45, 0);
      const heartMat = new THREE.MeshBasicMaterial({ color: 0xff3b30, wireframe: true, transparent: true, opacity: 0.95 });
      const heart = new THREE.Mesh(heartGeo, heartMat);
      heart.position.set(0, -0.1, 0.1);
      grigoriHeartRef = heart;
      dragonHead.add(heart);

      grigoriHeadRef = dragonHead;
      ddGroup.add(dragonHead);

      // --- The Rift Stone Monolith (In Background) ---
      const riftMat = new THREE.MeshBasicMaterial({
        color: 0x818cf8,
        wireframe: true,
        transparent: true,
        opacity: 0.6,
      });
      const pillarGeo = new THREE.CylinderGeometry(0.7, 1.1, 5.0, 6);
      const pillar = new THREE.Mesh(pillarGeo, riftMat);
      pillar.position.set(-2.0, 0, -2.0);
      ddGroup.add(pillar);

      // Rift Energy Rings
      const riftRingGeo1 = new THREE.TorusGeometry(2.2, 0.05, 16, 32);
      const riftRingMat1 = new THREE.MeshBasicMaterial({
        color: 0x06b6d4,
        transparent: true,
        opacity: 0.8,
      });
      const riftRing1 = new THREE.Mesh(riftRingGeo1, riftRingMat1);
      riftRing1.position.set(-2.0, 0, -2.0);
      riftRing1.rotation.x = Math.PI / 3;
      riftRing1Ref = riftRing1;
      ddGroup.add(riftRing1);

      const riftRingGeo2 = new THREE.TorusGeometry(2.8, 0.04, 16, 32);
      const riftRingMat2 = new THREE.MeshBasicMaterial({
        color: 0xef4444,
        transparent: true,
        opacity: 0.7,
      });
      const riftRing2 = new THREE.Mesh(riftRingGeo2, riftRingMat2);
      riftRing2.position.set(-2.0, 0, -2.0);
      riftRing2.rotation.y = Math.PI / 4;
      riftRing2Ref = riftRing2;
      ddGroup.add(riftRing2);

      // Rising Molten Dragon Fire Embers
      const emberCount = 220;
      const emberGeo = new THREE.BufferGeometry();
      const emberPos = new Float32Array(emberCount * 3);
      const emberCol = new Float32Array(emberCount * 3);

      const flameRed = new THREE.Color(0xef4444);
      const moltenGold = new THREE.Color(0xf59e0b);

      for (let i = 0; i < emberCount; i++) {
        const theta = Math.random() * Math.PI * 2;
        const r = 0.5 + Math.random() * 2.8;
        emberPos[i * 3] = Math.cos(theta) * r;
        emberPos[i * 3 + 1] = (Math.random() - 0.5) * 7.5;
        emberPos[i * 3 + 2] = Math.sin(theta) * r;

        const c = Math.random() > 0.5 ? flameRed : moltenGold;
        emberCol[i * 3] = c.r;
        emberCol[i * 3 + 1] = c.g;
        emberCol[i * 3 + 2] = c.b;
      }
      emberGeo.setAttribute("position", new THREE.BufferAttribute(emberPos, 3));
      emberGeo.setAttribute("color", new THREE.BufferAttribute(emberCol, 3));
      emberPositionsRef = emberPos;
      emberGeoRef = emberGeo;

      const emberMat = new THREE.PointsMaterial({
        size: 0.18,
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
      });
      const embers = new THREE.Points(emberGeo, emberMat);
      ddGroup.add(embers);

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

      // Skyrim Dovahkiin helmet, Thu'um shockwaves and Aurora undulation
      if (currentTheme === "skyrim") {
        if (dovahkiinRef) {
          dovahkiinRef.rotation.y = Math.sin(elapsed * 0.6) * 0.1 + mouseX * 0.08;
          dovahkiinRef.rotation.x = Math.cos(elapsed * 0.4) * 0.05 + mouseY * 0.05;
          dovahkiinRef.position.y = 0.3 + Math.sin(elapsed * 1.2) * 0.05;
        }

        // Dragon Shout shockwave rings expansion
        shoutRingsRef.forEach((ring, idx) => {
          const ringScale = ((elapsed * 0.8 + idx * 0.4) % 2.0) + 0.2;
          ring.scale.set(ringScale, ringScale, ringScale);
          (ring.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.4 - ringScale * 0.18);
        });

        if (auroraPositionsRef && auroraGeoRef) {
          const total = auroraPositionsRef.length / 3;
          for (let i = 0; i < total; i++) {
            const u = (i / total) * Math.PI * 4;
            auroraPositionsRef[i * 3 + 1] = 2.4 + Math.sin(u + elapsed * 1.2) * 1.4;
          }
          auroraGeoRef.attributes.position.needsUpdate = true;
        }

        if (snowPositionsRef && snowGeoRef) {
          for (let i = 0; i < snowPositionsRef.length / 3; i++) {
            snowPositionsRef[i * 3 + 1] -= 0.025;
            if (snowPositionsRef[i * 3 + 1] < -8) {
              snowPositionsRef[i * 3 + 1] = 8;
            }
          }
          snowGeoRef.attributes.position.needsUpdate = true;
        }
      }

      // Dragon's Dogma Grigori dragon head swaying & molten throat pulse
      if (currentTheme === "dragons_dogma") {
        if (grigoriHeadRef) {
          grigoriHeadRef.rotation.y = Math.sin(elapsed * 0.7) * 0.12 + mouseX * 0.1;
          grigoriHeadRef.rotation.x = Math.sin(elapsed * 0.9) * 0.08 + mouseY * 0.08;
          grigoriHeadRef.position.y = 0.2 + Math.sin(elapsed * 1.4) * 0.08;
        }

        if (grigoriHeartRef) {
          const pulse = 1.0 + Math.sin(elapsed * 3.5) * 0.25;
          grigoriHeartRef.scale.set(pulse, pulse, pulse);
        }

        if (riftRing1Ref) riftRing1Ref.rotation.z = elapsed * 0.3;
        if (riftRing2Ref) riftRing2Ref.rotation.z = -elapsed * 0.2;

        if (emberPositionsRef && emberGeoRef) {
          for (let i = 0; i < emberPositionsRef.length / 3; i++) {
            emberPositionsRef[i * 3 + 1] += 0.035;
            if (emberPositionsRef[i * 3 + 1] > 4.5) {
              emberPositionsRef[i * 3 + 1] = -4.5;
            }
          }
          emberGeoRef.attributes.position.needsUpdate = true;
        }
      }

      // Subtle rotation and parallax
      if (currentTheme === "makora") {
        group.rotation.z = elapsed * 0.08;
        group.rotation.y = Math.sin(elapsed * 0.2) * 0.12 + mouseX * 0.08;
        group.rotation.x = Math.cos(elapsed * 0.2) * 0.08 + mouseY * 0.06;
      } else if (currentTheme === "dragons_dogma") {
        group.rotation.y = elapsed * 0.06 + mouseX * 0.06;
        group.position.y = Math.sin(elapsed * 0.5) * 0.15 - mouseY * 0.15;
      } else if (currentTheme === "skyrim") {
        group.rotation.y = Math.sin(elapsed * 0.1) * 0.05 + mouseX * 0.05;
        group.position.x = mouseX * 0.2;
      } else {
        group.rotation.y = elapsed * 0.04 + mouseX * 0.08;
      }
      group.position.x = mouseX * 0.3;
      group.position.y = -mouseY * 0.2;

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
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Points || obj instanceof THREE.LineSegments) {
          obj.geometry?.dispose();
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => m.dispose());
          } else {
            obj.material?.dispose();
          }
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
