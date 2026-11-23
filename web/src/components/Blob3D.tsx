import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

// A real-time 3D object for the landing page: a glossy lobed ring ("ring") or a soft blob
// ("blob"), in black lacquer or brushed silver. The surface slowly breathes; it turns with the
// page scroll (`spin`, 0..1) and leans toward the pointer. Rendering pauses when it is off screen,
// and draws one still frame when the viewer prefers reduced motion. If WebGL is unavailable the
// container keeps its CSS fallback.

type Props = { shape?: "ring" | "blob"; finish?: "black" | "silver"; spin?: { get: () => number }; className?: string };

const DISPLACE = /* glsl */ `
uniform float uTime;
uniform float uShape;
float glDisp(vec3 p) {
  float a = atan(p.y, p.x);
  float lobes = uShape < 0.5 ? 0.16 * sin(5.0 * a + uTime * 0.35) : 0.0;
  float n = 0.045 * sin(2.3 * p.x + uTime * 0.6) * sin(2.1 * p.y - uTime * 0.5) * sin(2.7 * p.z + uTime * 0.4);
  float blob = uShape > 0.5 ? 0.16 * sin(1.7 * p.x + uTime * 0.3) * sin(1.9 * p.y + 1.3) + 0.1 * sin(3.1 * p.z - uTime * 0.25) : 0.0;
  return lobes + n + blob;
}
`;

export default function Blob3D({ shape = "ring", finish = "black", spin, className }: Props) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch {
      return; // no WebGL: keep the CSS fallback
    }
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = finish === "black" ? 1.05 : 1.15;
    renderer.domElement.setAttribute("aria-hidden", "true");
    el.appendChild(renderer.domElement);
    el.classList.add("gl-on");

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
    scene.environment = env;

    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    camera.position.set(0, 0, 8.6);

    const geometry = shape === "ring" ? new THREE.TorusGeometry(1.2, 0.6, 160, 320) : new THREE.IcosahedronGeometry(1.55, 48);
    const material = new THREE.MeshPhysicalMaterial(
      finish === "black"
        ? { color: 0x0a0a0a, roughness: 0.16, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.25 }
        : { color: 0xe9e9ea, roughness: 0.12, metalness: 1, clearcoat: 0.6, clearcoatRoughness: 0.1, envMapIntensity: 1.1 },
    );
    const uniforms = { uTime: { value: 0 }, uShape: { value: shape === "ring" ? 0 : 1 } };
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uniforms.uTime;
      shader.uniforms.uShape = uniforms.uShape;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${DISPLACE}`)
        // Displace along the normal and rebuild the normal from two nearby displaced points.
        .replace(
          "#include <beginnormal_vertex>",
          `#include <beginnormal_vertex>
           vec3 glT = normalize(abs(objectNormal.y) < 0.99 ? cross(objectNormal, vec3(0.0, 1.0, 0.0)) : cross(objectNormal, vec3(1.0, 0.0, 0.0)));
           vec3 glB = normalize(cross(objectNormal, glT));
           float glE = 0.012;
           vec3 glP0 = position + objectNormal * glDisp(position);
           vec3 glP1 = position + glT * glE; glP1 += objectNormal * glDisp(glP1);
           vec3 glP2 = position + glB * glE; glP2 += objectNormal * glDisp(glP2);
           vec3 glN = normalize(cross(glP1 - glP0, glP2 - glP0));
           objectNormal = dot(glN, objectNormal) < 0.0 ? -glN : glN;`,
        )
        .replace("#include <begin_vertex>", `#include <begin_vertex>\n transformed = position + normal * glDisp(position);`);
    };
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.set(0.5, -0.35, 0.2);
    scene.add(mesh);

    const key = new THREE.DirectionalLight(0xffffff, finish === "black" ? 2.2 : 1.2);
    key.position.set(3, 4, 5);
    scene.add(key, new THREE.AmbientLight(0xffffff, 0.15));

    const size = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.fov = w / h < 0.9 ? 40 : 32;
      camera.updateProjectionMatrix();
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(el);

    const pointer = { x: 0, y: 0 };
    const onMove = (e: PointerEvent) => {
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    let visible = true;
    const io = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
    });
    io.observe(el);

    const t0 = performance.now();
    let raf = 0;
    const tilt = { x: 0, y: 0 };
    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (!visible) return;
      const t = (performance.now() - t0) / 1000;
      const s = spin?.get() ?? 0;
      uniforms.uTime.value = t;
      tilt.x += (pointer.y * 0.25 - tilt.x) * 0.05;
      tilt.y += (pointer.x * 0.35 - tilt.y) * 0.05;
      mesh.rotation.x = 0.5 + tilt.x + s * 1.2;
      mesh.rotation.y = -0.35 + tilt.y + t * 0.12 + s * 2.4;
      mesh.rotation.z = 0.2 + s * 0.6;
      renderer.render(scene, camera);
    };
    if (still) {
      uniforms.uTime.value = 2;
      renderer.render(scene, camera);
    } else frame();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      ro.disconnect();
      io.disconnect();
      geometry.dispose();
      material.dispose();
      env.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      el.classList.remove("gl-on");
    };
  }, [shape, finish, spin]);

  return <div ref={host} className={`gl ${finish} ${className ?? ""}`} />;
}
