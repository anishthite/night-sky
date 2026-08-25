(() => {
  "use strict";

  const canvas = document.querySelector("#sky-canvas");
  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
  const sky = document.querySelector(".sky");
  const intro = document.querySelector(".intro");
  const hint = document.querySelector("#interaction-hint");
  const countLabel = document.querySelector("#meteor-count");
  const countDot = document.querySelector(".observation-dot");
  const motionToggle = document.querySelector("#motion-toggle");
  const soundToggle = document.querySelector("#sound-toggle");
  const sceneButtons = [...document.querySelectorAll("[data-scene]")];
  const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const query = new URLSearchParams(window.location.search);
  const captureMode = query.has("capture");

  const TAU = Math.PI * 2;
  const palette = [
    [211, 222, 232],
    [226, 232, 234],
    [244, 239, 222],
    [219, 228, 239],
    [238, 228, 207],
  ];
  const scenes = {
    "open-sky": {
      source: "./assets/open-sky-nps.jpg",
      // This is an astrophotograph, so keep its natural colour and exposure intact.
      // A light reduction keeps the type legible without turning the sky into a blue wash.
      filter: "brightness(0.82) saturate(0.82) contrast(0.98)",
      mobileAnchor: "center",
    },
    "distant-butte": {
      source: "./assets/distant-butte-nps.jpg",
      filter: "brightness(0.68) saturate(0.68) contrast(0.98)",
      mobileAnchor: "center",
    },
    "desert-tree": {
      source: "./assets/nocturne-sky-nasa.jpg",
      filter: "brightness(0.78) saturate(0.76) contrast(0.98)",
      mobileAnchor: "left",
    },
  };

  let width = 0;
  let height = 0;
  let dpr = 1;
  let lastFrame = performance.now();
  let nextMeteorAt = lastFrame + 18000 + Math.random() * 22000;
  let meteorCount = 0;
  let paused = reduceMotionQuery.matches;
  let pointerX = 0;
  let pointerY = 0;
  let parallaxX = 0;
  let parallaxY = 0;
  let cursorTimer = 0;
  let stars = [];
  let meteors = [];
  let satellite = null;
  let nextSatelliteAt = lastFrame + 26000 + Math.random() * 24000;
  let backgroundCanvas = document.createElement("canvas");
  let foregroundCanvas = document.createElement("canvas");
  const skyPhoto = new Image();
  let skyPhotoLoaded = false;
  let activeScene = scenes[query.get("scene")] ? query.get("scene") : "open-sky";
  let seededRandom = mulberry32(0x5a17c9);
  let soundscape = null;
  let animationRequest = 0;

  function mulberry32(seed) {
    return function random() {
      let t = (seed += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, amount) {
    return a + (b - a) * amount;
  }

  function smoothstep(edge0, edge1, value) {
    const amount = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return amount * amount * (3 - 2 * amount);
  }

  function randomBetween(min, max, random = Math.random) {
    return min + random() * (max - min);
  }

  function configureCanvas(target, context) {
    target.width = Math.round(width * dpr);
    target.height = Math.round(height * dpr);
    target.style.width = `${width}px`;
    target.style.height = `${height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function resize() {
    const bounds = sky.getBoundingClientRect();
    width = Math.max(1, bounds.width);
    height = Math.max(1, bounds.height);
    const pixelBudgetDpr = Math.sqrt(7000000 / (width * height));
    dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, width < 520 ? 1.7 : 2, pixelBudgetDpr));

    configureCanvas(canvas, ctx);
    const backgroundContext = backgroundCanvas.getContext("2d", { alpha: false });
    const foregroundContext = foregroundCanvas.getContext("2d");
    configureCanvas(backgroundCanvas, backgroundContext);
    configureCanvas(foregroundCanvas, foregroundContext);

    seededRandom = mulberry32(0x5a17c9 + Math.round(width * 7 + height * 11));
    generateStars();
    paintBackground(backgroundContext);
    paintForeground(foregroundContext);
    meteors = [];
    satellite = null;
    if (captureMode) prepareCaptureMeteors();
    draw(performance.now());
  }

  function generateStars() {
    // The base sky is an astrophotograph. Keeping its real stellar texture intact
    // is more convincing than layering another procedurally generated star field.
    if (skyPhotoLoaded) {
      stars = [];
      return;
    }

    // A dark-adapted eye catches far fewer stars than a long-exposure photograph.
    // Keeping the field sparse gives the brighter stars and meteor trails room to breathe.
    const starCount = Math.round(clamp((width * height) / 1850, 390, 790));
    stars = [];

    for (let i = 0; i < starCount; i += 1) {
      const inMilkyWay = seededRandom() < 0.23;
      let x = seededRandom();
      let y = seededRandom();

      if (inMilkyWay) {
        const t = randomBetween(-0.15, 1.15, seededRandom);
        const spread = (seededRandom() + seededRandom() - 1) * 0.13;
        x = t;
        y = 0.12 + t * 0.76 + spread;
      }

      if (x < 0 || x > 1 || y < 0 || y > 1) {
        i -= 1;
        continue;
      }

      const magnitudeRoll = Math.pow(seededRandom(), 7.2);
      const radius = 0.18 + magnitudeRoll * 1.02;
      const alpha = 0.1 + Math.pow(magnitudeRoll, 0.62) * 0.76;
      const color = palette[Math.floor(seededRandom() * palette.length)];
      stars.push({
        x,
        y,
        radius,
        alpha,
        color,
        phase: seededRandom() * TAU,
        twinkleSpeed: randomBetween(0.00022, 0.0006, seededRandom),
        twinkles: radius > 0.68 && seededRandom() < 0.2,
        depth: randomBetween(0.15, 1, seededRandom),
      });
    }
  }

  function paintBackground(context) {
    context.clearRect(0, 0, width, height);

    if (skyPhotoLoaded) {
      context.save();
      context.filter = scenes[activeScene].filter;
      drawImageCover(context, skyPhoto);
      context.restore();

      // The image carries the astronomical detail; this is only a restrained edge falloff
      // to let the interface sit in the scene without making it feel composited on top.
      const falloff = context.createRadialGradient(
        width * 0.5,
        height * 0.43,
        Math.min(width, height) * 0.16,
        width * 0.5,
        height * 0.48,
        Math.max(width, height) * 0.78,
      );
      falloff.addColorStop(0, "rgba(0, 3, 8, 0)");
      falloff.addColorStop(0.72, "rgba(0, 3, 8, 0.035)");
      falloff.addColorStop(1, "rgba(0, 2, 6, 0.2)");
      context.fillStyle = falloff;
      context.fillRect(0, 0, width, height);
      return;
    }

    const skyGradient = context.createLinearGradient(0, 0, 0, height);
    skyGradient.addColorStop(0, "#01040a");
    skyGradient.addColorStop(0.46, "#030814");
    skyGradient.addColorStop(0.78, "#06111d");
    skyGradient.addColorStop(1, "#091520");
    context.fillStyle = skyGradient;
    context.fillRect(0, 0, width, height);

    const airglow = context.createRadialGradient(
      width * 0.46,
      height * 1.08,
      0,
      width * 0.46,
      height * 1.08,
      Math.max(width, height) * 0.78,
    );
    airglow.addColorStop(0, "rgba(42, 67, 66, 0.09)");
    airglow.addColorStop(0.42, "rgba(23, 43, 50, 0.03)");
    airglow.addColorStop(1, "rgba(9, 20, 31, 0)");
    context.fillStyle = airglow;
    context.fillRect(0, height * 0.38, width, height * 0.62);

    paintMilkyWay(context);

    for (const star of stars) {
      const x = star.x * width;
      const y = star.y * height;
      const [r, g, b] = star.color;

      if (star.radius > 0.96) {
        const glow = context.createRadialGradient(x, y, 0, x, y, star.radius * 3.8);
        glow.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${star.alpha * 0.16})`);
        glow.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
        context.fillStyle = glow;
        context.beginPath();
        context.arc(x, y, star.radius * 3.8, 0, TAU);
        context.fill();
      }

      context.fillStyle = `rgba(${r}, ${g}, ${b}, ${star.alpha})`;
      context.beginPath();
      context.arc(x, y, star.radius, 0, TAU);
      context.fill();
    }
  }

  function drawImageCover(context, image) {
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    const useOpenMobileCrop = width / height < 0.75 && scenes[activeScene].mobileAnchor === "left";
    const horizontalOffset = useOpenMobileCrop ? 0 : (width - drawWidth) / 2;
    context.drawImage(image, horizontalOffset, height - drawHeight, drawWidth, drawHeight);
  }

  function paintMilkyWay(context) {
    const diagonal = Math.hypot(width, height) * 1.35;
    context.save();
    context.translate(width * 0.48, height * 0.48);
    context.rotate(-0.72);
    context.globalCompositeOperation = "screen";
    context.filter = `blur(${Math.max(22, width * 0.025)}px)`;

    const haze = context.createLinearGradient(0, -height * 0.21, 0, height * 0.21);
    haze.addColorStop(0, "rgba(95, 115, 132, 0)");
    haze.addColorStop(0.3, "rgba(95, 112, 126, 0.012)");
    haze.addColorStop(0.49, "rgba(132, 140, 140, 0.042)");
    haze.addColorStop(0.59, "rgba(112, 124, 132, 0.022)");
    haze.addColorStop(1, "rgba(89, 107, 121, 0)");
    context.fillStyle = haze;
    context.fillRect(-diagonal / 2, -height * 0.22, diagonal, height * 0.44);
    context.restore();

    // Uneven luminous puffs create the Milky Way's cloudlike stellar density.
    context.save();
    context.translate(width * 0.48, height * 0.48);
    context.rotate(-0.72);
    context.globalCompositeOperation = "screen";
    context.filter = `blur(${Math.max(4, width * 0.0045)}px)`;
    const cloudCount = Math.round(clamp(width / 16, 48, 94));
    for (let cloud = 0; cloud < cloudCount; cloud += 1) {
      const x = randomBetween(-diagonal * 0.52, diagonal * 0.52, seededRandom);
      const normal = (seededRandom() + seededRandom() + seededRandom() - 1.5) / 1.5;
      const centerRipple = Math.sin(x * 0.008) * height * 0.018;
      const y = normal * height * 0.135 + centerRipple;
      const density = Math.pow(1 - Math.min(1, Math.abs(normal)), 2.15);
      const radius = randomBetween(18, Math.max(30, width * 0.055), seededRandom);
      const warm = seededRandom() < 0.18;
      const alpha = warm
        ? randomBetween(0.004, 0.012, seededRandom) * density
        : randomBetween(0.005, 0.018, seededRandom) * density;
      context.save();
      context.translate(x, y);
      context.scale(randomBetween(0.75, 1.5, seededRandom), randomBetween(0.22, 0.5, seededRandom));
      const cloudGlow = context.createRadialGradient(0, 0, 0, 0, 0, radius);
      cloudGlow.addColorStop(0, warm ? `rgba(148, 138, 119, ${alpha})` : `rgba(119, 137, 146, ${alpha})`);
      cloudGlow.addColorStop(1, "rgba(87, 104, 118, 0)");
      context.fillStyle = cloudGlow;
      context.beginPath();
      context.arc(0, 0, radius, 0, TAU);
      context.fill();
      context.restore();
    }
    context.restore();

    context.save();
    context.translate(width * 0.48, height * 0.48);
    context.rotate(-0.72);
    context.globalCompositeOperation = "screen";
    for (let i = 0; i < Math.min(280, width * 0.22); i += 1) {
      const x = randomBetween(-diagonal / 2, diagonal / 2, seededRandom);
      const normal = (seededRandom() + seededRandom() + seededRandom() - 1.5) / 1.5;
      const y = normal * height * 0.15;
      const radius = randomBetween(0.18, 0.7, seededRandom);
      const alpha = randomBetween(0.018, 0.075, seededRandom) * (1 - Math.abs(normal) * 0.7);
      context.fillStyle = `rgba(211, 218, 216, ${alpha})`;
      context.beginPath();
      context.arc(x, y, radius, 0, TAU);
      context.fill();
    }
    context.restore();

    // Thin, broken absorption lanes keep the band irregular and naturally subdued.
    context.save();
    context.translate(width * 0.48, height * 0.48);
    context.rotate(-0.72);
    context.globalCompositeOperation = "multiply";
    context.filter = `blur(${Math.max(12, width * 0.012)}px)`;
    for (let lane = 0; lane < 8; lane += 1) {
      const x = randomBetween(-diagonal * 0.45, diagonal * 0.32, seededRandom);
      const y = randomBetween(-height * 0.035, height * 0.07, seededRandom);
      context.fillStyle = `rgba(2, 7, 15, ${randomBetween(0.12, 0.24, seededRandom)})`;
      context.beginPath();
      context.ellipse(
        x,
        y,
        randomBetween(diagonal * 0.035, diagonal * 0.11, seededRandom),
        randomBetween(height * 0.008, height * 0.022, seededRandom),
        randomBetween(-0.12, 0.12, seededRandom),
        0,
        TAU,
      );
      context.fill();
    }
    context.restore();
    context.filter = "none";
    context.globalCompositeOperation = "source-over";
  }

  function paintForeground(context) {
    context.clearRect(0, 0, width, height);

    if (skyPhotoLoaded) return;

    const horizonGlow = context.createLinearGradient(0, height * 0.72, 0, height);
    horizonGlow.addColorStop(0, "rgba(19, 36, 45, 0)");
    horizonGlow.addColorStop(0.78, "rgba(18, 32, 38, 0.15)");
    horizonGlow.addColorStop(1, "rgba(4, 9, 13, 0.36)");
    context.fillStyle = horizonGlow;
    context.fillRect(0, height * 0.7, width, height * 0.3);

    // A soft ridge behind the trees breaks the perfectly flat, game-like horizon.
    paintRidge(context, height * 0.925, "rgba(8, 19, 25, 0.54)", 0.025, 7);
    paintForestMass(context, height * 0.952, "rgba(3, 11, 16, 0.78)", 0.064, 17);
    paintForestMass(context, height * 0.984, "rgba(1, 5, 8, 0.98)", 0.105, 31);
    paintNearSpruces(context, 43);

    const earth = context.createLinearGradient(0, height * 0.91, 0, height);
    earth.addColorStop(0, "rgba(1, 5, 8, 0)");
    earth.addColorStop(0.52, "rgba(1, 4, 6, 0.88)");
    earth.addColorStop(1, "#010305");
    context.fillStyle = earth;
    context.beginPath();
    context.moveTo(0, height);
    context.lineTo(0, height * 0.96);
    context.bezierCurveTo(width * 0.2, height * 0.925, width * 0.34, height * 0.98, width * 0.52, height * 0.955);
    context.bezierCurveTo(width * 0.7, height * 0.93, width * 0.82, height * 0.965, width, height * 0.925);
    context.lineTo(width, height);
    context.closePath();
    context.fill();
  }

  function paintRidge(context, baseY, color, amplitude, seedOffset) {
    const random = mulberry32(Math.round(width * 3 + height * 5 + seedOffset * 101));
    context.fillStyle = color;
    context.beginPath();
    context.moveTo(-8, height);
    context.lineTo(-8, baseY);
    let x = -8;
    let y = baseY;
    while (x < width + 16) {
      const step = randomBetween(24, 60, random);
      const contour = Math.sin(x * 0.006 + seedOffset) * height * amplitude * 0.38;
      y = baseY - height * amplitude * randomBetween(0.18, 0.72, random) + contour;
      context.quadraticCurveTo(x + step * 0.45, y + randomBetween(-5, 5, random), x + step, y);
      x += step;
    }
    context.lineTo(width + 8, height);
    context.closePath();
    context.fill();
  }

  function paintForestMass(context, baseY, color, heightRatio, seedOffset) {
    const random = mulberry32(Math.round(width * 7 + height * 11 + seedOffset * 101));
    const baseHeight = height * heightRatio;
    context.fillStyle = color;
    context.beginPath();
    context.moveTo(-6, height);
    context.lineTo(-6, baseY);
    let x = -6;
    while (x < width + 12) {
      const treeHeight = baseHeight * randomBetween(0.3, 1, random);
      const treeWidth = treeHeight * randomBetween(0.18, 0.42, random);
      const crownY = baseY - treeHeight;
      context.lineTo(x + treeWidth * 0.3, baseY - treeHeight * 0.28);
      context.quadraticCurveTo(x + treeWidth * 0.08, crownY + treeHeight * 0.11, x + treeWidth * 0.52, crownY);
      context.quadraticCurveTo(x + treeWidth * 0.9, crownY + treeHeight * 0.32, x + treeWidth, baseY - treeHeight * 0.42);
      context.lineTo(x + treeWidth * 1.35, baseY);
      x += treeWidth * randomBetween(0.72, 1.05, random);
    }
    context.lineTo(width + 10, height);
    context.closePath();
    context.fill();
  }

  function paintNearSpruces(context, seedOffset) {
    const random = mulberry32(Math.round(width * 13 + height * 17 + seedOffset * 101));
    const baseY = height * 0.99;
    const trees = Math.round(clamp(width / 95, 8, 19));

    for (let i = 0; i < trees; i += 1) {
      const x = ((i + randomBetween(-0.36, 0.36, random)) / (trees - 1)) * width;
      const edge = Math.abs(x / width - 0.5) * 2;
      const treeHeight = height * randomBetween(0.045, 0.125, random) * (0.8 + edge * 0.42);
      const treeWidth = treeHeight * randomBetween(0.26, 0.44, random);
      paintSpruce(context, x, baseY + randomBetween(-2, 3, random), treeWidth, treeHeight, random);
    }
  }

  function paintSpruce(context, x, baseY, treeWidth, treeHeight, random) {
    context.fillStyle = "rgba(1, 5, 8, 0.96)";
    context.beginPath();
    context.moveTo(x - treeWidth * 0.06, baseY);
    context.lineTo(x - treeWidth * 0.035, baseY - treeHeight * 0.3);
    context.lineTo(x, baseY - treeHeight);
    context.lineTo(x + treeWidth * 0.04, baseY - treeHeight * 0.31);
    context.lineTo(x + treeWidth * 0.075, baseY);
    context.closePath();
    context.fill();

    const layers = 6 + Math.floor(random() * 4);
    context.beginPath();
    for (let layer = 0; layer < layers; layer += 1) {
      const progress = (layer + 0.72) / layers;
      const y = baseY - treeHeight + treeHeight * progress;
      const halfWidth = treeWidth * Math.pow(progress, 0.78) * randomBetween(0.62, 1.08, random);
      const droop = treeHeight * randomBetween(0.028, 0.07, random);
      context.moveTo(x, y - treeHeight * 0.055);
      context.quadraticCurveTo(x - halfWidth * 0.25, y, x - halfWidth, y + droop);
      context.quadraticCurveTo(x - halfWidth * 0.32, y + droop * 0.75, x, y + droop * 0.38);
      context.quadraticCurveTo(x + halfWidth * 0.3, y + droop * 0.75, x + halfWidth, y + droop);
      context.quadraticCurveTo(x + halfWidth * 0.24, y, x, y - treeHeight * 0.055);
    }
    context.fill();
  }

  function getRadiant() {
    return {
      x: width * (width < height ? 0.67 : 0.7),
      y: height * (width < height ? 0.2 : 0.24),
    };
  }

  function createMeteor(target = null, intentional = false) {
    const radiant = getRadiant();
    const diagonal = Math.hypot(width, height);
    let x;
    let y;

    if (target) {
      x = clamp(target.x, width * 0.08, width * 0.92);
      y = clamp(target.y, height * 0.1, height * 0.8);
    } else {
      let tries = 0;
      do {
        x = randomBetween(width * 0.06, width * 0.94);
        y = randomBetween(height * 0.08, height * 0.76);
        tries += 1;
      } while (Math.hypot(x - radiant.x, y - radiant.y) < diagonal * 0.09 && tries < 12);
    }

    const baseAngle = Math.atan2(y - radiant.y, x - radiant.x);
    const angle = baseAngle + randomBetween(-0.055, 0.055);
    const directionX = Math.cos(angle);
    const directionY = Math.sin(angle);
    const distanceFromRadiant = Math.hypot(x - radiant.x, y - radiant.y);
    const perspective = clamp(distanceFromRadiant / (diagonal * 0.48), 0.18, 1);
    // The majority of naked-eye meteors are small, brief, and almost colourless. Their
    // rarity is part of the atmosphere: one clean streak is more believable than a barrage.
    const fireball = intentional ? Math.random() < 0.012 : Math.random() < 0.003;
    const pathLength = randomBetween(86, fireball ? 220 : 158) * lerp(0.62, 1, perspective);
    const speed = randomBetween(fireball ? 360 : 250, fireball ? 560 : 430);
    const travelDuration = pathLength / speed;
    const trailLength = pathLength * randomBetween(fireball ? 0.43 : 0.33, fireball ? 0.58 : 0.46);
    const hue = Math.random();
    const color = hue < 0.07 ? [205, 218, 220] : hue > 0.94 ? [238, 224, 203] : [232, 235, 229];

    meteors.push({
      x,
      y,
      directionX,
      directionY,
      pathLength,
      trailLength,
      speed,
      travelDuration,
      totalDuration: travelDuration + (fireball ? 0.08 : 0.035),
      age: 0,
      width: randomBetween(fireball ? 0.6 : 0.25, fireball ? 0.92 : 0.46),
      brightness: randomBetween(fireball ? 0.72 : 0.46, fireball ? 0.92 : 0.76),
      fireball,
      color,
      flareAt: randomBetween(0.42, 0.72),
    });

    meteorCount += 1;
    updateCount();
  }

  function scheduleNextMeteor(now) {
    // Even on a good Perseid night, most of the time is spent waiting and looking.
    const wait = clamp((-Math.log(1 - Math.random()) / 0.035) * 1000, 14000, 96000);
    nextMeteorAt = now + wait;
  }

  function prepareCaptureMeteors() {
    meteorCount = 0;
    createMeteor({ x: width * 0.37, y: height * 0.4 });
    const sampleMeteor = meteors[meteors.length - 1];
    sampleMeteor.fireball = false;
    sampleMeteor.pathLength = clamp(width * 0.16, 90, 190);
    sampleMeteor.trailLength = sampleMeteor.pathLength * 0.4;
    sampleMeteor.travelDuration = sampleMeteor.pathLength / sampleMeteor.speed;
    sampleMeteor.totalDuration = sampleMeteor.travelDuration + 0.035;
    sampleMeteor.width = 0.42;
    sampleMeteor.brightness = 0.72;
    sampleMeteor.age = sampleMeteor.travelDuration * 0.82;
  }

  function updateCount() {
    countLabel.textContent = `${String(meteorCount).padStart(2, "0")} ${meteorCount === 1 ? "sighting" : "sightings"}`;
    countDot.classList.remove("is-live");
    void countDot.offsetWidth;
    countDot.classList.add("is-live");
  }

  function update(delta, now) {
    parallaxX += (pointerX - parallaxX) * Math.min(1, delta * 0.85);
    parallaxY += (pointerY - parallaxY) * Math.min(1, delta * 0.85);

    if (!paused && !reduceMotionQuery.matches && now >= nextMeteorAt) {
      createMeteor();
      scheduleNextMeteor(now);
    }

    if (!paused && !reduceMotionQuery.matches && now >= nextSatelliteAt && !satellite) {
      satellite = {
        x: -15,
        y: randomBetween(height * 0.15, height * 0.48),
        speed: randomBetween(13, 21),
        slope: randomBetween(-0.08, 0.12),
        alpha: randomBetween(0.22, 0.42),
      };
      nextSatelliteAt = now + randomBetween(48000, 90000);
    }

    if (!paused) {
      for (const meteor of meteors) meteor.age += delta;
      meteors = meteors.filter((meteor) => meteor.age < meteor.totalDuration);

      if (satellite) {
        satellite.x += satellite.speed * delta;
        satellite.y += satellite.speed * satellite.slope * delta;
        if (satellite.x > width + 20) satellite = null;
      }
    }
  }

  function draw(now) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const offsetX = parallaxX * 2.2;
    const offsetY = parallaxY * 1.6;
    ctx.drawImage(backgroundCanvas, offsetX - 3, offsetY - 3, width + 6, height + 6);
    drawTwinklingStars(now, offsetX, offsetY);
    if (reduceMotionQuery.matches && !captureMode) drawReducedMotionMeteor();
    drawSatellite();

    for (const meteor of meteors) drawMeteor(meteor);

    ctx.drawImage(foregroundCanvas, 0, 0, width, height);
  }

  function drawReducedMotionMeteor() {
    const startX = width * 0.2;
    const startY = height * 0.24;
    const endX = startX - Math.min(110, width * 0.2);
    const endY = startY + Math.min(70, height * 0.1);
    const gradient = ctx.createLinearGradient(endX, endY, startX, startY);
    gradient.addColorStop(0, "rgba(229, 236, 238, 0)");
    gradient.addColorStop(1, "rgba(248, 242, 224, 0.32)");
    ctx.save();
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 0.7;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(startX, startY);
    ctx.stroke();
    ctx.restore();
  }

  function drawTwinklingStars(now, offsetX, offsetY) {
    for (const star of stars) {
      if (!star.twinkles) continue;
      const shimmer = 0.82 + Math.sin(now * star.twinkleSpeed + star.phase) * 0.18;
      const [r, g, b] = star.color;
      const x = star.x * width + offsetX * star.depth;
      const y = star.y * height + offsetY * star.depth;
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${star.alpha * shimmer * 0.32})`;
      ctx.beginPath();
      ctx.arc(x, y, star.radius * (1 + shimmer * 0.15), 0, TAU);
      ctx.fill();
    }
  }

  function drawSatellite() {
    if (!satellite) return;
    ctx.save();
    ctx.fillStyle = `rgba(232, 230, 210, ${satellite.alpha})`;
    ctx.shadowColor = "rgba(220, 226, 220, 0.28)";
    ctx.shadowBlur = 3;
    ctx.beginPath();
    ctx.arc(satellite.x, satellite.y, 0.72, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawMeteor(meteor) {
    const travelProgress = clamp(meteor.age / meteor.travelDuration, 0, 1);
    const afterlife = clamp((meteor.age - meteor.travelDuration) / (meteor.totalDuration - meteor.travelDuration), 0, 1);
    const ignition = smoothstep(0, 0.065, travelProgress);
    const trailFade = afterlife > 0 ? 1 - smoothstep(0, 1, afterlife) : ignition;
    const headFade = afterlife > 0 ? 0 : ignition * (1 - smoothstep(0.9, 1, travelProgress) * 0.2);
    const flareDistance = (travelProgress - meteor.flareAt) / 0.12;
    const flare = meteor.fireball ? Math.exp(-(flareDistance * flareDistance)) : 0;
    const luminance = meteor.brightness * (1 + flare * 0.26);
    // A meteor is a moving point with a short, fading wake — not a glowing laser line.
    const headDistance = meteor.pathLength * travelProgress;
    const currentTrail = Math.min(meteor.trailLength, headDistance * 0.97) * (1 - afterlife * 0.18);
    const headX = meteor.x + meteor.directionX * headDistance;
    const headY = meteor.y + meteor.directionY * headDistance;
    const tailX = headX - meteor.directionX * currentTrail;
    const tailY = headY - meteor.directionY * currentTrail;
    const [r, g, b] = meteor.color;

    ctx.save();
    ctx.lineCap = "round";
    ctx.globalCompositeOperation = "lighter";

    // First lay down a nearly invisible, out-of-focus wake. It avoids the hard digital
    // edge that makes a canvas-drawn streak read as a graphic.
    const halo = ctx.createLinearGradient(tailX, tailY, headX, headY);
    halo.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
    halo.addColorStop(0.72, `rgba(${r}, ${g}, ${b}, ${0.02 * luminance * trailFade})`);
    halo.addColorStop(1, `rgba(${r}, ${g}, ${b}, ${0.09 * luminance * trailFade})`);
    ctx.strokeStyle = halo;
    ctx.lineWidth = meteor.width * (meteor.fireball ? 3 : 2.1);
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(headX, headY);
    ctx.stroke();

    const core = ctx.createLinearGradient(tailX, tailY, headX, headY);
    core.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
    core.addColorStop(0.42, `rgba(${r}, ${g}, ${b}, ${0.015 * luminance * trailFade})`);
    core.addColorStop(0.83, `rgba(${r}, ${g}, ${b}, ${0.32 * luminance * trailFade})`);
    core.addColorStop(1, `rgba(250, 246, 231, ${0.72 * luminance * trailFade})`);
    ctx.strokeStyle = core;
    ctx.lineWidth = Math.max(0.28, meteor.width);
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(headX, headY);
    ctx.stroke();

    if (headFade > 0) {
      ctx.fillStyle = `rgba(255, 249, 232, ${0.62 * headFade * luminance})`;
      ctx.beginPath();
      ctx.arc(headX, headY, Math.max(0.28, meteor.width * (meteor.fireball ? 0.85 : 0.52)), 0, TAU);
      ctx.fill();
    }

    ctx.restore();
  }

  function animationFrame(now) {
    const delta = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    update(delta, now);
    draw(now);
    if (!captureMode && !document.hidden && !paused && !reduceMotionQuery.matches) {
      animationRequest = window.requestAnimationFrame(animationFrame);
    }
  }

  function handlePointerMove(event) {
    pointerX = ((event.clientX / width) * 2 - 1) * -1;
    pointerY = ((event.clientY / height) * 2 - 1) * -1;
    sky.classList.remove("cursor-idle");
    window.clearTimeout(cursorTimer);
    cursorTimer = window.setTimeout(() => sky.classList.add("cursor-idle"), 2800);
  }

  function handleWish(event) {
    if (paused || reduceMotionQuery.matches) return;
    createMeteor({ x: event.clientX, y: event.clientY }, true);
    hint.classList.add("is-hidden");
  }

  function toggleMotion() {
    if (reduceMotionQuery.matches) return;
    paused = !paused;
    motionToggle.setAttribute("aria-pressed", String(paused));
    motionToggle.setAttribute("aria-label", paused ? "Resume sky motion" : "Pause sky motion");
    motionToggle.querySelector("span").textContent = paused ? "Resume sky" : "Pause sky";
    window.cancelAnimationFrame(animationRequest);
    if (paused) {
      draw(performance.now());
    } else {
      lastFrame = performance.now();
      scheduleNextMeteor(lastFrame);
      animationRequest = window.requestAnimationFrame(animationFrame);
    }
  }

  function selectScene(event) {
    const scene = event.currentTarget.dataset.scene;
    if (!scene || !scenes[scene] || scene === activeScene) return;

    activeScene = scene;
    sceneButtons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.scene === scene)));
    skyPhoto.src = scenes[scene].source;
  }

  class Soundscape {
    constructor() {
      this.audioContext = null;
      this.gain = null;
      this.sources = [];
    }

    async start() {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return false;
      this.audioContext = this.audioContext || new AudioContext();
      if (this.audioContext.state === "suspended") await this.audioContext.resume();

      const sampleRate = this.audioContext.sampleRate;
      const buffer = this.audioContext.createBuffer(1, sampleRate * 4, sampleRate);
      const samples = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < samples.length; i += 1) {
        const white = Math.random() * 2 - 1;
        last = last * 0.985 + white * 0.015;
        samples[i] = last * 3.2;
      }

      const noise = this.audioContext.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;

      const filter = this.audioContext.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 820;
      filter.Q.value = 0.5;

      this.gain = this.audioContext.createGain();
      this.gain.gain.setValueAtTime(0, this.audioContext.currentTime);
      this.gain.gain.linearRampToValueAtTime(0.038, this.audioContext.currentTime + 1.8);

      const lfo = this.audioContext.createOscillator();
      const lfoGain = this.audioContext.createGain();
      lfo.frequency.value = 0.075;
      lfoGain.gain.value = 0.012;
      lfo.connect(lfoGain).connect(this.gain.gain);

      noise.connect(filter).connect(this.gain).connect(this.audioContext.destination);
      noise.start();
      lfo.start();
      this.sources = [noise, lfo];
      return true;
    }

    stop() {
      if (!this.audioContext || !this.gain) return;
      const now = this.audioContext.currentTime;
      this.gain.gain.cancelScheduledValues(now);
      this.gain.gain.setValueAtTime(this.gain.gain.value, now);
      this.gain.gain.linearRampToValueAtTime(0, now + 0.5);
      const sources = this.sources;
      window.setTimeout(() => sources.forEach((source) => source.stop()), 650);
      this.sources = [];
      this.gain = null;
    }
  }

  async function toggleSound() {
    const isOn = soundToggle.getAttribute("aria-pressed") === "true";
    if (isOn) {
      soundscape.stop();
      soundToggle.setAttribute("aria-pressed", "false");
      soundToggle.setAttribute("aria-label", "Enable night sounds");
      soundToggle.querySelector("span").textContent = "Night sounds";
      return;
    }

    soundscape = soundscape || new Soundscape();
    const started = await soundscape.start();
    if (started) {
      soundToggle.setAttribute("aria-pressed", "true");
      soundToggle.setAttribute("aria-label", "Mute night sounds");
      soundToggle.querySelector("span").textContent = "Mute night";
    }
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      window.cancelAnimationFrame(animationRequest);
    } else if (!captureMode && !paused && !reduceMotionQuery.matches) {
      lastFrame = performance.now();
      scheduleNextMeteor(lastFrame);
      window.cancelAnimationFrame(animationRequest);
      animationRequest = window.requestAnimationFrame(animationFrame);
    }
  }

  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener("pointermove", handlePointerMove, { passive: true });
  canvas.addEventListener("pointerdown", handleWish, { passive: true });
  motionToggle.addEventListener("click", toggleMotion);
  soundToggle.addEventListener("click", toggleSound);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  reduceMotionQuery.addEventListener?.("change", (event) => {
    paused = event.matches;
    motionToggle.disabled = event.matches;
    motionToggle.setAttribute("aria-pressed", String(paused));
    motionToggle.setAttribute("aria-label", event.matches ? "Sky motion reduced by system preference" : "Pause sky motion");
    motionToggle.querySelector("span").textContent = event.matches ? "Reduced motion" : "Pause sky";
    window.cancelAnimationFrame(animationRequest);
    if (event.matches) {
      animationRequest = window.requestAnimationFrame(animationFrame);
    } else if (!captureMode && !document.hidden) {
      lastFrame = performance.now();
      scheduleNextMeteor(lastFrame);
      animationRequest = window.requestAnimationFrame(animationFrame);
    }
  });

  skyPhoto.addEventListener("load", () => {
    skyPhotoLoaded = true;
    resize();
  });
  sceneButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.scene === activeScene));
    button.addEventListener("click", selectScene);
  });
  skyPhoto.src = scenes[activeScene].source;

  window.setTimeout(() => intro.classList.add("is-resting"), 6800);
  window.setTimeout(() => hint.classList.add("is-hidden"), 12000);
  cursorTimer = window.setTimeout(() => sky.classList.add("cursor-idle"), 4200);

  resize();
  motionToggle.disabled = reduceMotionQuery.matches;
  if (reduceMotionQuery.matches) {
    motionToggle.setAttribute("aria-label", "Sky motion reduced by system preference");
    motionToggle.querySelector("span").textContent = "Reduced motion";
    animationRequest = window.requestAnimationFrame(animationFrame);
  } else if (!captureMode) {
    animationRequest = window.requestAnimationFrame(animationFrame);
  }
})();
