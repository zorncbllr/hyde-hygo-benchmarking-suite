import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { ALGO_COLORS, type AlgoKey } from "@/lib/schemas";

interface SearchPointsProps {
  /** algo -> latest population positions normalized to [0,1]^2 */
  positions: Record<string, Array<[number, number]>>;
  /** algo -> best-position trail normalized to [0,1]^2 */
  trajectories: Record<string, Array<[number, number]>>;
  visible: Record<AlgoKey, boolean>;
  /** surface height sampler for exact on-surface placement */
  heightAt: (xn: number, yn: number) => number;
}

const TRAIL_MAX = 500;

interface AlgoObjects {
  points: THREE.Points;
  line: THREE.Line;
}

/**
 * Live search overlay: population point cloud + best-so-far trail per algo.
 * Built imperatively (THREE.Points/THREE.Line) and mounted via <primitive>.
 */
export default function SearchPoints({
  positions,
  trajectories,
  visible,
  heightAt,
}: SearchPointsProps) {
  const objectsRef = useRef<Record<string, AlgoObjects>>({});
  const [, forceRender] = useState(0);

  // (Re)create objects when the set of algos changes.
  const algos = useMemo(
    () =>
      Array.from(
        new Set([...Object.keys(positions), ...Object.keys(trajectories)]),
      ).sort(),
    [positions, trajectories],
  );
  const algosKey = algos.join(",");

  useMemo(() => {
    for (const [key, obj] of Object.entries(objectsRef.current)) {
      if (!algos.includes(key)) {
        obj.points.geometry.dispose();
        (obj.points.material as THREE.Material).dispose();
        obj.line.geometry.dispose();
        (obj.line.material as THREE.Material).dispose();
        delete objectsRef.current[key];
      }
    }
    for (const algo of algos) {
      if (objectsRef.current[algo]) continue;
      const color = ALGO_COLORS[algo as AlgoKey] ?? "#ffffff";
      const points = new THREE.Points(
        new THREE.BufferGeometry(),
        new THREE.PointsMaterial({
          size: 0.025,
          color,
          sizeAttenuation: true,
          transparent: true,
          opacity: 0.85,
        }),
      );
      const line = new THREE.Line(
        new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }),
      );
      objectsRef.current[algo] = { points, line };
    }
    forceRender((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [algosKey]);

  // Update buffers at telemetry rate.
  useEffect(() => {
    for (const [algo, obj] of Object.entries(objectsRef.current)) {
      const show = visible[algo as AlgoKey] ?? true;
      obj.points.visible = show;
      obj.line.visible = show;

      const pts = positions[algo] ?? [];
      const pArr = new Float32Array(Math.max(pts.length, 1) * 3);
      pts.forEach(([xn, yn], i) => {
        pArr[i * 3] = xn - 0.5;
        pArr[i * 3 + 1] = heightAt(xn, yn) + 0.02;
        pArr[i * 3 + 2] = yn - 0.5;
      });
      obj.points.geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(pArr, 3),
      );
      obj.points.geometry.computeBoundingSphere();

      const trail = (trajectories[algo] ?? []).slice(-TRAIL_MAX);
      const lArr = new Float32Array(Math.max(trail.length, 1) * 3);
      trail.forEach(([xn, yn], i) => {
        lArr[i * 3] = xn - 0.5;
        lArr[i * 3 + 1] = heightAt(xn, yn) + 0.03;
        lArr[i * 3 + 2] = yn - 0.5;
      });
      obj.line.geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(lArr, 3),
      );
      obj.line.geometry.computeBoundingSphere();
    }
  }, [positions, trajectories, visible, heightAt]);

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
