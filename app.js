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
  const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const captureMode = new URLSearchParams(window.location.search).has("capture");

  const TAU = Math.PI * 2;
  const palette = [
    [211, 222, 232],
    [226, 232, 234],
    [244, 239, 222],
    [219, 228, 239],
    [238, 228, 207],
  ];

  let width = 0;
  let height = 0;
  let dpr = 1;
  let lastFrame = performance.now();
  let nextMeteorAt = lastFrame + 900;
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
    const starCount = Math.round(clamp((width * height) / 1250, 520, 1180));
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

      const magnitudeRoll = Math.pow(seededRandom(), 5.8);
      const radius = 0.2 + magnitudeRoll * 1.08;
      const alpha = 0.14 + Math.pow(magnitudeRoll, 0.56) * 0.8;
      const color = palette[Math.floor(seededRandom() * palette.length)];
      stars.push({
        x,
        y,
        radius,
        alpha,
        color,
        phase: seededRandom() * TAU,
        twinkleSpeed: randomBetween(0.00022, 0.0006, seededRandom),
        twinkles: radius > 0.62 && seededRandom() < 0.28,
        depth: randomBetween(0.15, 1, seededRandom),
      });
    }
  }

  function paintBackground(context) {
    context.clearRect(0, 0, width, height);

    const skyGradient = context.createLinearGradient(0, 0, 0, height);
    skyGradient.addColorStop(0, "#01040a");
    skyGradient.addColorStop(0.46, "#030916");
    skyGradient.addColorStop(0.78, "#071323");
    skyGradient.addColorStop(1, "#0a1724");
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
    airglow.addColorStop(0, "rgba(37, 68, 68, 0.075)");
    airglow.addColorStop(0.42, "rgba(23, 45, 51, 0.035)");
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

  function paintMilkyWay(context) {
    const diagonal = Math.hypot(width, height) * 1.35;
    context.save();
    context.translate(width * 0.48, height * 0.48);
    context.rotate(-0.72);
    context.globalCompositeOperation = "screen";
    context.filter = `blur(${Math.max(22, width * 0.025)}px)`;

    const haze = context.createLinearGradient(0, -height * 0.23, 0, height * 0.23);
    haze.addColorStop(0, "rgba(95, 115, 132, 0)");
    haze.addColorStop(0.28, "rgba(95, 112, 126, 0.025)");
    haze.addColorStop(0.49, "rgba(132, 140, 140, 0.072)");
    haze.addColorStop(0.58, "rgba(112, 124, 132, 0.045)");
    haze.addColorStop(1, "rgba(89, 107, 121, 0)");
    context.fillStyle = haze;
    context.fillRect(-diagonal / 2, -height * 0.24, diagonal, height * 0.48);
    context.restore();

    // Uneven luminous puffs create the Milky Way's cloudlike stellar density.
    context.save();
    context.translate(width * 0.48, height * 0.48);
    context.rotate(-0.72);
    context.globalCompositeOperation = "screen";
    context.filter = `blur(${Math.max(4, width * 0.0045)}px)`;
    const cloudCount = Math.round(clamp(width / 10, 72, 150));
    for (let cloud = 0; cloud < cloudCount; cloud += 1) {
      const x = randomBetween(-diagonal * 0.52, diagonal * 0.52, seededRandom);
      const normal = (seededRandom() + seededRandom() + seededRandom() - 1.5) / 1.5;
      const centerRipple = Math.sin(x * 0.008) * height * 0.018;
      const y = normal * height * 0.16 + centerRipple;
      const density = Math.pow(1 - Math.min(1, Math.abs(normal)), 1.7);
      const radius = randomBetween(20, Math.max(32, width * 0.07), seededRandom);
      const warm = seededRandom() < 0.18;
      const alpha = warm
        ? randomBetween(0.008, 0.022, seededRandom) * density
        : randomBetween(0.01, 0.032, seededRandom) * density;
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
    for (let i = 0; i < Math.min(450, width * 0.34); i += 1) {
      const x = randomBetween(-diagonal / 2, diagonal / 2, seededRandom);
      const normal = (seededRandom() + seededRandom() + seededRandom() - 1.5) / 1.5;
      const y = normal * height * 0.18;
      const radius = randomBetween(0.18, 0.7, seededRandom);
      const alpha = randomBetween(0.025, 0.11, seededRandom) * (1 - Math.abs(normal) * 0.7);
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

    const horizonGlow = context.createLinearGradient(0, height * 0.77, 0, height);
    horizonGlow.addColorStop(0, "rgba(19, 36, 45, 0)");
    horizonGlow.addColorStop(0.78, "rgba(18, 32, 38, 0.19)");
    horizonGlow.addColorStop(1, "rgba(4, 9, 13, 0.48)");
    context.fillStyle = horizonGlow;
    context.fillRect(0, height * 0.72, width, height * 0.28);

    const baseY = height * 0.94;
    paintTreeLine(context, baseY, "rgba(5, 12, 17, 0.72)", 0.72, 11);
    paintTreeLine(context, height * 0.98, "rgba(1, 5, 8, 0.97)", 1, 29);

    const earth = context.createLinearGradient(0, height * 0.91, 0, height);
    earth.addColorStop(0, "rgba(1, 5, 8, 0)");
    earth.addColorStop(0.52, "rgba(1, 4, 6, 0.92)");
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

  function paintTreeLine(context, baseY, color, scale, seedOffset) {
    const random = mulberry32(Math.round(width + height + seedOffset * 101));
    context.fillStyle = color;
    const edgeAllowance = Math.max(0, 1 - width / 1300);
    let x = randomBetween(-28, -8, random);

    while (x < width + 35) {
      const edge = Math.abs(x / width - 0.5) * 2;
      const naturalHeight = randomBetween(25, 72, random) * scale;
      const treeHeight = naturalHeight * (0.72 + edge * (0.7 + edgeAllowance));
      const treeWidth = treeHeight * randomBetween(0.34, 0.55, random);
      paintPine(context, x, baseY + randomBetween(-4, 6, random), treeWidth, treeHeight, random);
      x += randomBetween(24, 57, random) * scale;
    }
  }

  function paintPine(context, x, baseY, treeWidth, treeHeight, random) {
    context.beginPath();
    context.moveTo(x, baseY - treeHeight);
    const layers = 7 + Math.floor(random() * 3);
    for (let layer = 1; layer <= layers; layer += 1) {
      const progress = layer / layers;
      const y = baseY - treeHeight + treeHeight * progress + randomBetween(-1.4, 1.4, random);
      const halfWidth = treeWidth * Math.pow(progress, 0.82) * randomBetween(0.7, 1.12, random);
      context.lineTo(x - halfWidth, y);
      context.lineTo(x - halfWidth * randomBetween(0.18, 0.36, random), y - treeHeight * randomBetween(0.045, 0.085, random));
    }
    context.lineTo(x - treeWidth * 0.08, baseY);
    context.lineTo(x + treeWidth * 0.08, baseY);
    for (let layer = layers; layer >= 1; layer -= 1) {
      const progress = layer / layers;
      const y = baseY - treeHeight + treeHeight * progress + randomBetween(-1.4, 1.4, random);
      const halfWidth = treeWidth * Math.pow(progress, 0.82) * randomBetween(0.7, 1.12, random);
      context.lineTo(x + halfWidth * randomBetween(0.18, 0.36, random), y - treeHeight * randomBetween(0.045, 0.085, random));
      context.lineTo(x + halfWidth, y);
    }
    context.closePath();
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
    const fireball = intentional || Math.random() < 0.055;
    const pathLength = randomBetween(105, fireball ? 430 : 300) * lerp(0.48, 1.08, perspective);
    const speed = randomBetween(fireball ? 760 : 940, fireball ? 1180 : 1680);
    const travelDuration = pathLength / speed;
    const trailLength = pathLength * randomBetween(fireball ? 0.36 : 0.18, fireball ? 0.58 : 0.38);
    const hue = Math.random();
    const color = hue < 0.2 ? [201, 222, 233] : hue > 0.82 ? [255, 224, 182] : [247, 242, 225];

    meteors.push({
      x,
      y,
      directionX,
      directionY,
      pathLength,
      trailLength,
      travelDuration,
      totalDuration: travelDuration + (fireball ? 0.68 : 0.24),
      age: 0,
      width: randomBetween(fireball ? 1.05 : 0.38, fireball ? 1.72 : 0.88),
      brightness: randomBetween(fireball ? 0.92 : 0.48, 1),
      fireball,
      color,
      seed: Math.random() * TAU,
      flareAt: randomBetween(0.36, 0.76),
      texture: Array.from({ length: 20 }, () => randomBetween(0.72, 1.08)),
      fragments: fireball && Math.random() < 0.48,
    });

    meteorCount += 1;
    updateCount();
  }

  function scheduleNextMeteor(now) {
    // A capped exponential arrival time creates natural lulls and close pairs.
    const wait = clamp((-Math.log(1 - Math.random()) / 0.38) * 1000, 1200, 5600);
    nextMeteorAt = now + wait;
  }

  function prepareCaptureMeteors() {
    meteorCount = 0;
    createMeteor({ x: width * 0.42, y: height * 0.44 }, true);
    const fireball = meteors[meteors.length - 1];
    fireball.age = fireball.travelDuration * 0.48;

    createMeteor({ x: width * 0.78, y: height * 0.43 });
    const faintMeteor = meteors[meteors.length - 1];
    faintMeteor.fireball = false;
    faintMeteor.width = 0.64;
    faintMeteor.brightness = 0.58;
    faintMeteor.age = faintMeteor.travelDuration * 0.38;
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
      if (Math.random() < 0.12) {
        window.setTimeout(() => {
          if (!paused && !document.hidden) createMeteor();
        }, randomBetween(100, 420));
      }
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
    drawFireballLight();
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

  function drawFireballLight() {
    for (const meteor of meteors) {
      if (!meteor.fireball) continue;
      const travelProgress = clamp(meteor.age / meteor.travelDuration, 0, 1);
      const lifeFade = 1 - clamp((meteor.age - meteor.travelDuration * 0.7) / (meteor.totalDuration - meteor.travelDuration * 0.7), 0, 1);
      const headX = meteor.x + meteor.directionX * meteor.pathLength * travelProgress;
      const headY = meteor.y + meteor.directionY * meteor.pathLength * travelProgress;
      const flash = ctx.createRadialGradient(headX, headY, 0, headX, headY, Math.min(width, height) * 0.27);
      flash.addColorStop(0, `rgba(191, 211, 219, ${0.035 * lifeFade})`);
      flash.addColorStop(0.3, `rgba(106, 137, 153, ${0.014 * lifeFade})`);
      flash.addColorStop(1, "rgba(25, 42, 54, 0)");
      ctx.fillStyle = flash;
      ctx.fillRect(0, 0, width, height);
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
    const headFade = afterlife > 0 ? 0 : ignition * (1 - smoothstep(0.86, 1, travelProgress) * 0.38);
    const flareDistance = (travelProgress - meteor.flareAt) / (meteor.fireball ? 0.075 : 0.1);
    const flare = Math.exp(-(flareDistance * flareDistance));
    const luminance = meteor.brightness * (1 + flare * (meteor.fireball ? 0.72 : 0.18));
    // Meteors retain nearly constant apparent speed; cinematic easing reads as artificial.
    const headDistance = meteor.pathLength * travelProgress;
    const currentTrail = Math.min(meteor.trailLength, headDistance * 0.97) * (1 - afterlife * 0.18);
    const headX = meteor.x + meteor.directionX * headDistance;
    const headY = meteor.y + meteor.directionY * headDistance;
    const tailX = headX - meteor.directionX * currentTrail;
    const tailY = headY - meteor.directionY * currentTrail;
    const [r, g, b] = meteor.color;

    ctx.save();
    ctx.lineCap = "round";
    ctx.globalCompositeOperation = "screen";

    const glowGradient = ctx.createLinearGradient(tailX, tailY, headX, headY);
    glowGradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
    glowGradient.addColorStop(0.62, `rgba(${r}, ${g}, ${b}, ${0.035 * luminance * trailFade})`);
    glowGradient.addColorStop(1, `rgba(255, 247, 226, ${0.2 * luminance * trailFade})`);
    ctx.strokeStyle = glowGradient;
    ctx.lineWidth = meteor.width * (meteor.fireball ? 4.4 : 3.1);
    ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${0.2 * trailFade})`;
    ctx.shadowBlur = meteor.fireball ? 9 : 4;
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(headX, headY);
    ctx.stroke();

    // Short, tapered sections preserve tiny intensity changes seen in real ionized trails.
    const segmentCount = 18;
    ctx.shadowBlur = 0;
    for (let segment = 0; segment < segmentCount; segment += 1) {
      const start = segment / segmentCount;
      const end = Math.min(1, (segment + 1.06) / segmentCount);
      const texture = meteor.texture[segment % meteor.texture.length];
      const alpha = Math.min(1, Math.pow(end, 2.15) * 0.72 * luminance * trailFade * texture);
      const nearHead = smoothstep(0.78, 1, end);
      const red = Math.round(lerp(r, 255, nearHead * 0.72));
      const green = Math.round(lerp(g, 249, nearHead * 0.7));
      const blue = Math.round(lerp(b, 232, nearHead * 0.45));
      ctx.strokeStyle = `rgba(${red}, ${green}, ${blue}, ${alpha})`;
      ctx.lineWidth = Math.max(0.22, meteor.width * (0.16 + Math.pow(end, 1.45) * 0.84));
      ctx.beginPath();
      ctx.moveTo(lerp(tailX, headX, start), lerp(tailY, headY, start));
      ctx.lineTo(lerp(tailX, headX, end), lerp(tailY, headY, end));
      ctx.stroke();
    }

    if (meteor.fireball && headFade > 0) {
      const coreRadius = (3.8 + flare * 1.8) * headFade;
      const core = ctx.createRadialGradient(headX, headY, 0, headX, headY, coreRadius);
      core.addColorStop(0, `rgba(255, 252, 238, ${Math.min(1, headFade * luminance)})`);
      core.addColorStop(0.22, `rgba(255, 220, 175, ${0.58 * headFade})`);
      core.addColorStop(1, "rgba(190, 218, 228, 0)");
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(headX, headY, coreRadius, 0, TAU);
      ctx.fill();
    } else if (headFade > 0) {
      ctx.fillStyle = `rgba(255, 251, 236, ${0.86 * headFade * luminance})`;
      ctx.beginPath();
      ctx.arc(headX, headY, Math.max(0.34, meteor.width * 0.52), 0, TAU);
      ctx.fill();
    }

    if (meteor.fragments && travelProgress > 0.58) {
      drawFragments(meteor, headX, headY, currentTrail, trailFade, r, g, b);
    }

    ctx.restore();
  }

  function drawFragments(meteor, headX, headY, trailLength, fade, r, g, b) {
    const perpendicularX = -meteor.directionY;
    const perpendicularY = meteor.directionX;
    for (let i = 0; i < 3; i += 1) {
      const separation = (i - 1) * 3.2 * clamp((meteor.age - meteor.travelDuration * 0.5) * 3, 0, 1);
      const fragmentLength = trailLength * (0.14 + i * 0.055);
      const fragmentHeadX = headX - meteor.directionX * (9 + i * 8) + perpendicularX * separation;
      const fragmentHeadY = headY - meteor.directionY * (9 + i * 8) + perpendicularY * separation;
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.28 * fade})`;
      ctx.lineWidth = 0.45;
      ctx.beginPath();
      ctx.moveTo(fragmentHeadX - meteor.directionX * fragmentLength, fragmentHeadY - meteor.directionY * fragmentLength);
      ctx.lineTo(fragmentHeadX, fragmentHeadY);
      ctx.stroke();
    }
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
