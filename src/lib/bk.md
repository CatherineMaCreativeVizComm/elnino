  const SHEET_ID = "1Vm6vxrxc9Y6-coeX2o2rSsnYmMO4NBubSP40Jn59Yuw";
  const API_KEY = "AIzaSyAPauL7gS0wK5bi9QVEbhjkzjwppBBU5_U";
  const RANGE = "data!A1:L2000";
  const SHEET_URL = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${RANGE}?key=${API_KEY}`;
  // const ASCII_TARGET_URL = 'https://www.cpc.ncep.noaa.gov/data/indices/Rnino34.ascii.txt';
  // const ASCII_URL = `https://corsproxy.io/?${encodeURIComponent(ASCII_TARGET_URL)}`;

  // Bring back GeoJSON to custom paint our land and sea colors
  const GEOJSON_URL =
    "https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson";
  // Keep normal map for the 3D terrain bumps
  const EARTH_NORMAL_URL =
    "https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_normal_2048.jpg";

  const SEAS_MAPPING = {
    DJF: {
      start_m: 12,
      end_m: 2,
      desc: "Winter"
    },
    JFM: {
      start_m: 1,
      end_m: 3,
      desc: "Late Winter / Early Spring"
    },
    FMA: {
      start_m: 2,
      end_m: 4,
      desc: "Early Spring"
    },
    MAM: {
      start_m: 3,
      end_m: 5,
      desc: "Spring"
    },

    AMJ: {
      start_m: 4,
      end_m: 6,
      desc: "Late Spring / Early Summer"
    },
    MJJ: {
      start_m: 5,
      end_m: 7,
      desc: "Early Summer"
    },
    JJA: {
      start_m: 6,
      end_m: 8,
      desc: "Summer"
    },
    JAS: {
      start_m: 7,
      end_m: 9,
      desc: "Late Summer / Early Autumn"
    },
    ASO: {
      start_m: 8,
      end_m: 10,
      desc: "Early Autumn"
    },
    SON: {
      start_m: 9,
      end_m: 11,
      desc: "Autumn"
    },
    OND: {
      start_m: 10,
      end_m: 12,
      desc: "Late Autumn / Early Winter"
    },
    NDJ: {
      start_m: 11,
      end_m: 1,
      desc: "Early Winter"
    },
  };

  const ENSO_MAPPING = {
    VSE: {
      value: 4,
      desc: "Very Strong El Nino",
      color: "#FF004D",
    },
    SE: {
      value: 3,
      desc: "Strong El Nino",
      color: "#FF4500",
    },
    ME: {
      value: 2,
      desc: "Moderate El Nino",
      color: "#FFA500",
    },
    WE: {
      value: 1,
      desc: "Weak El Nino",
      color: "#FFD700",
    },
    N: {
      value: 0,
      desc: "Neutral",
      color: "#E0E0E0",
    },
    WL: {
      value: -1,
      desc: "Weak La Nina",
      color: "#87CEFA",
    },
    ML: {
      value: -2,
      desc: "Moderate La Nina",
      color: "#00BFFF",
    },
    SL: {
      value: -3,
      desc: "Strong La Nina",
      color: "#9370DB",
    },
  };

  const HIGHLIGHT_PERIODS = [
    {
      id: "period-1",
      startYr: 1997,
      startM: 5,
      endYr: 1998,
      endM: 5,
      label: "97-98 Strong El Nino",
      description:
        "One of the most powerful El Niño events in recorded history, causing significant global weather disruptions, droughts, and floods.",
      pois: [
        { lat: 0, lon: -150 },
        { lat: 2, lon: -120 },
        { lat: -5, lon: -90 },
      ],
    },
    {
      id: "period-2",
      startYr: 2010,
      startM: 6,
      endYr: 2011,
      endM: 5,
      label: "10-11 Strong La Nina",
      description:
        "A notably strong La Niña event associated with widespread extreme flooding in Australia and severe weather anomalies globally.",
      pois: [
        { lat: -12, lon: 130 },
        { lat: 0, lon: 150 },
        { lat: 5, lon: 110 },
      ],
    },
    {
      id: "period-3",
      startYr: 2015,
      startM: 3,
      endYr: 2016,
      endM: 5,
      label: "15-16 Strong El Nino",
      description:
        "A massive El Niño tying or exceeding the 1997-98 event, leading to extreme global temperature records and severe coral bleaching.",
      pois: [
        { lat: 5, lon: -80 },
        { lat: -2, lon: -95 },
        { lat: -10, lon: -85 },
      ],
    },
  ];


