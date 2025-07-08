import * as THREE from 'three';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';

// DOM elements
const select = document.getElementById("ship-select");
const img = document.getElementById("input-img");
const segmented = document.getElementById("segmented-img");
const video = document.getElementById("recon-video");
const mapDiv = document.getElementById("map");

let map; // Global map reference
let annotations = {}; // Holds data from annotations.json

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

  const fixedMapCenter = [8.57829, 53.53458];

  // Correct numeric parsing and explicit assignment
  const lat = parseFloat(shipData.geo[0]);
  const lon = parseFloat(shipData.geo[1]);
  const ship_length = parseFloat(shipData.ship_length);

  if (isNaN(lat) || isNaN(lon) || isNaN(ship_length)) {
    console.error("Invalid data:", {lat, lon, ship_length});
    return;
  }

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

  const modelAsMercatorCoordinate = maplibregl.MercatorCoordinate.fromLngLat([lon, lat], 0);

  const modelTransform = {
  translateX: modelAsMercatorCoordinate.x,
  translateY: modelAsMercatorCoordinate.y,
  translateZ: modelAsMercatorCoordinate.z,
  rotateX: Math.PI / 2,
  rotateY: Math.PI,
  rotateZ: Math.PI,
  scale: modelAsMercatorCoordinate.meterInMercatorCoordinateUnits()  // no multiplier!
    };

  const customLayer = {
    id: '3d-model',
    type: 'custom',
    renderingMode: '3d',
    onAdd: function (map, gl) {
      this.camera = new THREE.Camera();
      this.scene = new THREE.Scene();

      const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
      this.scene.add(ambientLight);

      const loader = new PLYLoader();
const plyPath = `media/${shipKey}.ply`;

console.log("Loading PLY:", plyPath);

loader.load(
  plyPath,
  geometry => {
    console.log("PLY loaded successfully:", geometry);
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
} else {
  map.on('style.load', () => map.addLayer(customLayer));
}

}


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
