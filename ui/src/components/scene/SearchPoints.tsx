import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { ALGO_COLORS, type AlgoKey } from "@/lib/schemas";

interface SearchPointsProps {
  /** algo -> latest population positions normalized to [0,1]^2 */
  positions: Record<string, Array<[number, number]>>;
  /** algo -> best-position trail normalized to [0,1]^2 */
  trajectories: Record<string, Array<[number, number]>>;
  visible: Record<AlgoKey, boolean>;
  /** surface height sampler for exact on-surface placement */
  heightAt: (xn: number, yn: number) => number;
  /** world-units point size (default: compact, as used by live/replay scenes) */
  pointSize?: number;
  /**
   * trail line width in screen pixels. 0 (default) renders a plain 1px
   * THREE.Line; a positive value renders a screen-space Line2 with that
   * width, which stays visible at any zoom level.
   */
  trailWidth?: number;
}

const TRAIL_MAX = 500;
/** initial capacity of the persistent population buffer (grows on demand) */
const POINTS_CAP_INIT = 64;
/** fixed bounding sphere: positions are normalized to [0,1]^2, heights ~[0,1] */
const BOUNDS = new THREE.Sphere(new THREE.Vector3(0, 0.5, 0), 1.6);

interface AlgoObjects {
  points: THREE.Points;
  /** either a plain THREE.Line (legacy) or a width-scaled Line2 */
  line: THREE.Line | Line2;
  /**
   * Persistent position attribute reused across telemetry ticks. Replacing
   * an attribute with a fresh one leaks the previous GPU buffer (three.js
   * only frees it on dispose), so buffers are written in place instead.
   */
  pointsAttr: THREE.BufferAttribute;
  /** persistent trail attribute for the plain-line path (capacity TRAIL_MAX) */
  trailAttr: THREE.BufferAttribute;
}

/**
 * Live search overlay: population point cloud + best-so-far trail per algo.
 * Built imperatively (THREE.Points / THREE.Line / Line2) and mounted via
 * <primitive>.
 */
