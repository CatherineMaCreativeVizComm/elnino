<svelte:options customElement={{ tag: "elnino-wgc", shadow: "open" }} />

<script>
  import { onMount, onDestroy } from "svelte";
  import * as d3 from "d3";
  import * as THREE from "three";
  import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
  import { tweened } from "svelte/motion";
  import { cubicInOut } from "svelte/easing";

  const SHEET_ID = "1Vm6vxrxc9Y6-coeX2o2rSsnYmMO4NBubSP40Jn59Yuw";
  const API_KEY = "AIzaSyAPauL7gS0wK5bi9QVEbhjkzjwppBBU5_U";
  const RANGE = "data!A1:L2000";
  const SHEET_URL = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${RANGE}?key=${API_KEY}`;
  const GEOJSON_URL =
    "https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson";
  const EARTH_NORMAL_URL =
    "https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_normal_2048.jpg";

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
    VSE: { value: 4, desc: "Very Strong El Nino", color: "#FF004D" },
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

  let isLoading = true;
  let errorMessage = "";

  let width = 0,
    height = 0;
  // Adjusted margins to fit the new text labels and axis title
  const margin = { top: 40, right: 70, bottom: 60, left: 50 };
  $: innerWidth = Math.max(0, width - margin.left - margin.right);
  $: innerHeight = Math.max(0, height - margin.top - margin.bottom);

  let canvasElement;
  let dragZoneElement;
  let globeWidth = 0,
    globeHeight = 0;
  let renderer, scene, camera, controls;
  let tiltGroup, earthGroup, globeMesh;
  let poiGroup = new THREE.Group();
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
  const poiMaterial = new THREE.MeshBasicMaterial({ color: 0xff004d });

  $: dragSize = Math.min(globeWidth, globeHeight) * 0.72;

  $: xScale = d3
    .scaleBand()
    .domain(chartData.map((d) => d.key))
    .range([0, innerWidth])
    .padding(0.1);
  $: yExtent = d3.extent(chartData, (d) => d.anom_ssta) || [0, 0];
  $: yScale = d3
    .scaleLinear()
    .domain([Math.min(-2.5, yExtent[0]), Math.max(2.5, yExtent[1])]) // Ensure scale fits reference lines
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

  // Mapped roniData into coordinates and created a continuous line path
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
        x: x1 + (x2 - x1) / 2 + xScale.bandwidth() / 2, // Centered point
        y: yScale(parseFloat(d.ANOM)),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.x - b.x);

  $: roniPath = roniPoints.length > 0 
    ? d3.line().x((d) => d.x).y((d) => d.y)(roniPoints) 
    : null;

  function latLongToVector3(lat, lon, radius) {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lon + 90) * (Math.PI / 180);
    return new THREE.Vector3(
      -(radius * Math.sin(phi) * Math.cos(theta)),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.sin(theta),
    );
  }

  function calculateCenterOfPois(pois) {
    if (!pois || pois.length === 0) return { lat: 0, lon: 0 };
    return {
      lat: pois.reduce((sum, p) => sum + parseFloat(p.lat), 0) / pois.length,
      lon: pois.reduce((sum, p) => sum + parseFloat(p.lon), 0) / pois.length,
    };
  }

  function createWorldTexture(geoJsonData) {
    const canvas = document.createElement("canvas");
    canvas.width = 2048;
    canvas.height = 1024;

    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#cce0ff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#f7f8fa";
    ctx.strokeStyle = "#d2d4d6";
    ctx.lineWidth = 1;

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
    tiltGroup.add(earthGroup);
    earthGroup.add(poiGroup);

    flatPois.forEach((poi) => {
      const mesh = new THREE.Mesh(poiGeometry, poiMaterial);
      mesh.position.copy(latLongToVector3(poi.lat, poi.lon, 1.01));
      poiGroup.add(mesh);
      poi.mesh = mesh;
    });

    camera = new THREE.PerspectiveCamera(
      45,
      globeWidth / globeHeight,
      0.1,
      1000,
    );
    camera.position.z = 3;

    renderer = new THREE.WebGLRenderer({
      canvas: canvasElement,
      antialias: true,
      alpha: true,
    });
    renderer.setSize(globeWidth, globeHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    controls = new OrbitControls(camera, dragZoneElement);
    controls.enablePan = false;
    controls.enableZoom = true;
    controls.minDistance = 1.5;
    controls.maxDistance = 6.0;
    controls.autoRotate = false;

    scene.add(new THREE.AmbientLight(0xffffff, 1.5));
    camera.add(new THREE.DirectionalLight(0xffffff, 0.8));
    scene.add(camera);

    const textureLoader = new THREE.TextureLoader();
    const normalMap = textureLoader.load(EARTH_NORMAL_URL);
    const mapTexture = createWorldTexture(geoJsonData);

    globeMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 64, 64),
      new THREE.MeshStandardMaterial({
        map: mapTexture,
        normalMap: normalMap,
        roughness: 1.0,
        metalness: 0.0,
      }),
    );
    earthGroup.add(globeMesh);

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      if (!isFocusMode && !isAnimatingCamera && !isHoveringLabel) {
        earthGroup.rotation.y += 0.001;
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

      syncHtmlLabels();
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
      poi.mesh.getWorldPosition(meshWorldPos);

      const dot = camPosNorm.dot(meshWorldPos.clone().normalize());
      if (dot > 0.1) {
        const vector = meshWorldPos.project(camera);
        const x = (vector.x * 0.5 + 0.5) * globeWidth;
        const y = (vector.y * -0.5 + 0.5) * globeHeight;
        element.style.display = "flex";
        element.style.transform = `translate(${x + 10}px, ${y - 10}px)`;
      } else {
        element.style.display = "none";
      }
    });
  }

  function handlePeriodClick(period) {
    const centerLatLon = calculateCenterOfPois(period.pois);

    isFocusMode = true;
    activePeriodId = period.id;
    startCamPos.copy(camera.position);

    const localTarget = latLongToVector3(
      centerLatLon.lat,
      centerLatLon.lon,
      2.2,
    );

    earthGroup.updateMatrixWorld();
    const worldTarget = localTarget.applyMatrix4(earthGroup.matrixWorld);

    endCamPos.copy(worldTarget);

    animationProgress.set(0, { duration: 0 });
    isAnimatingCamera = true;
    animationProgress.set(1).then(() => {
      isAnimatingCamera = false;
    });
  }

  function handleLabelClick(poi) {
    if (activePeriodId !== poi.periodId) {
      const targetPeriod = highlightPeriods.find((p) => p.id === poi.periodId);
      if (targetPeriod) {
        handlePeriodClick(targetPeriod);
        flatPois = flatPois.map((p) => ({
          ...p,
          showTooltip: p.id === poi.id,
        }));
      }
    } else {
      toggleTooltip(poi.id);
    }
  }

  function resumeRotation() {
    activePeriodId = null;
    flatPois = flatPois.map((p) => ({ ...p, showTooltip: false }));
    startCamPos.copy(camera.position);
    endCamPos.copy(camera.position).normalize().multiplyScalar(3.5);

    animationProgress.set(0, { duration: 0 });
    isAnimatingCamera = true;
    animationProgress.set(1).then(() => {
      isAnimatingCamera = false;
      isFocusMode = false;
    });
  }

  function toggleTooltip(poiId) {
    flatPois = flatPois.map((p) =>
      p.id === poiId ? { ...p, showTooltip: !p.showTooltip } : p,
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

  $: if (renderer && camera && globeWidth && globeHeight) {
    camera.aspect = globeWidth / globeHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(globeWidth, globeHeight);
  }

  onMount(async () => {
    try {
      const isDev =
        import.meta.env?.DEV ||
        window.location.hostname === "localhost";

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
      flatPois = highlightPeriods.flatMap((period) =>
        period.pois.map((poi, i) => ({
          id: `${period.id}-${i}`,
          periodId: period.id,
          lat: parseFloat(poi.lat),
          lon: parseFloat(poi.lon),
          location: poi.location || "Point",
          periodLabel: period.label || "",
          showTooltip: false,
          mesh: null,
        })),
      );

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

  // Customized yAxis to render dotted grid and remove solid boundary line
  function yAxis(node, { scale, width }) {
    const draw = (s, w) => {
      const axis = d3.axisLeft(s).tickSize(-w);
      d3.select(node)
        .call(axis)
        .call((g) => g.select(".domain").remove()) // Remove main axis line
        .call((g) =>
          g.selectAll(".tick line")
            .attr("stroke-dasharray", "2,2") // Dotted grid
            .attr("stroke", "rgba(255, 255, 255, 0.2)")
        );
    };
    draw(scale, width);
    return {
      update({ scale: newScale, width: newWidth }) {
        draw(newScale, newWidth);
      },
    };
  }

  // Customized xAxis to only show tick values every 5 years
  function xAxis(node, { scale, data }) {
    function draw(s, d) {
      const tickValues = d
        .filter((item) => item.month === 1 && parseInt(item.yr_ssta, 10) % 5 === 0)
        .map((item) => item.key);
      const axis = d3
        .axisBottom(s)
        .tickValues(tickValues)
        .tickFormat((val) => val.split("-")[0]);
      d3.select(node)
        .call(axis)
        .selectAll("text")
        .attr("transform", "rotate(-45)")
        .style("text-anchor", "end");
    }
    draw(scale, data);
    return {
      update({ scale: newScale, data: newData }) {
        draw(newScale, newData);
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
          <div class="introHd">{activePeriod.label}</div>
          <div class="introDesc">{activePeriod.event_desc}</div>
        </div>
      {/if}

      {#if isFocusMode}
        <button class="resetBtn" on:click={resumeRotation}>
          ↺ Resume Rotation
        </button>
      {/if}

      <div class="globeLabelCtn">
        {#each flatPois as poi, i}
          <div
            bind:this={poiElements[i]}
            class="globeLabel"
            style="display: none;"
          >
            <button
              class="globeLabelBtn"
              on:click={() => handleLabelClick(poi)}
              on:mouseenter={() => (isHoveringLabel = true)}
              on:mouseleave={() => (isHoveringLabel = false)}
            >
              {poi.location}
            </button>

            {#if poi.showTooltip}
              <div class="detailTooltip">
                <div class="tlpHd">{poi.location}</div>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>

    <div class="chartCtn" bind:clientWidth={width} bind:clientHeight={height}>
      {#if width > 0 && height > 0 && chartData.length > 0}
        <svg {width} {height}>
          <g transform={`translate(${margin.left}, ${margin.top})`}>
            <g class="highlightLayer">
              {#each highlightBoxes as box}
                <rect
                  class="highlightBox"
                  class:active-highlight={activePeriodId === box.id}
                  x={box.x}
                  y={0}
                  width={box.width}
                  height={innerHeight}
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
                  y={-10}
                  class="highlightText"
                  class:active-text={activePeriodId === box.id}
                  text-anchor="middle">{box.label || box.event_type}</text
                >
              {/each}
            </g>

            <g class="axisCtn">
              <text x="0" y="-15" fill="#e0e0e0" font-weight="bold" font-size="13px" text-anchor="middle">Anomaly</text>
              <g class="axis yAxis" use:yAxis={{ scale: yScale, width: innerWidth }}></g>
              <g
                class="axis xAxis"
                transform={`translate(0, ${innerHeight})`}
                use:xAxis={{ scale: xScale, data: chartData }}
              ></g>
              <line
                x1="0"
                x2={innerWidth}
                y1={yScale(0)}
                y2={yScale(0)}
                stroke="white"
                stroke-width="2"
              />
            </g>

            <g class="customReferenceLines">
              {#each [
                { val: 0.5, label: "weak" },
                { val: 1.0, label: "moderate" },
                { val: 1.5, label: "strong" },
                { val: 2.0, label: "very strong" },
                { val: -0.5, label: "weak" },
                { val: -1.0, label: "moderate" },
                { val: -1.5, label: "strong" },
                { val: -2.0, label: "very strong" }
              ] as ref}
                <line
                  x1="0"
                  x2={innerWidth}
                  y1={yScale(ref.val)}
                  y2={yScale(ref.val)}
                  stroke="rgba(255, 255, 255, 0.4)"
                  stroke-dasharray="1,2"
                  stroke-width="1"
                />
                <text
                  x={innerWidth + 5}
                  y={yScale(ref.val)}
                  fill="#e0e0e0"
                  alignment-baseline="middle"
                  font-size="11px"
                >
                  {ref.label}
                </text>
              {/each}
            </g>

            <g class="barLayer">
              {#each chartData as d}
                <rect
                  class="bar"
                  x={xScale(d.key)}
                  y={Math.min(yScale(d.anom_ssta), yScale(0))}
                  width={xScale.bandwidth()}
                  height={Math.abs(yScale(d.anom_ssta) - yScale(0))}
                  fill={ENSO_MAPPING[d.ENSO]
                    ? ENSO_MAPPING[d.ENSO].color
                    : "#E0E0E0"}
                  style="pointer-events: none;"
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
  }
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    font-family: "Barlow Semi Condensed", sans-serif;
    font-weight: 100;
    font-size: 12px;
  }
  .tempSpatialCtn {
    background-color: #123b65;
    height: 99vh;
    width: 99vw;
    margin: 0 auto;
  }
  .chartCtn {
    width: 100%;
    height: 40%;
  }

  .globeCtn {
    width: 100%;
    height: 55%;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
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

  .yAxis :global(.tick text),
  .xAxis :global(.tick text), .xAxis :global(.tick line), .yAxis :global(.tick line) {
    fill: #e0e0e0;
    stroke: #e0e0e0;
  }
  .axis :global(path) {
    stroke: #e0e0e0;
  }

  .highlightBox {
    fill: rgba(255, 255, 255, 0.04);
    stroke: rgba(255, 255, 255, 0.3);
    stroke-dasharray: 4;
    cursor: pointer;
    transition: all 0.3s ease;
  }
  .highlightBox:hover,
  .highlightBox:focus {
    fill: rgba(255, 255, 255, 0.12);
    outline: none;
  }
  .highlightText {
    fill: #e0e0e0;
    font-weight: 600;
    font-size: 13px;
    pointer-events: none;
    transition: fill 0.3s;
  }

  .highlightBox.active-highlight {
    fill: rgba(255, 255, 255, 0.15);
    stroke: #ff004d;
    stroke-width: 1.5;
    stroke-dasharray: none;
  }
  .active-text {
    fill: #ff004d;
  }

  .introBox {
    position: absolute;
    left: 40px;
    top: 50%;
    transform: translateY(-50%);
    width: 260px;
    padding: 18px;
    color: white;
    border-radius: 6px;
    z-index: 10;
    pointer-events: none;
    animation: slideIn 0.5s cubic-bezier(0.25, 1, 0.5, 1) forwards;
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

  .globeLabelCtn {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    overflow: hidden;
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

  button.globeLabelBtn {
    appearance: none ;
    pointer-events: auto;
    cursor: pointer;
    background: rgba(18, 59, 101, 0.85);
    color: #fff;
    padding: 3px 6px;
    border-radius: 4px;
    transition:
      background 0.2s ease,
      border-color 0.2s ease;
  }

  .detailTooltip {
    pointer-events: auto;
    color: #ffffff;
    background: rgba(18, 59, 101, 0.85);
    padding: 8px 12px;
    margin-top: 5px;
    border-radius: 4px;
    min-width: 120px;
  }

  .resetBtn {
    position: absolute;
    top: 20px;
    right: 20px;
    z-index: 10;
    background: #ff004d;
    color: white;
    border: none;
    padding: 8px 16px;
    border-radius: 4px;
    font-weight: 600;
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
</style>