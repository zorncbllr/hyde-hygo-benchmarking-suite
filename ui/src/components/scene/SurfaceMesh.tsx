import { useMemo } from "react";
import * as THREE from "three";
import { applyFieldToGeometry, buildHeightField } from "./heightField";

interface SurfaceMeshProps {
  zs: number[][];
  logScale: boolean;
  wireframe: boolean;
}

/** Benchmark surface: unit plane displaced by normalized function heights. */
export default function SurfaceMesh({
  zs,
  logScale,
  wireframe,
}: SurfaceMeshProps) {
  const field = useMemo(() => buildHeightField(zs, logScale), [zs, logScale]);

  const geometry = useMemo(() => {
    if (!field) return null;
    const geo = new THREE.PlaneGeometry(1, 1, field.cols - 1, field.rows - 1);
    applyFieldToGeometry(geo, field);
    return geo;
  }, [field]);

  if (!geometry || !field) return null;

  return (
    <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]}>
      <meshStandardMaterial
        vertexColors
        side={THREE.DoubleSide}
        wireframe={wireframe}
        roughness={0.7}
        metalness={0.1}
      />
    </mesh>
  );
}
