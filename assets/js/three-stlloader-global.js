import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";
import { STLLoader } from "https://unpkg.com/three@0.161.0/examples/jsm/loaders/STLLoader.js";

// Expose to non-module scripts.
window.THREE = THREE;
window.THREE.STLLoader = STLLoader;

window.__THREE_STL_READY__ = true;
window.dispatchEvent(new Event("three-stlloader-ready"));
