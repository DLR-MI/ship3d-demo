import * as THREE from 'three';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';

// DOM elements
const select = document.getElementById("ship-select");
const img = document.getElementById("input-img");
const segmented = document.getElementById("segmented-img");
const video = document.getElementById("recon-video");
const mapDiv = document.getElementById("map");
const measureLabel = document.getElementById("measure-label");
const resetBtn = document.getElementById("reset-measure");

let map; // Global map reference
let annotations = {}; // Holds data from annotations.json

// ---- Measuring Tool State ----
let measurePoints = [];
let measureLine = null;
let sceneRef = null;
let modelAsMercatorCoordinate = null; // We'll set this per-ship

function showLabel(text) {
    measureLabel.textContent = text;
    measureLabel.style.display = 'block';
}
function hideLabel() {
    measureLabel.style.display = 'none';
}
function resetMeasure() {
    measurePoints = [];
    if (measureLine && sceneRef) {
        sceneRef.remove(measureLine);
        measureLine.geometry.dispose();
        measureLine.material.dispose();
    }
    measureLine = null;
    hideLabel();
    resetBtn.style.display = 'none';
}
resetBtn.addEventListener('click', resetMeasure);
// Allow reset via keyboard "r"
document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'r') resetMeasure();
});
// -------------------------------

// Load annotations.json once at startup
async function loadAnnotations() {
  const response = await fetch('media/annotations.json');
  annotations = await response.json();
  populateShipDropdown();
  updateView(select.value);
}

// Populate dropdown (currently only img_143, but extensible)
function populateShipDropdown() {
  select.innerHTML = ""; // Clear existing options

  // Add ships here:
  addShipOption("img_143");
  addShipOption("img_306");
  addShipOption("img_546");

  // Example to add more ships:
  // addShipOption("img_000");
  // addShipOption("img_001");
}

function addShipOption(shipId) {
  const option = document.createElement("option");
  option.value = shipId;
  option.textContent = shipId;
  select.appendChild(option);
}

// Initialize MapLibre + Three.js
function initMap(shipData, shipKey) {
  if (map) map.remove();

  // Correct numeric parsing and explicit assignment
  const lat = parseFloat(shipData.geo[0]);
  const lon = parseFloat(shipData.geo[1]);
  const ship_length = parseFloat(shipData.ship_length);

  if (isNaN(lat) || isNaN(lon) || isNaN(ship_length)) {
    console.error("Invalid data:", {lat, lon, ship_length});
    return;
  }

  const fixedMapCenter = [lon, lat];

  map = new maplibregl.Map({
    container: mapDiv,
    style: 'https://tiles.openfreemap.org/styles/liberty',
    zoom: 16.8,
    center: fixedMapCenter,
    pitch: 60,
    bearing: -68,
    antialias: true
  });

  map.setMaxPitch(90);

  modelAsMercatorCoordinate = maplibregl.MercatorCoordinate.fromLngLat([lon, lat], 0);

  const modelTransform = {
    translateX: modelAsMercatorCoordinate.x,
    translateY: modelAsMercatorCoordinate.y,
    translateZ: modelAsMercatorCoordinate.z,
    rotateX: Math.PI / 2,
    rotateY: Math.PI,
    rotateZ: Math.PI,
    scale: modelAsMercatorCoordinate.meterInMercatorCoordinateUnits()
  };

  const customLayer = {
    id: '3d-model',
    type: 'custom',
    renderingMode: '3d',
    onAdd: function (map, gl) {
      this.camera = new THREE.Camera();
      this.scene = new THREE.Scene();
      sceneRef = this.scene; // For measuring tool

      const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
      this.scene.add(ambientLight);

      const loader = new PLYLoader();
      const plyPath = `media/${shipKey}.ply`;

      loader.load(
        plyPath,
        geometry => {
          geometry.computeVertexNormals();
          const material = geometry.attributes.color
            ? new THREE.PointsMaterial({ vertexColors: true, size: 3.5 })
            : new THREE.PointsMaterial({ color: 0xff0000, size: 6 });

          const mesh = new THREE.Points(geometry, material);
          this.scene.add(mesh);
        },
        undefined,
        error => {
          console.error("Failed to load PLY:", error);
        }
      );

      this.renderer = new THREE.WebGLRenderer({
        canvas: map.getCanvas(),
        context: gl,
        antialias: true
      });
      this.renderer.autoClear = false;
    },
    render: function (gl, args) {
      const rotationX = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), modelTransform.rotateX);
      const rotationY = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(0, 1, 0), modelTransform.rotateY);
      const rotationZ = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(0, 0, 1), modelTransform.rotateZ);

      const m = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix);

      const l = new THREE.Matrix4()
        .makeTranslation(modelTransform.translateX, modelTransform.translateY, modelTransform.translateZ)
        .scale(new THREE.Vector3(modelTransform.scale, -modelTransform.scale, modelTransform.scale))
        .multiply(rotationX).multiply(rotationY).multiply(rotationZ);

      this.camera.projectionMatrix = m.multiply(l);
      this.renderer.resetState();
      this.renderer.render(this.scene, this.camera);
      map.triggerRepaint();
    }
  };

  if (map.isStyleLoaded()) {
    map.addLayer(customLayer);
    addMeasuringHandlers();
  } else {
    map.on('style.load', () => {
      map.addLayer(customLayer);
      addMeasuringHandlers();
    });
  }
}

