<svelte:options customElement={{ tag: "elnino-wgc", shadow: "open" }} />

<script>
  import { onMount, onDestroy } from "svelte";
  import * as d3 from "d3";
  import * as THREE from "three";
  import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
  import { tweened } from "svelte/motion";
  import { cubicInOut } from "svelte/easing";
  import { scale } from "svelte/transition";
  const SHEET_ID = "1Vm6vxrxc9Y6-coeX2o2rSsnYmMO4NBubSP40Jn59Yuw";
  const API_KEY = "AIzaSyAPauL7gS0wK5bi9QVEbhjkzjwppBBU5_U";
  const RANGE = "data!A1:L2000";
  const SHEET_URL = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${RANGE}?key=${API_KEY}`;
  const GEOJSON_URL =
    "https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson";
  const MONTH_NAMES = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const SEAS_MAPPING = {
    DJF: { start_m: 12, end_m: 2, desc: "Winter" },
    JFM: { start_m: 1, end_m: 3, desc: "Late Winter / Early Spring" },
    FMA: { start_m: 2, end_m: 4, desc: "Early Spring" },
    MAM: { start_m: 3, end_m: 5, desc: "Spring" },
    AMJ: { start_m: 4, end_m: 6, desc: "Late Spring / Early Summer" },
    MJJ: { start_m: 5, end_m: 7, desc: "Early Summer" },
    JJA: { start_m: 6, end_m: 8, desc: "Summer" },
    JAS: { start_m: 7, end_m: 9, desc: "Late Summer / Early Autumn" },
    ASO: { start_m: 8, end_m: 10, desc: "Early Autumn" },
    SON: { start_m: 9, end_m: 11, desc: "Autumn" },
    OND: { start_m: 10, end_m: 12, desc: "Late Autumn / Early Winter" },
    NDJ: { start_m: 11, end_m: 1, desc: "Early Winter" },
  };
  const ENSO_MAPPING = {
    VSE: { value: 4, desc: "Very Strong El Nino", color: "#AA513B" },
    SE: { value: 3, desc: "Strong El Nino", color: "#c03e48" }, // Updated color reference here
    ME: { value: 2, desc: "Moderate El Nino", color: "#FFA500" },
    WE: { value: 1, desc: "Weak El Nino", color: "#FFD700" },
    N: { value: 0, desc: "Neutral", color: "#E0E0E0" },
    WL: { value: -1, desc: "Weak La Nina", color: "#87CEFA" },
    ML: { value: -2, desc: "Moderate La Nina", color: "#00BFFF" },
    SL: { value: -3, desc: "Strong La Nina", color: "#9370DB" },
  };
  export let jsonUrl =
    "https://multimedia.scmp.com/infographics/news/world/article/3356851/el_nino_la_nina/data/event.json";
  export let monthlyAnm = [];
  export let roniData = [];
  let highlightPeriods = [];
  let flatPois = [];
  let poiElements = [];
  let isLoading = true;
  let errorMessage = "";
  let width = 0,
    height = 0;
  const margin = { top: 40, right: 15, bottom: 60, left: 20 };
  $: innerWidth = Math.max(0, width - margin.left - margin.right);
  $: innerHeight = Math.max(0, height - margin.top - margin.bottom);
  let canvasElement;
  let dragZoneElement;
  let globeCtnElement;
  let globeWidth = 0,
    globeHeight = 0;
  let renderer, scene, camera, controls;
  let tiltGroup, earthGroup, globeMesh;
  let poiGroup = new THREE.Group();
  let animationFrameId;
  let isFocusMode = false;
  let activePeriodId = null;
  $: activePeriod = highlightPeriods.find((p) => p.id === activePeriodId);
  let isAnimatingCamera = false;
  let startCamSpherical = new THREE.Spherical();
  let endCamSpherical = new THREE.Spherical();
  const animationProgress = tweened(0, { duration: 1200, easing: cubicInOut });
  let hoveredBar = null;
  let mousePos = { x: 0, y: 0 };
  let pointerDownPos = { x: 0, y: 0 };
  let hoveredPoi = null;
  $: dragSize = Math.min(globeWidth, globeHeight) * 0.82;
  $: aspect = globeWidth > 0 && globeHeight > 0 ? globeWidth / globeHeight : 1;
  $: targetBaseZ = aspect < 1 ? 2.2 / aspect : 2.8;
  function createSquareTexture(fillColor, borderColor) {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = borderColor;
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = fillColor;
    ctx.fillRect(8, 8, 48, 48);
    const texture = new THREE.CanvasTexture(canvas);
    if (THREE.SRGBColorSpace) {
      texture.colorSpace = THREE.SRGBColorSpace;
    } else {
      texture.encoding = 3001;
    }
    return texture;
  }
  // Use your exact requested color: #c03e48
  const defaultSpriteMat = new THREE.SpriteMaterial({
    map: createSquareTexture("#ffffff", "#c03e48"),
  });
  const hoverSpriteMat = new THREE.SpriteMaterial({
    map: createSquareTexture("#c03e48", "#c03e48"),
  });
  $: xScale = d3
    .scaleBand()
    .domain(chartData.map((d) => d.key))
    .range([0, innerWidth])
    .padding(0.1);
  $: yExtent = d3.extent(chartData, (d) => d.anom_ssta) || [0, 0];
  $: yScale = d3
    .scaleLinear()
    .domain([Math.min(-2.5, yExtent[0]), Math.max(2.5, yExtent[1])])
    .nice()
    .range([innerHeight, 0]);
  $: chartData = monthlyAnm
    .filter((d) => d.yr_ssta && d.anom_ssta)
    .map((d) => ({
      ...d,
      yr_ssta: +d.yr_ssta,
      month: +d.month,
      anom_ssta: +d.anom_ssta,
      key: `${d.yr_ssta}-${d.month}`,
      timeScore: +d.yr_ssta * 12 + +d.month,
    }));
  $: highlightBoxes = highlightPeriods
    .map((period) => {
      if (!period.start || !period.end) return null;
      const startParts = period.start.split(",");
      const endParts = period.end.split(",");
      const startYr = parseInt(startParts[0].trim(), 10);
      const startM = parseInt(startParts[1].trim(), 10);
      const endYr = parseInt(endParts[0].trim(), 10);
      const endM = parseInt(endParts[1].trim(), 10);
      const startScore = startYr * 12 + startM;
      const endScore = endYr * 12 + endM;
      const barsInPeriod = chartData.filter(
        (d) => d.timeScore >= startScore && d.timeScore <= endScore,
      );
      if (barsInPeriod.length === 0) return null;
      const firstSpaceIndex = period.label.indexOf(" ");
      const labelYear =
        firstSpaceIndex > -1
          ? period.label.substring(0, firstSpaceIndex)
          : period.label;
      const labelEvent =
        firstSpaceIndex > -1 ? period.label.substring(firstSpaceIndex + 1) : "";
      return {
        ...period,
        x: xScale(barsInPeriod[0].key),
        width:
          xScale(barsInPeriod[barsInPeriod.length - 1].key) +
          xScale.bandwidth() -
          xScale(barsInPeriod[0].key),
        labelYear,
        labelEvent,
      };
    })
    .filter(Boolean);
  $: roniPoints = roniData
    .filter((d) => d.SEAS && d.YR && d.ANOM !== "")
    .map((d) => {
      const mapping = SEAS_MAPPING[d.SEAS];
      if (!mapping) return null;
      let startYr = parseInt(d.YR, 10);
      let endYr = parseInt(d.YR, 10);
      if (d.SEAS === "DJF") {
        startYr -= 1;
      } else if (d.SEAS === "NDJ") {
        endYr += 1;
      }
      const startKey = `${startYr}-${mapping.start_m}`;
      const endKey = `${endYr}-${mapping.end_m}`;
      const x1 = xScale(startKey);
      const x2 = xScale(endKey);
      if (x1 === undefined || x2 === undefined) return null;
      return {
        x: x1 + (x2 - x1) / 2 + xScale.bandwidth() / 2,
        y: yScale(parseFloat(d.ANOM)),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.x - b.x);
  $: roniPath =
    roniPoints.length > 0
      ? d3
          .line()
          .x((d) => d.x)
          .y((d) => d.y)(roniPoints)
      : null;
  $: updateMeshColors(isFocusMode, activePeriodId, flatPois, hoveredPoi);
  function updateMeshColors(focus, periodId, pois, currentHoveredPoi) {
    if (pois && pois.length > 0) {
      pois.forEach((poi) => {
        if (poi.mesh) {
          const belongsToActivePeriod =
            focus && periodId && poi.events[periodId];
          const isHovered =
            currentHoveredPoi && currentHoveredPoi.id === poi.id;
          poi.mesh.material =
            belongsToActivePeriod || isHovered
              ? hoverSpriteMat
              : defaultSpriteMat;
          poi.mesh.visible = true;
        }
      });
    }
  }
  function latLongToVector3(lat, lon, radius) {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lon + 180) * (Math.PI / 180);
    return new THREE.Vector3(
      -(radius * Math.sin(phi) * Math.cos(theta)),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.sin(theta),
    );
  }
  function resolveOverlap(pois) {
    pois.forEach((p) => {
      p.x = p.lon;
      p.y = p.lat;
    });
    const simulation = d3
      .forceSimulation(pois)
      .force("x", d3.forceX((d) => d.lon).strength(0.8))
      .force("y", d3.forceY((d) => d.lat).strength(0.8))
      .force("collide", d3.forceCollide().radius(1.5).iterations(2))
      .stop();
    for (let i = 0; i < 40; ++i) {
      simulation.tick();
    }
    pois.forEach((d) => {
      d.lon = d.x;
      d.lat = d.y;
    });
  }
  function calculateCenterOfPois(pois) {
    if (!pois || pois.length === 0) return { lat: 0, lon: 0 };
    if (pois.length === 1)
      return { lat: parseFloat(pois[0].lat), lon: parseFloat(pois[0].lon) };
    let x = 0,
      y = 0,
      z = 0;
    pois.forEach((p) => {
      const lat = parseFloat(p.lat) * (Math.PI / 180);
      const lon = parseFloat(p.lon) * (Math.PI / 180);
      x += Math.cos(lat) * Math.cos(lon);
      y += Math.cos(lat) * Math.sin(lon);
      z += Math.sin(lat);
    });
    x /= pois.length;
    y /= pois.length;
    z /= pois.length;
    if (Math.abs(x) < 1e-6 && Math.abs(y) < 1e-6 && Math.abs(z) < 1e-6) {
      return { lat: 0, lon: 0 };
    }
    const centralLon = Math.atan2(y, x);
    const centralSquareRoot = Math.sqrt(x * x + y * y);
    const centralLat = Math.atan2(z, centralSquareRoot);
    return {
      lat: centralLat * (180 / Math.PI),
      lon: centralLon * (180 / Math.PI),
    };
  }
  function createWorldTexture(geoJsonData) {
    const canvas = document.createElement("canvas");
    canvas.width = 4096;
    canvas.height = 2048;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#21425e";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#f0f4f8";
    ctx.strokeStyle = "#9ba4b5";
    ctx.lineWidth = 1.0;
    const projection = d3
      .geoEquirectangular()
      .translate([canvas.width / 2, canvas.height / 2])
      .scale(canvas.width / (2 * Math.PI));
    const path = d3.geoPath().projection(projection).context(ctx);
    geoJsonData.features.forEach((feature) => {
      ctx.beginPath();
      path(feature);
      ctx.fill();
      ctx.stroke();
    });
    return new THREE.CanvasTexture(canvas);
  }
  function initThree(geoJsonData) {
    if (!canvasElement || !dragZoneElement) return;
    scene = new THREE.Scene();
    tiltGroup = new THREE.Group();
    tiltGroup.rotation.z = 23.5 * (Math.PI / 180);
    scene.add(tiltGroup);
    earthGroup = new THREE.Group();
    earthGroup.rotation.y = 2.2;
    tiltGroup.add(earthGroup);
    earthGroup.add(poiGroup);
    const isMobile = window.innerWidth < 820;
    const spriteScale = isMobile ? 0.065 : 0.035;
    flatPois.forEach((poi) => {
      const sprite = new THREE.Sprite(defaultSpriteMat);
      sprite.position.copy(latLongToVector3(poi.lat, poi.lon, 1.02));
      sprite.scale.set(spriteScale, spriteScale, 1);
      poiGroup.add(sprite);
      poi.mesh = sprite;
    });
    camera = new THREE.PerspectiveCamera(
      45,
      globeWidth / globeHeight,
      0.1,
      1000,
    );
    camera.position.z = targetBaseZ;
    renderer = new THREE.WebGLRenderer({
      canvas: canvasElement,
      antialias: !isMobile,
      alpha: true,
    });
    renderer.setSize(globeWidth, globeHeight);
    renderer.setPixelRatio(
      isMobile ? 1 : Math.min(window.devicePixelRatio, 1.5),
    );
    if (THREE.SRGBColorSpace) {
      renderer.outputColorSpace = THREE.SRGBColorSpace;
    } else {
      renderer.outputEncoding = 3001;
    }
    controls = new OrbitControls(camera, dragZoneElement);
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.minDistance = 1.5;
    controls.maxDistance = 10.0;
    controls.autoRotate = false;
    controls.minAzimuthAngle = -Infinity;
    controls.maxAzimuthAngle = Infinity;
    controls.minPolarAngle = Math.PI * 0.25;
    controls.maxPolarAngle = Math.PI * 0.75;
    const mapTexture = createWorldTexture(geoJsonData);
    mapTexture.generateMipmaps = !isMobile;
    mapTexture.minFilter = isMobile
      ? THREE.LinearFilter
      : THREE.LinearMipmapLinearFilter;
    globeMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 32),
      new THREE.MeshBasicMaterial({
        map: mapTexture,
      }),
    );
    earthGroup.add(globeMesh);
    let frameCount = 0;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      frameCount++;
      if (!isFocusMode && !isAnimatingCamera && !hoveredPoi) {
        earthGroup.rotation.y += 0.0004;
      }
      if (isAnimatingCamera) {
        const currentRadius = THREE.MathUtils.lerp(
          startCamSpherical.radius,
          endCamSpherical.radius,
          $animationProgress,
        );
        const currentPhi = THREE.MathUtils.lerp(
          startCamSpherical.phi,
          endCamSpherical.phi,
          $animationProgress,
        );
        const currentTheta = THREE.MathUtils.lerp(
          startCamSpherical.theta,
          endCamSpherical.theta,
          $animationProgress,
        );
        const currentSpherical = new THREE.Spherical(
          currentRadius,
          currentPhi,
          currentTheta,
        );
        camera.position.setFromSpherical(currentSpherical);
        camera.lookAt(0, 0, 0);
      } else {
        controls.update();
      }
      earthGroup.updateMatrixWorld(true);
      if (frameCount % 3 === 0) {
        syncHtmlLabels();
      }
      renderer.render(scene, camera);
    };
    animate();
  }
  function syncHtmlLabels() {
    if (!camera || !earthGroup) return;
    const camPosNorm = camera.position.clone().normalize();
    const meshWorldPos = new THREE.Vector3();
    flatPois.forEach((poi, i) => {
      const element = poiElements[i];
      if (!element || !poi.mesh) return;
      meshWorldPos.copy(poi.mesh.position).applyMatrix4(earthGroup.matrixWorld);
      const dot = camPosNorm.dot(meshWorldPos.clone().normalize());
      if (dot > 0.1) {
        const vector = meshWorldPos.project(camera);
        const x = (vector.x * 0.5 + 0.5) * globeWidth;
        const y = (vector.y * -0.5 + 0.5) * globeHeight;
        element.style.display = "flex";
        const isRight = poi.align === "right";
        element.style.transform = `translate3d(${x}px, ${y - 10}px, 0px) translateX(${isRight ? "10px" : "calc(-100% - 10px)"})`;
        if (y > globeHeight - 200) {
          element.classList.add("flipUp");
        } else {
          element.classList.remove("flipUp");
        }
      } else {
        element.style.display = "none";
      }
    });
  }
  function handlePointerDown(event) {
    pointerDownPos = { x: event.clientX, y: event.clientY };
  }
  function handlePointerUp(event) {
    if (!camera || !globeCtnElement) return;
    const dist = Math.hypot(
      event.clientX - pointerDownPos.x,
      event.clientY - pointerDownPos.y,
    );
    if (dist > 5) return;
    if (
      event.target.closest(".detailTooltip") ||
      event.target.closest(".introBox") ||
      event.target.closest(".resetBtn")
    ) {
      return;
    }
    const rect = globeCtnElement.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const clickY = event.clientY - rect.top;
    let closestPoi = null;
    let minDistance = 30;
    const camPosNorm = camera.position.clone().normalize();
    const meshWorldPos = new THREE.Vector3();
    flatPois.forEach((poi) => {
      if (!poi.mesh) return;
      meshWorldPos.copy(poi.mesh.position).applyMatrix4(earthGroup.matrixWorld);
      const dot = camPosNorm.dot(meshWorldPos.clone().normalize());
      if (dot > 0.1) {
        const vector = meshWorldPos.project(camera);
        const px = (vector.x * 0.5 + 0.5) * globeWidth;
        const py = (vector.y * -0.5 + 0.5) * globeHeight;
        const pointDist = Math.hypot(px - clickX, py - clickY);
        if (pointDist < minDistance) {
          minDistance = pointDist;
          closestPoi = poi;
        }
      }
    });
    if (closestPoi) {
      if (closestPoi.showTooltip) {
        toggleTooltip(closestPoi.id);
      } else {
        handleLabelClick(closestPoi);
      }
    }
  }
  function handlePointerMove(event) {
    if (!camera || !globeCtnElement || isAnimatingCamera) return;
    const rect = globeCtnElement.getBoundingClientRect();
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;
    let foundPoi = null;
    let minDistance = 25;
    const camPosNorm = camera.position.clone().normalize();
    const meshWorldPos = new THREE.Vector3();
    flatPois.forEach((poi) => {
      if (!poi.mesh) return;
      meshWorldPos.copy(poi.mesh.position).applyMatrix4(earthGroup.matrixWorld);
      const dot = camPosNorm.dot(meshWorldPos.clone().normalize());
      if (dot > 0.1) {
        const vector = meshWorldPos.project(camera);
        const px = (vector.x * 0.5 + 0.5) * globeWidth;
        const py = (vector.y * -0.5 + 0.5) * globeHeight;
        const pointDist = Math.hypot(px - cursorX, py - cursorY);
        if (pointDist < minDistance) {
          minDistance = pointDist;
          foundPoi = poi;
        }
      }
    });
    hoveredPoi = foundPoi;
    if (dragZoneElement) {
      dragZoneElement.style.cursor = hoveredPoi
        ? "pointer"
        : isFocusMode
          ? "default"
          : "grab";
    }
  }
  function moveCameraTo(lat, lon, align = "center") {
    startCamSpherical.setFromVector3(camera.position);
    const localTarget = latLongToVector3(lat, lon, targetBaseZ);
    earthGroup.updateMatrixWorld();
    const worldTarget = localTarget.applyMatrix4(earthGroup.matrixWorld);
    endCamSpherical.setFromVector3(worldTarget);
    if (align !== "center") {
      const isMobile = window.innerWidth < 820;
      const thetaOffset = isMobile ? 0.4 : 0.25;
      const phiOffset = isMobile ? 0.2 : 0.1;
      if (align === "right") {
        endCamSpherical.theta += thetaOffset;
      } else if (align === "left") {
        endCamSpherical.theta -= thetaOffset;
      }
      endCamSpherical.phi += phiOffset;
      endCamSpherical.phi = Math.max(
        Math.PI * 0.25,
        Math.min(Math.PI * 0.75, endCamSpherical.phi),
      );
    }
    let thetaDiff = endCamSpherical.theta - startCamSpherical.theta;
    while (thetaDiff > Math.PI) thetaDiff -= Math.PI * 2;
    while (thetaDiff < -Math.PI) thetaDiff += Math.PI * 2;
    endCamSpherical.theta = startCamSpherical.theta + thetaDiff;
    animationProgress.set(0, { duration: 0 });
    isAnimatingCamera = true;
    animationProgress.set(1).then(() => {
      isAnimatingCamera = false;
    });
  }
  function handlePeriodClick(period) {
    const centerLatLon = calculateCenterOfPois(period.pois);
    isFocusMode = true;
    activePeriodId = period.id;
    moveCameraTo(centerLatLon.lat, centerLatLon.lon, "center");
  }
  function handleLabelClick(poi) {
    const targetPeriodId =
      isFocusMode && activePeriodId && poi.events[activePeriodId]
        ? activePeriodId
        : Object.keys(poi.events)[0];
    if (targetPeriodId !== activePeriodId) {
      isFocusMode = true;
      activePeriodId = targetPeriodId;
    }
    moveCameraTo(poi.lat, poi.lon, poi.align);
    flatPois = flatPois.map((p) => ({
      ...p,
      showTooltip: p.id === poi.id,
    }));
  }
  function resumeRotation() {
    activePeriodId = null;
    flatPois = flatPois.map((p) => ({ ...p, showTooltip: false }));
    startCamSpherical.setFromVector3(camera.position);
    const worldTarget = camera.position
      .clone()
      .normalize()
      .multiplyScalar(targetBaseZ);
    endCamSpherical.setFromVector3(worldTarget);
    let thetaDiff = endCamSpherical.theta - startCamSpherical.theta;
    while (thetaDiff > Math.PI) thetaDiff -= Math.PI * 2;
    while (thetaDiff < -Math.PI) thetaDiff += Math.PI * 2;
    endCamSpherical.theta = startCamSpherical.theta + thetaDiff;
    animationProgress.set(0, { duration: 0 });
    isAnimatingCamera = true;
    animationProgress.set(1).then(() => {
      isAnimatingCamera = false;
      isFocusMode = false;
    });
  }
  function toggleTooltip(poiId) {
    flatPois = flatPois.map((p) =>
      p.id === poiId
        ? { ...p, showTooltip: !p.showTooltip }
        : { ...p, showTooltip: false },
    );
  }
  function parseSheetData(data) {
    const rows = data.values;
    if (!rows || rows.length === 0) return { anmData: [], roni: [] };
    const dataRows = rows.slice(1);
    let anmData = [];
    let roni = [];
    dataRows.forEach((row) => {
      anmData.push({
        id: row[0] || "",
        yr_ssta: row[1] || "",
        anom_ssta: row[2] || "",
        ENSO: row[3] || "N",
        month: row[4] || "",
      });
      roni.push({
        SEAS: row[6] || "",
        YR: row[7] || "",
        desc: row[8] || "",
        ANOM: row[9] || "",
      });
    });
    return { anmData, roni };
  }
  function handleBarHover(event, d) {
    if (window.innerWidth < 820) return;
    hoveredBar = d;
    mousePos = { x: event.clientX, y: event.clientY };
  }
  function handleBarLeave() {
    hoveredBar = null;
  }
  $: if (renderer && camera && globeWidth && globeHeight) {
    camera.aspect = globeWidth / globeHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(globeWidth, globeHeight);
    if (!isFocusMode && !isAnimatingCamera) {
      camera.position.setLength(targetBaseZ);
    }
  }
  onMount(async () => {
    try {
      const isDev =
        import.meta.env?.DEV || window.location.hostname === "localhost";
      let targetUrl = jsonUrl;
      if (jsonUrl) {
        targetUrl = isDev
          ? jsonUrl.replace("https://multimedia.scmp.com", "/api/multimedia")
          : jsonUrl;
      }
      const fetchPromises = [fetch(SHEET_URL), fetch(GEOJSON_URL)];
      if (targetUrl) {
        fetchPromises.push(fetch(targetUrl));
      } else {
        throw new Error("No jsonUrl prop provided for highlights.");
      }
      const [sheetResponse, geoResponse, highlightResponse] =
        await Promise.all(fetchPromises);
      if (!sheetResponse.ok)
        throw new Error("Failed to fetch Google Sheets data.");
      if (!geoResponse.ok) throw new Error("Failed to fetch Globe data.");
      if (!highlightResponse.ok)
        throw new Error("Failed to fetch Highlight JSON.");
      const sheetJson = await sheetResponse.json();
      const geoJsonData = await geoResponse.json();
      const fetchedHighlights = await highlightResponse.json();
      const parsedData = parseSheetData(sheetJson);
      monthlyAnm = parsedData.anmData;
      roniData = parsedData.roni;
      highlightPeriods = fetchedHighlights;
      const locationMap = new Map();
      highlightPeriods.forEach((period) => {
        (period.pois || []).forEach((poi) => {
          const lat = parseFloat(poi.lat);
          const lon = parseFloat(poi.lon);
          const coordKey = `${lat.toFixed(4)}_${lon.toFixed(4)}`;
          if (!locationMap.has(coordKey)) {
            locationMap.set(coordKey, {
              id: `poi-${locationMap.size}`,
              location: poi.location || "Point",
              lat: lat,
              lon: lon,
              events: {},
              showTooltip: false,
              mesh: null,
            });
          }
          const locData = locationMap.get(coordKey);
          locData.events[period.id] = {
            periodId: period.id,
            periodLabel: period.label || "",
            media_type: poi.media_type || "",
            media_url: poi.media_url || "",
            caption_hd: poi.caption_hd || "",
            caption_body: poi.caption_body || "",
            scmp_article: (poi.scmp_article || []).map((article) => ({
              story_hd: article.story_hd || "",
              story_link: article.story_link || "",
            })),
          };
        });
      });
      flatPois = Array.from(locationMap.values()).map((p, index) => ({
        ...p,
        align: index % 2 === 0 ? "right" : "left",
      }));
      resolveOverlap(flatPois);
      isLoading = false;
      setTimeout(() => initThree(geoJsonData), 100);
    } catch (error) {
      errorMessage = error.message;
      isLoading = false;
    }
  });
  onDestroy(() => {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    if (renderer) renderer.dispose();
  });
  function yAxis(node, { scale, width }) {
    const draw = (s, w) => {
      const axis = d3.axisLeft(s).tickSize(-w);
      d3.select(node)
        .call(axis)
        .call((g) => g.select(".domain").remove())
        .call((g) =>
          g
            .selectAll(".tick line")
            .attr("stroke-dasharray", "1,2")
            .attr("stroke", "rgba(255, 255, 255, 0.1)"),
        );
    };
    draw(scale, width);
    return {
      update({ scale: newScale, width: newWidth }) {
        draw(newScale, newWidth);
      },
    };
  }
  function xAxis(node, { scale, data, screenW }) {
    function draw(s, d, w) {
      const currentYear = new Date().getFullYear();
      const step = w < 820 ? 10 : 5;
      let targetYears = [];
      for (let y = 1955; y <= 2025; y += step) {
        targetYears.push(y);
      }
      if (!targetYears.includes(currentYear)) {
        targetYears.push(currentYear);
      }
      const tickValues = d
        .filter(
          (item) =>
            item.month === 1 &&
            targetYears.includes(parseInt(item.yr_ssta, 10)),
        )
        .map((item) => item.key);
      const axis = d3
        .axisBottom(s)
        .tickValues(tickValues)
        .tickFormat((val) => val.split("-")[0]);
      const axisGroup = d3.select(node).call(axis);
      axisGroup.selectAll(".tick line").attr("y1", -5).attr("y2", 5);
      axisGroup.selectAll("text").attr("y", -15).style("text-anchor", "middle");
    }
    draw(scale, data, screenW);
    return {
      update({ scale: newScale, data: newData, screenW: newW }) {
        draw(newScale, newData, newW);
      },
    };
  }
</script>

<section class="tempSpatialCtn">
  {#if isLoading}
    <div class="statusMsg">Loading WebGL Scene components...</div>
  {:else if errorMessage}
    <div class="statusMsg error">{errorMessage}</div>
  {:else}
    {#if isFocusMode}
      <div class="uiWrapper">
        {#if activePeriod}
          <div class="introBox">
            <div class="introHd">{activePeriod.label}</div>
            <div class="introDesc">{activePeriod.event_desc}</div>
            {#if activePeriod.scmp_article && activePeriod.scmp_article.length > 1 && activePeriod.scmp_article[0].story_link !== ""}
              <div class="relatedArticleCtn">
                <div class="relatedArticleHd">Related Articles</div>
                {#each activePeriod.scmp_article as article}
                  <div class="relatedArticle">
                    <a
                      href={article.story_link}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <span>{article.story_hd}</span> &#10145
                    </a>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
        <button class="resetBtn" on:click={resumeRotation}>Return</button>
      </div>
    {/if}
    <div
      class="globeCtn"
      bind:this={globeCtnElement}
      bind:clientWidth={globeWidth}
      bind:clientHeight={globeHeight}
      on:pointerdown={handlePointerDown}
      on:pointerup={handlePointerUp}
      on:pointermove={handlePointerMove}
    >
      <canvas bind:this={canvasElement}></canvas>
      <div
        class="dragZone"
        bind:this={dragZoneElement}
        style="width: {dragSize}px; height: {dragSize}px;"
      ></div>
      <div class="globeLabelCtn">
        {#each flatPois as poi, i}
          <div
            bind:this={poiElements[i]}
            class="globeLabel {poi.align === 'left' ? 'alignLeft' : ''}"
            class:activeLabel={poi.showTooltip}
            class:focusHighlightLabel={isFocusMode &&
              activePeriodId &&
              poi.events[activePeriodId]}
            style="display: none;"
          >
            {#if poi.showTooltip}
              {@const activeEvent =
                isFocusMode && poi.events[activePeriodId]
                  ? poi.events[activePeriodId]
                  : Object.values(poi.events)[0]}
              <div
                class="detailTooltip"
                transition:scale={{ duration: 350, start: 0.1, opacity: 0 }}
              >
                <button
                  class="shrinkArrowBtn"
                  on:click|stopPropagation={() => toggleTooltip(poi.id)}
                  aria-label="Close details"
                >
                  &#10005;
                </button>
                <div>
                  {#if activeEvent.media_url !== ""}
                    <div class="tlpMediaCtn">
                      {#if activeEvent.media_type === "image"}
                        <img
                          src={activeEvent.media_url}
                          alt={activeEvent.caption_hd}
                        />
                      {:else}
                        <video
                          bind:this={poi.videoRef}
                          src={activeEvent.media_url}
                          playsinline
                          muted
                          loop
                        ></video>
                        <button
                          class="playBtn"
                          on:click={() => {
                            const v = poi.videoRef;
                            v.paused ? v.play() : v.pause();
                            flatPois = flatPois;
                          }}>{poi.videoRef?.paused ? "▶" : "⏸"}</button
                        >
                      {/if}
                    </div>
                  {/if}
                  <div>
                    <div class="tlpHd">
                      {activeEvent.caption_hd
                        ? activeEvent.caption_hd
                        : poi.location}
                    </div>
                    <div class="tlpbody">{activeEvent.caption_body}</div>
                  </div>
                </div>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
    <div
      class="chartCtn"
      bind:clientWidth={width}
      bind:clientHeight={height}
      style="position: relative;"
    >
      <div class="noteCtn">
        <div class="note">Click for details</div>
        <div class="arrow ds">&#10551</div>
        <div class="arrow mb">&#10549</div>
      </div>
      {#if width > 0 && height > 0 && chartData.length > 0}
        <div class="htmlRefCtn">
          {#each [{ val: 0.5, label: "weak" }, { val: 1.0, label: "moderate" }, { val: 1.5, label: "strong" }, { val: 2.0, label: "very strong" }, { val: -0.5, label: "weak" }, { val: -1.0, label: "moderate" }, { val: -1.5, label: "strong" }, { val: -2.0, label: "very strong" }] as ref}
            <div
              class="refHtmlLabel"
              style="top: {margin.top + yScale(ref.val)}px;"
            >
              {ref.label}
            </div>
          {/each}
        </div>
        <svg {width} {height}>
          <g transform={`translate(${margin.left}, ${margin.top})`}>
            <g class="highlightLayer">
              {#each highlightBoxes as box}
                <rect
                  class="highlightBox"
                  class:activeHighlight={activePeriodId === box.id}
                  x={box.x}
                  y={box.event_type === "El Nino" ? 0 : yScale(0)}
                  width={box.width}
                  height={box.event_type === "El Nino"
                    ? yScale(0)
                    : innerHeight - yScale(0)}
                  role="button"
                  tabindex="0"
                  on:click={() => handlePeriodClick(box)}
                  on:keydown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handlePeriodClick(box);
                    }
                  }}
                />
                <text
                  x={box.x}
                  y={box.event_type === "El Nino" ? -30 : innerHeight + 30}
                  class="highlightText"
                  class:activeTxt={activePeriodId === box.id}
                  text-anchor="start"
                  id={box.id}
                >
                  <tspan x={box.x} dy="0">{box.labelYear}</tspan>
                  <tspan x={box.x} dy="1.2em">{box.labelEvent}</tspan>
                </text>
              {/each}
            </g>
            <g class="axisCtn">
              <g
                class="axis yAxis"
                use:yAxis={{ scale: yScale, width: innerWidth }}
              ></g>
              <g
                class="axis xAxis"
                transform={`translate(0, ${innerHeight})`}
                use:xAxis={{ scale: xScale, data: chartData, screenW: width }}
              ></g>
              <line
                x1="0"
                x2={innerWidth}
                y1={yScale(0)}
                y2={yScale(0)}
                stroke="white"
                stroke-width="2"
              />
              <g class="customReferenceLines">
                {#each [0.5, 1.0, 1.5, 2.0, -0.5, -1.0, -1.5, -2.0] as val}
                  <line
                    x1="0"
                    x2={innerWidth}
                    y1={yScale(val)}
                    y2={yScale(val)}
                    stroke="rgba(255, 255, 255, 0.1)"
                    stroke-dasharray="1,6"
                    stroke-width="1"
                  />
                {/each}
              </g>
            </g>
            <g class="barLayer">
              {#each chartData as d}
                <rect
                  class="bar"
                  x={xScale(d.key)}
                  y={Math.min(yScale(d.anom_ssta), yScale(0))}
                  width={xScale.bandwidth()}
                  height={Math.abs(yScale(d.anom_ssta) - yScale(0))}
                  fill={"#E0E0E0"}
                  on:mouseenter={(e) => handleBarHover(e, d)}
                  on:mousemove={(e) => handleBarHover(e, d)}
                  on:mouseleave={handleBarLeave}
                  style="cursor: pointer;"
                  role="graphics-symbol"
                />
              {/each}
            </g>
            <g class="roniAvglayer">
              {#if roniPath}
                <path
                  d={roniPath}
                  stroke="rgba(255, 255, 255, 0.6)"
                  stroke-width="1"
                  fill="none"
                />
              {/if}
            </g>
          </g>
        </svg>
      {/if}
    </div>
    {#if hoveredBar}
      <div
        class="barTooltip"
        style="left: {mousePos.x + 15}px; top: {mousePos.y + 15}px;"
      >
        <div class="barHd">
          {MONTH_NAMES[hoveredBar.month - 1]}
          {hoveredBar.yr_ssta}
        </div>
        <div class="barBd">
          {ENSO_MAPPING[hoveredBar.ENSO]?.desc || "Neutral"}
        </div>
      </div>
    {/if}
  {/if}
</section>

<style>
  :global(html),
  :global(body) {
    overflow-x: hidden;
    overflow-y: auto !important;
    padding: 0;
    min-width: 290px;
    max-width: 1440px;
  }
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    font-family: "Barlow Semi Condensed", sans-serif;
    font-weight: 400;
    font-size: 14px;
  }
  a,
  button {
    background: none;
    color: inherit;
    border: none;
    padding: 0;
    font: inherit;
    pointer-events: auto;
    cursor: pointer;
    outline: inherit;
    text-decoration: none;
  }
  video::-webkit-media-controls {
    display: none !important;
  }
  .tempSpatialCtn {
    background-color: #21425e;
    height: 90vh;
    width: 100%;
    gap: 30px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    position: relative;
  }
  .uiWrapper {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 20;
  }
  .uiWrapper > * {
    pointer-events: auto;
  }
  .chartCtn {
    width: 100%;
    height: 35%;
    flex-shrink: 0;
    top: 0;
  }
  .htmlRefCtn {
    position: absolute;
    top: 0;
    left: 20px;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 5;
  }
  .refHtmlLabel {
    position: absolute;
    left: 0;
    color: rgba(255, 255, 255, 0.6);
    font-size: 10px;
    transform: translateY(-50%);
    pointer-events: none;
  }
  .globeCtn {
    width: 100%;
    flex-grow: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    top: 0px;
  }
  .dragZone {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    cursor: grab;
    z-index: 10;
  }
  .dragZone:active {
    cursor: grabbing;
  }
  .globeLabelCtn {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    overflow: hidden;
    z-index: 10;
  }
  .globeLabel {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: top left;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    pointer-events: none;
    z-index: 15;
  }
  .globeLabel.focusHighlightLabel {
    z-index: 50;
  }
  .globeLabel.alignLeft {
    align-items: flex-end;
  }
  .globeLabel.alignLeft .detailTooltip {
    transform-origin: top right;
  }
  .globeLabel.activeLabel {
    z-index: 100;
  }
  .yAxis :global(.tick text),
  .xAxis :global(.tick text),
  .xAxis :global(.tick line),
  .yAxis :global(.tick line) {
    fill: #e0e0e081;
    stroke: #e0e0e07b;
    font-size: 10px;
  }
  .axis :global(path) {
    stroke: #e0e0e0a0;
  }
  .highlightBox {
    fill: rgba(255, 255, 255, 0.36);
    stroke: rgba(255, 255, 255, 0.429);
    cursor: pointer;
    transition: all 0.3s ease;
  }
  .highlightBox:hover,
  .highlightBox:focus,
  .highlightBox.activeHighlight {
    fill: #c03e48;
    stroke-width: 1.5;
    stroke-dasharray: none;
    outline: none;
  }
  .highlightText tspan {
    fill: #ffffff;
    pointer-events: none;
    transition: fill 0.3s;
    font-weight: 400;
    font-size: 12px;
  }
  text#evt15 {
    text-anchor: middle;
  }
  .introBox {
    position: absolute;
    left: 5vw;
    top: 25vh;
    width: 260px;
    max-width: 90vw;
    color: white;
    border-radius: 6px;
    z-index: 10;
    background: #21425ee9;
    box-shadow: 0 4px 30px rgba(0, 0, 0, 0.1);
    backdrop-filter: blur(5.2px);
    -webkit-backdrop-filter: blur(5.2px);
    padding: 10px;
    animation: slideIn 0.5s cubic-bezier(0.25, 1, 0.5, 1) forwards;
  }
  .introHd {
    font-weight: 600;
    margin-bottom: 4px;
  }
  .relatedArticleHd {
    font-weight: 600;
    margin-bottom: 4px;
    margin-top: 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.2);
  }
  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translate(-20px, -50%);
    }
    to {
      opacity: 1;
      transform: translate(0, -50%);
    }
  }
  .detailTooltip {
    position: absolute;
    top: 0;
    color: #ffffff;
    background: #21425ee9;
    box-shadow: 0 4px 30px rgba(0, 0, 0, 0.1);
    backdrop-filter: blur(5.2px);
    -webkit-backdrop-filter: blur(5.2px);
    border-radius: 4px;
    width: 260px;
    max-width: 85vw;
    padding: 10px;
    z-index: 100;
    transform-origin: top left;
  }
  .shrinkArrowBtn {
    position: absolute;
    top: 6px;
    right: 8px;
    color: rgba(255, 255, 255, 0.7);
    font-size: 14px;
    transition:
      color 0.2s ease,
      transform 0.2s ease;
    z-index: 5;
  }
  .shrinkArrowBtn:hover {
    color: white;
  }
  .tlpHd {
    font-weight: 600;
    margin-bottom: 4px;
  }
  .tlpMediaCtn {
    position: relative;
    margin-top: 12px;
    border-radius: 4px;
    overflow: hidden;
    width: 100%;
    aspect-ratio: 16/9;
    object-fit: cover;
  }
  .playBtn {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 40px;
    height: 40px;
    background: #ffffff47;
    color: #21425e;
    border-radius: 50%;
    font-size: 18px;
    border: none;
    cursor: pointer;
  }
  .tlpMediaCtn img,
  .tlpMediaCtn video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 4px;
  }
  .relatedArticle {
    width: 100%;
    margin: 3px 0;
  }
  .relatedArticle a {
    display: flex;
    flex-direction: row;
    flex-wrap: nowrap;
    align-content: center;
    justify-content: space-between;
    align-items: center;
  }
  .relatedArticle a span {
    width: 90%;
    text-overflow: ellipsis;
    text-wrap: nowrap;
    overflow: hidden;
    display: inline-block;
  }
  .resetBtn {
    position: absolute;
    padding: 0.5rem 1rem;
    top: 20px;
    right: 20px;
    z-index: 10;
    color: white;
    border-radius: 4px;
    border: 1px solid #ffffff;
    font-weight: 400;
    cursor: pointer;
    transition: background 0.2s;
  }
  .resetBtn:hover {
    background: #c03e48;
  }
  .statusMsg {
    color: #e0e0e0;
    margin: 30% auto;
    font-size: 16px;
    font-weight: 400;
    text-align: center;
  }
  .noteCtn {
    color: #ffffffae;
    font-style: italic;
    width: fit-content;
    display: flex;
    flex-direction: column;
    flex-wrap: nowrap;
    align-content: flex-start;
    align-items: flex-end;
    justify-content: center;
    left: 20px;
    position: absolute;
  }
  .noteCtn .arrow {
    font-size: 20px;
  }
  .error {
    color: #c03e48;
  }
  .barTooltip {
    position: fixed;
    background: #21425ee9;
    color: #fff;
    padding: 5px;
    border-radius: 6px;
    pointer-events: none;
    z-index: 20;
    width: 80px;
  }
  .barHd {
    font-weight: 300;
    margin-bottom: 4px;
  }
  .noteCtn .ds {
    display: block;
  }
  .noteCtn .mb {
    display: none;
  }
  @media (max-width: 1250px) {
    .introBox {
      left: 10px;
      top: 60px;
    }
  }
  @media (max-width: 1100px) {
    .highlightText tspan,
    .noteCtn {
      font-size: 12px;
    }
    .noteCtn {
      width: 50px;
    }
  }
  @media (max-width: 600px) {
    .noteCtn .ds {
      display: none;
    }
    .noteCtn .mb {
      display: block;
    }
    .introBox {
      transform: none;
      width: 70%;
      max-width: none;
    }
    .globeCtn {
      top: 70px;
    }
    .chartCtn {
      top: 80px;
    }
    .noteCtn {
      left: 20px;
      top: -10px;
      width: fit-content;
    }
    .resetBtn {
      top: 10px;
      right: 10px;
    }
    .detailTooltip {
      width: 240px;
      max-width: 85vw;
    }
    .highlightBox,
    .highlightBox:hover,
    .highlightBox:focus,
    .highlightBox.activeHighlight {
      stroke-width: 2.5;
    }
    * {
      font-size: 12px;
    }
    .htmlRefCtn {
      display: none;
    }
    .highlightText {
      display: none;
    }
  }
</style>
