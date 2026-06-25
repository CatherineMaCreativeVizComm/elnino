<svelte:options customElement={{ tag: "elnino-wgc", shadow: "open" }} />

<script>
  import { onMount } from "svelte";
  import * as d3 from 'd3';

  const SHEET_ID = "1Vm6vxrxc9Y6-coeX2o2rSsnYmMO4NBubSP40Jn59Yuw";
  const API_KEY = "AIzaSyAPauL7gS0wK5bi9QVEbhjkzjwppBBU5_U";
  const RANGE = "data!A1:D2000";
  const SHEET_URL = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${RANGE}?key=${API_KEY}`;
  const ASCII_TARGET_URL = 'https://www.cpc.ncep.noaa.gov/data/indices/RONI.ascii.txt';
  const ASCII_URL = `https://corsproxy.io/?${encodeURIComponent(ASCII_TARGET_URL)}`;

  const SEAS_MAPPING ={
    'DJF': { value: 1, desc: 'Winter' },
    'JFM': { value: 2, desc: 'Late Winter / Early Spring' },
    'FMA': { value: 3, desc: 'Early Spring' },
    'MAM': { value: 4, desc: 'Spring' },
    'AMJ': { value: 5, desc: 'Late Spring / Early Summer' },
    'MJJ': { value: 6, desc: 'Early Summer' },
    'JJA': { value: 7, desc: 'Summer' },
    'JAS': { value: 8, desc: 'Late Summer / Early Autumn' },
    'ASO': { value: 9, desc: 'Early Autumn' },
    'SON': { value: 10, desc: 'Autumn' },
    'OND': { value: 11, desc: 'Late Autumn / Early Winter' },
    'NDJ': { value: 12, desc: 'Early Winter' }
  }
  const ENSO_MAPPING = {
    'VSE': 4,  
    'SE': 3,   
    'ME': 2,   
    'WE': 1, 
    'N': 0,    
    'WL': -1, 
    'ML': -2,   
    'SL': -3  
  }

  const ENSO_COLORS = {
    "4": '#FF004D',
    "3": '#FF4500',
    "2": '#FFA500',
    "1": '#FFD700',
    "0": '#E0E0E0',
    "-1": '#87CEFA',
    "-2": '#00BFFF',
    "-3": '#9370DB'
  };

  function getEnsoColor(ensoValue) {
    const stringKey = String(ensoValue);
    if (ensoValue === null || ENSO_COLORS[stringKey] === undefined) {
      return '#666666'; 
    }
    return ENSO_COLORS[stringKey];
  }

  let mergedData = [];
  let isLoading = true;
  let errorMessage = null;

  let chartWidth = 1000;
  const chartHeight = 800;
  const margin = { top: 20, right: 30, bottom: 60, left: 60 };
  $: innerWidth = chartWidth - margin.left - margin.right;
  $: innerHeight = chartHeight - margin.top - margin.bottom;

  let hoverItem = null;
  let mouseX = 0;
  let mouseY = 0;
  let x0_scale, x1_scale, y_scale, uniqueYears, sortedSeasons;
  
  $: if (!isLoading && mergedData.length > 0) {
    uniqueYears = [...new Set(mergedData.map(d => d.YR))].sort();
    sortedSeasons = Object.keys(SEAS_MAPPING).sort((a,b) => SEAS_MAPPING[a].value - SEAS_MAPPING[b].value);

    x0_scale = d3.scaleBand()
      .domain(uniqueYears)
      .range([0, innerWidth])
      .paddingInner(0.2); 

    x1_scale = d3.scaleBand()
      .domain(sortedSeasons)
      .range([0, x0_scale.bandwidth()])
      .padding(0.05); 

    y_scale = d3.scaleLinear()
      .domain(d3.extent(mergedData, d => d.ANOM)).nice()
      .range([innerHeight, 0]);
  }

  function yAxis(node, scale) {
    function draw(currentScale) {
      if (currentScale) d3.select(node).call(d3.axisLeft(currentScale).ticks(10));
    }
    draw(scale);
    return { update(newScale) { draw(newScale); } };
  }

  function xAxis(node, { scale, width }) {
    function draw(currentScale, currentWidth) {
      if (!currentScale) return;
      const axisGenerator = d3.axisBottom(currentScale);
      const tickInterval = currentWidth < 800 ? 10 : 5; 
      const tickValues = currentScale.domain().filter(year => year % tickInterval === 0);
      
      axisGenerator.tickValues(tickValues);
      d3.select(node).call(axisGenerator);
    }
    draw(scale, width);

    return { 
      update(params) { draw(params.scale, params.width); } 
    };
  }

  function parseAsciiData(text) {
    const lines = text.trim().split('\n');
    const dataLines = lines.slice(1);
    
    return dataLines.map((line) => {
      const columns = line.trim().split(/\s+/);
      return {
        SEAS: columns[0],
        YR: parseInt(columns[1], 10), 
        ANOM: parseFloat(columns[2])
      };
    });
  }

  function parseSheetData(data) {
    const rows = data.values;
    if (!rows || rows.length === 0) return [];

    const headers = rows[0];
    const dataRows = rows.slice(1);
    return dataRows.map((row) => {
      let obj = {};
      headers.forEach((header, index) => {
        obj[header] = row[index] || "";
      });
      
      if (obj.YR) {
        obj.YR = parseInt(obj.YR, 10);
      }
      return obj;
    });
  }

  onMount(async () => {
    try {
      const [asciiResponse, sheetResponse] = await Promise.all([
        fetch(ASCII_URL),
        fetch(SHEET_URL)
      ]);

      if (!asciiResponse.ok) throw new Error('Failed to fetch ASCII data.');
      if (!sheetResponse.ok) throw new Error('Failed to fetch Google Sheets data.');

      const asciiText = await asciiResponse.text();
      const sheetJson = await sheetResponse.json();
      const asciiData = parseAsciiData(asciiText);
      const sheetData = parseSheetData(sheetJson);
      const sheetMap = new Map();
      sheetData.forEach((item) => {
        const uniqueKey = `${item.YR}-${item.SEAS}`;
        sheetMap.set(uniqueKey, item);
      });

      mergedData = asciiData.map((asciiItem) => {
        const uniqueKey = `${asciiItem.YR}-${asciiItem.SEAS}`;
        const matchingSheetItem = sheetMap.get(uniqueKey) || {}; 
        const seasonData = SEAS_MAPPING[asciiItem.SEAS] || { value: null, desc: 'Unknown' };
        const ensoString = matchingSheetItem.ENSO;
        const ensoValue = (ensoString && ENSO_MAPPING[ensoString] !== undefined) 
                            ? ENSO_MAPPING[ensoString] 
                            : null;
        return {
          ...matchingSheetItem,
          ...asciiItem,
          SEAS_VALUE: seasonData.value,
          SEAS_DESC: seasonData.desc,
          ENSO_VALUE: ensoValue
        };
      });

      mergedData.sort((a,b) => a.YR - b.YR || a.SEAS_VALUE - b.SEAS_VALUE);
      // console.log("Merged Data:", mergedData);
      isLoading = false;
    } catch (error) {
      console.error("Data processing error:", error);
      errorMessage = error.message;
      isLoading = false;
    }
  });