// ---- Measuring Tool: map click handler ----
function addMeasuringHandlers() {
  // Remove previous handlers (avoid duplicates on re-init)
  map.getCanvas().removeEventListener('click', measureMapClickHandler);
  map.getCanvas().addEventListener('click', measureMapClickHandler);
  resetMeasure();
}

function measureMapClickHandler(e) {
  if (!modelAsMercatorCoordinate) return;
  const rect = map.getCanvas().getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  const lngLat = map.unproject([x, y]);
  const merc = maplibregl.MercatorCoordinate.fromLngLat(
    [lngLat.lng, lngLat.lat], 0
  );
  measurePoints.push(merc);

  if (measurePoints.length === 2 && sceneRef) {
    // Remove previous line if exists
    if (measureLine) {
      sceneRef.remove(measureLine);
      measureLine.geometry.dispose();
      measureLine.material.dispose();
    }
    // Calculate line and distance in meters
    const scale = modelAsMercatorCoordinate.meterInMercatorCoordinateUnits();
    const p1 = new THREE.Vector3(
      (measurePoints[0].x - modelAsMercatorCoordinate.x) / scale,
      -(measurePoints[0].y - modelAsMercatorCoordinate.y) / scale,
      (measurePoints[0].z - modelAsMercatorCoordinate.z) / scale
    );
    const p2 = new THREE.Vector3(
      (measurePoints[1].x - modelAsMercatorCoordinate.x) / scale,
      -(measurePoints[1].y - modelAsMercatorCoordinate.y) / scale,
      (measurePoints[1].z - modelAsMercatorCoordinate.z) / scale
    );
    const lineGeom = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    const lineMat = new THREE.LineBasicMaterial({ color: 0xff0000, linewidth: 4 });
    measureLine = new THREE.Line(lineGeom, lineMat);
    sceneRef.add(measureLine);

    // Haversine for real earth distance
    function haversine(lng1, lat1, lng2, lat2) {
      const R = 6371000;
      const toRad = d => d * Math.PI / 180;
      const dLat = toRad(lat2 - lat1);
      const dLng = toRad(lng2 - lng1);
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
    const latlng0 = [measurePoints[0].toLngLat().lng, measurePoints[0].toLngLat().lat];
    const latlng1 = [measurePoints[1].toLngLat().lng, measurePoints[1].toLngLat().lat];
    const distanceMeters = haversine(
      latlng0[0], latlng0[1],
      latlng1[0], latlng1[1]
    );
    showLabel(`Distance: ${distanceMeters.toFixed(2)} meters`);
    resetBtn.style.display = 'block';
  }
}
// ---------------------------------------------

// Update displayed media and map
function updateView(shipKey) {
  const imgFile = `${shipKey}.jpg`;
  const segmentedFile = `${shipKey}_segmented.png`;
  const videoFile = `${shipKey}.mp4`;

  img.src = `media/${imgFile}`;
  segmented.src = `media/${segmentedFile}`;
  video.src = `media/${videoFile}`;

  const shipData = annotations[imgFile];
  if (!shipData) {
    alert(`No annotation found for ${imgFile}`);
    return;
  }

  initMap(shipData, shipKey);
}

// Event listeners
select.addEventListener("change", () => updateView(select.value));

// Initial load
window.onload = loadAnnotations;
