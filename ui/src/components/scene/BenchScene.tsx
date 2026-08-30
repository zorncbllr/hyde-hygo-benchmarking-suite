import type { ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { Center, OrbitControls } from "@react-three/drei";
import SurfaceMesh from "./SurfaceMesh";
import SearchPoints from "./SearchPoints";
import type { AlgoKey, SurfaceResponse } from "@/lib/schemas";

interface BenchSceneProps {
  surface: SurfaceResponse;
  logScale: boolean;
  wireframe: boolean;
  /** algo -> normalized [0,1]^2 population positions */
  positions: Record<string, Array<[number, number]>>;
  /** algo -> normalized [0,1]^2 best-position trail */
  trajectories: Record<string, Array<[number, number]>>;
  visible?: Record<AlgoKey, boolean>;
  heightAt: (xn: number, yn: number) => number;
  /** stats HUD rendered on top of the scene */
  overlay?: ReactNode;
}

/**
 * Shared 3D scene: benchmark surface + live/replay search overlay.
 * Used by the Scene3D workspace, the Live preview panel and dialogs.
 */
export default function BenchScene({
  surface,
  logScale,
  wireframe,
  positions,
  trajectories,
  visible,
  heightAt,
  overlay,
}: BenchSceneProps) {
  return (
    <div className="relative h-full w-full">
      {overlay}
      <Canvas camera={{ position: [0.6, 1.5, 1.6], fov: 50 }}>
        <color attach="background" args={["#0c0c0f"]} />
        <ambientLight intensity={0.75} />
        <directionalLight position={[2, 3, 2]} intensity={1.1} />
        <Center>
          <SurfaceMesh
            zs={surface.zs}
            logScale={logScale}
            wireframe={wireframe}
          />
          <SearchPoints
            positions={positions}
            trajectories={trajectories}
            visible={
              visible ?? {
                hyde_bin: true,
                hyde_qub: true,
                hyde_con: true,
                hygo: true,
              }
            }
            heightAt={heightAt}
          />
        </Center>
        <OrbitControls />
      </Canvas>
    </div>
  );
}