</script>

<section class="tempSpatialCtn">
  {#if isLoading}
    <p>Loading...</p>
  {:else if errorMessage}
    <p>{errorMessage}</p>
  {:else if mergedData.length > 0}
    <div class="chartCtn" bind:clientWidth={chartWidth}>
      <svg width={chartWidth} height={chartHeight}>
        <g transform={`translate(${margin.left}, ${margin.top})`}>
          <g class="axis yAxis" use:yAxis></g>
          <g class="axis xAxis" transform="translate(0, {innerHeight})" use:xAxis></g>
          <line x1="0" x2={innerWidth} y1={y_scale(0)} y2={y_scale(0)} stroke="black" stroke-width="1" />
          {#each uniqueYears as year}
            <g transform="translate({x0_scale(year)}, 0)">
              {#each mergedData.filter(d => d.YR === year) as d}
                <rect
                  role="graphics-symbol"
                  class="bar"
                  x={x1_scale(d.SEAS)}
                  y={d.ANOM > 0 ? y_scale(d.ANOM) : y_scale(0)}
                  width={x1_scale.bandwidth()}
                  height={Math.abs(y_scale(d.ANOM) - y_scale(0))}
                  fill={getEnsoColor(d.ENSO_VALUE)}
                  stroke="#123B65"
                  stroke-width="0.5"
                  on:mousemove={(e) => {
                    hoverItem = d;
                    mouseX = e.clientX; 
                    mouseY = e.clientY;
                  }}
                  on:mouseleave={() => hoverItem = null}
                />
              {/each}
            </g>
          {/each}
        </g>
      </svg>
      {#if hoverItem}
        <div 
          class="tooltip" 
          style="left: {mouseX + 15}px; top: {mouseY + 15}px;"
        >
          <strong>{hoverItem.YR} - {hoverItem.SEAS}</strong> ({hoverItem.SEAS_DESC})<br>
          Anomaly: <span style="color: {hoverItem.ANOM > 0 ? '#ff7c7c' : '#7cb3ff'}">{hoverItem.ANOM.toFixed(2)}</span><br>
          ENSO: {hoverItem.ENSO || 'Unknown'} (Value: {hoverItem.ENSO_VALUE ?? 'N/A'})
        </div>
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
    -webkit-tap-highlight-color: transparent;
    -webkit-touch-callout: none;
    -webkit-font-smoothing: antialiased;
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
    background-color: #123B65;
    height: 100vh;
    width: 100vw;
  }

  .chartCtn{
    position: relative;
    display: inline-block;
  }

  .yAxis :global(.tick text) { 
    fill: #E0E0E0; 
  }
  .xAxis :global(.tick text) { 
    fill: #E0E0E0; 
  }
  .axis :global(path), .axis :global(line) {
    stroke: #E0E0E0; 
  }

  .tooltip {
    position: fixed; 
    z-index: 100;
    background: rgba(10, 25, 47, 0.95); 
    color: #E0E0E0;
    border-radius: 6px;
    padding: 4px;
    pointer-events: none; 
    max-width: 200px;
    transition: top 0.05s ease, left 0.05s ease;
  }


  
  .bar { cursor: pointer; transition: opacity 0.2s; }
  .bar:hover { opacity: 0.7; }


</style>
