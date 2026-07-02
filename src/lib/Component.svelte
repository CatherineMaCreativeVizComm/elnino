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

  const monthToSeas = {
    1: "DJF",
    2: "JFM",
    3: "FMA",
    4: "MAM",
    5: "AMJ",
    6: "MJJ",
    7: "JJA",
    8: "JAS",
    9: "ASO",
    10: "SON",
    11: "OND",
    12: "NDJ",
  };

  const ENSO_MAPPING = {
    VSE: { value: 4, desc: "Very Strong El Nino", color: "#AA513B" },
    SE: { value: 3, desc: "Strong El Nino", color: "#FF4500" },
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

  let countryLabels = [];
  let countryLabelElements = [];

  let isLoading = true;
  let errorMessage = "";

  let width = 0,
    height = 0;
  const margin = { top: 40, right: 15, bottom: 60, left: 20 };

  $: innerWidth = Math.max(0, width - margin.left - margin.right);
  $: innerHeight = Math.max(0, height - margin.top - margin.bottom);

  let canvasElement;
  let dragZoneElement;
  let globeWidth = 0,
    globeHeight = 0;
  let renderer, scene, camera, controls;
  let tiltGroup, earthGroup, globeMesh;
  let poiGroup = new THREE.Group();
  let labelGroup = new THREE.Group();
  let animationFrameId;

  let isFocusMode = false;
  let isHoveringLabel = false;
  let activePeriodId = null;
  $: activePeriod = highlightPeriods.find((p) => p.id === activePeriodId);

  let isAnimatingCamera = false;
  let startCamPos = new THREE.Vector3();
  let endCamPos = new THREE.Vector3();
  const animationProgress = tweened(0, { duration: 1200, easing: cubicInOut });

  const poiGeometry = new THREE.SphereGeometry(0.01, 16, 16);
  const greyMaterial = new THREE.MeshBasicMaterial({ color: 0xaaaaaa });
  const redMaterial = new THREE.MeshBasicMaterial({ color: 0xaa513b });

  const HK_LAT_LON = { lat: 22.3193, lon: 114.1694 };

  let hoveredBar = null;
  let mousePos = { x: 0, y: 0 };

  $: dragSize = Math.min(globeWidth, globeHeight) * 0.82;

  $: aspect = globeWidth > 0 && globeHeight > 0 ? globeWidth / globeHeight : 1;
  $: targetBaseZ = aspect < 1 ? 2.8 / aspect : 2.8;

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

      return {
        ...period,
        x: xScale(barsInPeriod[0].key),
        width:
          xScale(barsInPeriod[barsInPeriod.length - 1].key) +
          xScale.bandwidth() -
          xScale(barsInPeriod[0].key),
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

  $: updateMeshColors(isFocusMode, activePeriodId, flatPois);

  function updateMeshColors(focus, periodId, pois) {
    const isMobile = window.innerWidth < 820;

    if (pois && pois.length > 0) {
      pois.forEach((poi) => {
        if (poi.mesh) {
          const belongsToActivePeriod = focus && poi.events[periodId];
          poi.mesh.material = belongsToActivePeriod
            ? redMaterial
            : greyMaterial;

          if (focus && isMobile && !belongsToActivePeriod) {
            poi.mesh.visible = false;
          } else {
            poi.mesh.visible = true;
          }
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
    const iterations = 50;
    const minDist = 4.0;
    for (let k = 0; k < iterations; k++) {
      for (let i = 0; i < pois.length; i++) {
        for (let j = i + 1; j < pois.length; j++) {
          let dx = pois[i].lon - pois[j].lon;
          let dy = pois[i].lat - pois[j].lat;
          let dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < minDist) {
            if (dist === 0) {
              dx = Math.random() - 0.5;
              dy = Math.random() - 0.5;
              dist = Math.sqrt(dx * dx + dy * dy);
            }
            const overlap = minDist - dist;
            const pushX = (dx / dist) * (overlap / 2);
            const pushY = (dy / dist) * (overlap / 2);

            pois[i].lon += pushX;
            pois[i].lat += pushY;
            pois[j].lon -= pushX;
            pois[j].lat -= pushY;
          }
        }
      }
    }
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
    ctx.fillStyle = "#153b65";
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

    ctx.fillStyle = "#000";
    const projectedHk = projection([HK_LAT_LON.lon, HK_LAT_LON.lat]);
    ctx.beginPath();
    ctx.arc(projectedHk[0], projectedHk[1], 4, 0, 2 * Math.PI);
    ctx.fill();

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
    earthGroup.add(labelGroup);

    flatPois.forEach((poi) => {
      const mesh = new THREE.Mesh(poiGeometry, greyMaterial);
      mesh.position.copy(latLongToVector3(poi.lat, poi.lon, 1.01));
      poiGroup.add(mesh);
      poi.mesh = mesh;
    });

    const sharedLabelGeo = new THREE.SphereGeometry(0.001, 4, 4);
    const sharedLabelMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      visible: false,
    });

    countryLabels.forEach((label) => {
      const mesh = new THREE.Mesh(sharedLabelGeo, sharedLabelMat);
      mesh.position.copy(latLongToVector3(label.lat, label.lon, 1.01));
      labelGroup.add(mesh);
      label.mesh = mesh;
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
      antialias: true,
      alpha: true,
    });
    renderer.setSize(globeWidth, globeHeight);

    const isMobile = window.innerWidth < 820;
    renderer.setPixelRatio(
      isMobile ? 1 : Math.min(window.devicePixelRatio, 1.5),
    );

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

    controls.addEventListener("start", () => {
      if (flatPois.some((p) => p.showTooltip)) {
        flatPois = flatPois.map((p) => ({ ...p, showTooltip: false }));
      }
    });

    const mapTexture = createWorldTexture(geoJsonData);
    mapTexture.generateMipmaps = true;
    mapTexture.minFilter = THREE.LinearMipmapLinearFilter;

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

      if (!isFocusMode && !isAnimatingCamera && !isHoveringLabel) {
        earthGroup.rotation.y += 0.0004;
      }

      if (isAnimatingCamera) {
        const startRadius = startCamPos.length();
        const endRadius = endCamPos.length();
        const currentRadius = THREE.MathUtils.lerp(
          startRadius,
          endRadius,
          $animationProgress,
        );

        camera.position
          .copy(startCamPos)
          .lerp(endCamPos, $animationProgress)
          .normalize()
          .multiplyScalar(currentRadius);
        camera.lookAt(0, 0, 0);
      } else {
        controls.update();
      }

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
    const isMobile = window.innerWidth < 820;

    flatPois.forEach((poi, i) => {
      const element = poiElements[i];
      if (!element || !poi.mesh) return;

      const belongsToActivePeriod =
        isFocusMode && activePeriodId && poi.events[activePeriodId];
      if (isFocusMode && isMobile && !belongsToActivePeriod) {
        element.style.display = "none";
        return;
      }

      poi.mesh.getWorldPosition(meshWorldPos);

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

    [...countryLabels].forEach((label, i) => {
      const element = countryLabelElements[i];
      if (!element || !label.mesh) return;
      label.mesh.getWorldPosition(meshWorldPos);

      const dot = camPosNorm.dot(meshWorldPos.clone().normalize());
      if (dot > 0.05) {
        const vector = meshWorldPos.project(camera);
        const x = (vector.x * 0.5 + 0.5) * globeWidth;
        const y = (vector.y * -0.5 + 0.5) * globeHeight;
        const xOffset = label.name === "Hong Kong" ? 10 : 0;
        const yOffset = label.name === "Hong Kong" ? -10 : -8;
        if (isFocusMode && isMobile) {
          element.style.display = "none";
        } else {
          element.style.display = "block";
          element.style.transform = `translate3d(${x + xOffset}px, ${y + yOffset}px, 0px)`;
        }
      } else {
        element.style.display = "none";
      }
    });
  }

  function moveCameraTo(lat, lon) {
    startCamPos.copy(camera.position);

    const localTarget = latLongToVector3(lat, lon, targetBaseZ);

    earthGroup.updateMatrixWorld();
    const worldTarget = localTarget.applyMatrix4(earthGroup.matrixWorld);
    endCamPos.copy(worldTarget);

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
    moveCameraTo(centerLatLon.lat, centerLatLon.lon);
  }

  function handleLabelClick(poi) {
    if (poi.events["hk_anchor"]) return;
    const targetPeriodId =
      isFocusMode && activePeriodId && poi.events[activePeriodId]
        ? activePeriodId
        : Object.keys(poi.events)[0];

    if (targetPeriodId !== activePeriodId) {
      isFocusMode = true;
      activePeriodId = targetPeriodId;
    }
    moveCameraTo(poi.lat, poi.lon);

    flatPois = flatPois.map((p) => ({
      ...p,
      showTooltip: p.id === poi.id,
    }));
  }

  function resumeRotation() {
    activePeriodId = null;
    flatPois = flatPois.map((p) => ({ ...p, showTooltip: false }));
    startCamPos.copy(camera.position);
    endCamPos.copy(camera.position).normalize().multiplyScalar(targetBaseZ);

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

      const parsedCountries = (geoJsonData.features || [])
        .map((feature) => {
          const name = feature.properties.name || feature.properties.ADMIN;
          if (name === "Taiwan" || !name) return null;
          if (name === "Hong Kong") return null;
          const centroid = d3.geoCentroid(feature);
          return { name, lat: centroid[1], lon: centroid[0], mesh: null };
        })
        .filter(Boolean);

      const hkAnchor = {
        id: `hk_anchor`,
        media_type: "hk_anchor",
        location: "Hong Kong",
        lat: HK_LAT_LON.lat,
        lon: HK_LAT_LON.lon,
        name: "Hong Kong",
        mesh: null,
      };

      countryLabels = [...parsedCountries, hkAnchor];
      highlightPeriods = fetchedHighlights;

      const locationMap = new Map();
      highlightPeriods.forEach((period) => {
        (period.pois || []).forEach((poi) => {
          const loc = poi.location || "Point";
          if (!locationMap.has(loc)) {
            locationMap.set(loc, {
              id: `poi-${locationMap.size}`,
              location: loc,
              lat: parseFloat(poi.lat),
              lon: parseFloat(poi.lon),
              events: {},
              showTooltip: false,
              mesh: null,
            });
          }
          const locData = locationMap.get(loc);
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
      setTimeout(() => initThree(geoJsonData), 50);
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
    <div
      class="globeCtn"
      bind:clientWidth={globeWidth}
      bind:clientHeight={globeHeight}
    >
      <canvas bind:this={canvasElement}></canvas>

      <div
        class="dragZone"
        bind:this={dragZoneElement}
        style="width: {dragSize}px; height: {dragSize}px;"
      ></div>

      {#if isFocusMode && activePeriod}
        <div class="introBox">
          <div class="scrollContent">
            <div class="introHd">{activePeriod.label}</div>
            <div class="introDesc">{activePeriod.event_desc}</div>
            {#if activePeriod.scmp_article && activePeriod.scmp_article.length > 0}
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
        </div>
      {/if}

      {#if isFocusMode}
        <button class="resetBtn" on:click={resumeRotation}>Return</button>
      {/if}

      <div class="globeLabelCtn">
        {#each flatPois as poi, i}
          <div
            bind:this={poiElements[i]}
            class="globeLabel {poi.align === 'left' ? 'alignLeft' : ''}"
            class:activeLabel={poi.showTooltip}
            style="display: none;"
          >
            {#if !poi.showTooltip}
              <button
                class="globeLabelBtn"
                on:click={() => handleLabelClick(poi)}
                on:mouseenter={() => (isHoveringLabel = true)}
                on:mouseleave={() => (isHoveringLabel = false)}
              >
                {poi.location}
              </button>
            {:else}
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

                <div class="scrollContent">
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

                    {#if activeEvent.scmp_article && activeEvent.scmp_article.length > 0 && activeEvent.scmp_article[0].story_link !== ""}
                      <div class="relatedArticleCtn">
                        <div class="relatedArticleHd">Related Articles</div>
                        {#each activeEvent.scmp_article as article}
                          {#if article.story_link !== ""}
                            <div class="relatedArticle">
                              <a
                                href={article.story_link}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <span>{article.story_hd}</span>&#10145
                              </a>
                            </div>
                          {/if}
                        {/each}
                      </div>
                    {/if}
                  </div>
                </div>
              </div>
            {/if}
          </div>
        {/each}

        <!-- <div>
          {#each countryLabels as label, i}
            <div
              bind:this={countryLabelElements[i]}
              class="countryLabel"
              class:hkAnchorLabel={label.name === "Hong Kong"}
              style="display: none;"
            >
              {label.name}
            </div>
          {/each}
        </div> -->
      </div>
    </div>

    <div
      class="chartCtn"
      bind:clientWidth={width}
      bind:clientHeight={height}
      style="position: relative;"
    >
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
                  y={box.event_type === "El Nino" ? -20 : yScale(0)}
                  width={box.width}
                  height={box.event_type === "El Nino"
                    ? yScale(0) + 20
                    : innerHeight - yScale(0) + 20}
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
                  x={box.x + box.width / 2}
                  y={box.event_type === "El Nino" ? -28 : innerHeight + 35}
                  class="highlightText"
                  class:activeTxt={activePeriodId === box.id}
                  text-anchor="middle"
                >
                  {box.label}
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
                    stroke="rgba(255, 255, 255, 0.4)"
                    stroke-dasharray="1,2"
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
    margin: 0;
    padding: 0;
    min-width: 290px;
    max-width: 1440px;
  }
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    font-family: "Barlow Semi Condensed", sans-serif;
    font-weight: 100;
    font-size: 12px;
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
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: none;
    text-decoration: none;
  }

  video::-webkit-media-controls {
    display: none !important;
  }

  .tempSpatialCtn {
    background-color: #153b65;
    height: 90vh;
    width: 100%;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
  }
  .chartCtn {
    width: 100%;
    height: 35%;
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
    transform: translateY(-50%);
    color: #e0e0e0;
    font-size: 10px;
  }

  .globeCtn {
    width: 100%;
    height: 65%;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    position: relative;
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

  .globeLabel.alignLeft {
    align-items: flex-end;
  }

  .globeLabel.alignLeft .detailTooltip {
    transform-origin: top right;
  }

  .globeLabel.activeLabel {
    z-index: 100;
  }

  .globeLabelBtn {
    background: rgba(18, 59, 101, 0.9);
    padding: 3px;
    color: #fff;
    border-radius: 4px;
    transition:
      background 0.2s ease,
      border-color 0.2s ease;
  }

  /* .countryLabel {
    position: absolute;
    font-size: 10px;
    font-weight: 100;
    color: rgba(0, 0, 0, 0);
    white-space: nowrap;
    pointer-events: none;
  }

  .hkAnchorLabel {
    color: #153b65;
    font-weight: 600;
    font-size: 12px;
  } */

  .yAxis :global(.tick text),
  .xAxis :global(.tick text),
  .xAxis :global(.tick line),
  .yAxis :global(.tick line) {
    fill: #e0e0e0;
    stroke: #e0e0e0;
    font-size: 10px;
  }
  .axis :global(path) {
    stroke: #e0e0e0;
  }

  .highlightBox {
    fill: rgba(255, 255, 255, 0.219);
    stroke: rgba(255, 255, 255, 0.429);
    stroke-dasharray: 1 2;
    cursor: pointer;
    transition: all 0.3s ease;
  }
  .highlightBox:hover,
  .highlightBox:focus,
  .highlightBox.activeHighlight {
    fill: #ff4500;
    stroke-width: 1.5;
    stroke-dasharray: none;
    outline: none;
  }
  .highlightText {
    fill: #ffffff;
    font-weight: 600;
    font-size: 12px;
    pointer-events: none;
    transition: fill 0.3s;
  }

  .introBox {
    position: absolute;
    left: 40px;
    top: 50%;
    transform: translateY(-50%);
    width: 260px;
    max-width: 90vw;
    color: white;
    border-radius: 6px;
    z-index: 10;
    background: rgba(18, 59, 101, 0.6);
    padding: 10px;
    animation: slideIn 0.5s cubic-bezier(0.25, 1, 0.5, 1) forwards;
  }

  .introHd {
    font-weight: 600;
    font-size: 14px;
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
    background: rgba(18, 59, 101, 0.95);
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
    color: #153b65;
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
    background: #ff4500;
  }

  .statusMsg {
    color: #e0e0e0;
    padding: 2rem;
    font-size: 1.5rem;
    text-align: center;
  }
  .error {
    color: #ff4500;
  }

  .barTooltip {
    position: fixed;
    background: rgba(18, 59, 101, 0.85);
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

  @media (max-width: 820px) {
    .introBox,
    .detailTooltip {
      width: 150px;
      height: 100px;
      display: flex;
      flex-direction: column;
      padding: 5px;
      pointer-events: auto;
    }

    .scrollContent {
      overflow-y: auto;
      flex: 1;
      height: 90px;
      overflow-x: hidden;
    }

    .introBox {
      left: 10px;
      top: 15%;
      transform: none;
    }
    .introBox::after,
    .detailTooltip::after {
      content: "";
      position: fixed;
      bottom: 0;
      left: 0;
      width: 100%;
      height: 15px;
      background: linear-gradient(
        to bottom,
        rgba(18, 59, 101, 0),
        rgba(18, 59, 101, 0.95)
      );
      pointer-events: none;
    }

    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateY(-20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
  }
</style>