export default function SearchPoints({
  positions,
  trajectories,
  visible,
  heightAt,
  pointSize = 0.025,
  trailWidth = 0,
}: SearchPointsProps) {
  const objectsRef = useRef<Record<string, AlgoObjects>>({});
  const [, forceRender] = useState(0);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);

  // (Re)create objects when the set of algos or the trail mode changes.
  const algos = useMemo(
    () =>
      Array.from(
        new Set([...Object.keys(positions), ...Object.keys(trajectories)]),
      ).sort(),
    [positions, trajectories],
  );
  const algosKey = `${algos.join(",")}|${trailWidth > 0 ? "w" : "b"}`;

  useMemo(() => {
    for (const obj of Object.values(objectsRef.current)) {
      obj.points.geometry.dispose();
      (obj.points.material as THREE.Material).dispose();
      obj.line.geometry.dispose();
      (obj.line.material as THREE.Material).dispose();
    }
    objectsRef.current = {};
    for (const algo of algos) {
      const color = ALGO_COLORS[algo as AlgoKey] ?? "#ffffff";
      const pointsGeo = new THREE.BufferGeometry();
      const pointsAttr = new THREE.BufferAttribute(
        new Float32Array(POINTS_CAP_INIT * 3),
        3,
      );
      pointsGeo.setAttribute("position", pointsAttr);
      pointsGeo.boundingSphere = BOUNDS.clone();
      pointsGeo.setDrawRange(0, 0);
      const points = new THREE.Points(
        pointsGeo,
        new THREE.PointsMaterial({
          size: pointSize,
          color,
          sizeAttenuation: true,
          transparent: true,
          opacity: 0.9,
        }),
      );
      let line: THREE.Line | Line2;
      let trailAttr: THREE.BufferAttribute;
      if (trailWidth > 0) {
        const material = new LineMaterial({
          color: new THREE.Color(color).getHex(),
          linewidth: trailWidth,
          transparent: true,
          opacity: 0.9,
        });
        material.resolution.set(size.width, size.height);
        line = new Line2(new LineGeometry(), material);
        trailAttr = new THREE.BufferAttribute(new Float32Array(0), 3);
      } else {
        const lineGeo = new THREE.BufferGeometry();
        trailAttr = new THREE.BufferAttribute(
          new Float32Array(TRAIL_MAX * 3),
          3,
        );
        lineGeo.setAttribute("position", trailAttr);
        lineGeo.boundingSphere = BOUNDS.clone();
        lineGeo.setDrawRange(0, 0);
        line = new THREE.Line(
          lineGeo,
          new THREE.LineBasicMaterial({
            color,
            transparent: true,
            opacity: 0.9,
          }),
        );
      }
      objectsRef.current[algo] = { points, line, pointsAttr, trailAttr };
    }
    forceRender((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [algosKey]);

  // Dispose all GPU resources when the scene unmounts. Objects attached via
  // <primitive> are exempt from R3F auto-disposal, and scenes are torn down
  // whenever preview dialogs close / pages switch.
  useEffect(() => {
    return () => {
      for (const obj of Object.values(objectsRef.current)) {
        obj.points.geometry.dispose();
        (obj.points.material as THREE.Material).dispose();
        obj.line.geometry.dispose();
        (obj.line.material as THREE.Material).dispose();
      }
      objectsRef.current = {};
    };
  }, []);

  // LineMaterial computes pixel widths from the canvas resolution.
  useEffect(() => {
    if (trailWidth <= 0) return;
    for (const obj of Object.values(objectsRef.current)) {
      const mat = obj.line.material;
      if (mat instanceof LineMaterial) {
        mat.resolution.set(size.width, size.height);
      }
    }
    invalidate();
  }, [size, trailWidth, invalidate]);

  // Update buffers at telemetry rate. The canvas renders on demand, so each
  // buffer write must explicitly request a frame. Typed arrays are reused
  // across ticks; GPU buffers are only re-allocated on capacity growth.
  useEffect(() => {
    for (const [algo, obj] of Object.entries(objectsRef.current)) {
      const show = visible[algo as AlgoKey] ?? true;
      obj.points.visible = show;
      obj.line.visible = show;

      const pts = positions[algo] ?? [];
      const nPts = Math.max(pts.length, 1);
      let pAttr = obj.pointsAttr;
      if (pAttr.array.length < nPts * 3) {
        // Rare capacity growth: dispose the geometry so the renderer frees
        // the old GPU buffer, then attach the larger attribute. Geometry is
        // re-uploaded on the next frame.
        obj.points.geometry.dispose();
        pAttr = new THREE.BufferAttribute(new Float32Array(nPts * 3), 3);
        obj.pointsAttr = pAttr;
        obj.points.geometry.setAttribute("position", pAttr);
      }
      const pArr = pAttr.array as Float32Array;
      pts.forEach(([xn, yn], i) => {
        pArr[i * 3] = xn - 0.5;
        pArr[i * 3 + 1] = heightAt(xn, yn) + 0.02;
        pArr[i * 3 + 2] = yn - 0.5;
      });
      pAttr.needsUpdate = true;
      obj.points.geometry.setDrawRange(0, pts.length);

      const trail = (trajectories[algo] ?? []).slice(-TRAIL_MAX);
      if (obj.line instanceof Line2) {
        // Line2 needs >= 2 vertices; hide the trail otherwise.
        if (trail.length < 2) {
          obj.line.visible = false;
        } else {
          const flat = new Float32Array(trail.length * 3);
          trail.forEach(([xn, yn], i) => {
            flat[i * 3] = xn - 0.5;
            flat[i * 3 + 1] = heightAt(xn, yn) + 0.03;
            flat[i * 3 + 2] = yn - 0.5;
          });
          // LineGeometry.setPositions replaces its instanced attributes on
          // every call; dispose the previous geometry so its GPU buffers
          // are freed instead of leaking one set per tick.
          obj.line.geometry.dispose();
          const g = new LineGeometry();
          g.setPositions(Array.from(flat));
          obj.line.geometry = g;
          obj.line.computeLineDistances();
          obj.line.visible = show;
        }
      } else {
        const tArr = obj.trailAttr.array as Float32Array;
        trail.forEach(([xn, yn], i) => {
          tArr[i * 3] = xn - 0.5;
          tArr[i * 3 + 1] = heightAt(xn, yn) + 0.03;
          tArr[i * 3 + 2] = yn - 0.5;
        });
        obj.trailAttr.needsUpdate = true;
        obj.line.geometry.setDrawRange(0, trail.length);
      }
    }
    invalidate();
  }, [positions, trajectories, visible, heightAt, invalidate]);

  return (
    <group>
      {Object.entries(objectsRef.current).map(([algo, obj]) => (
        <primitive key={algo} object={obj.points} />
      ))}
      {Object.entries(objectsRef.current).map(([algo, obj]) => (
        <primitive key={`l-${algo}`} object={obj.line} />
      ))}
    </group>
  );
}
