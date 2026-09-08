import { useEffect, type ReactNode } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Center, OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import SurfaceMesh from "./SurfaceMesh";
import SearchPoints from "./SearchPoints";
import type { AlgoKey, SurfaceResponse } from "@/lib/schemas";

/** Vertical pan clamp: keeps the orbit target around the surface band. */
const TARGET_Y_MIN = -0.25;
const TARGET_Y_MAX = 1.4;

/**
 * Shift + mouse wheel pans the camera and orbit target vertically instead
 * of zooming: the zoom-in gesture (wheel up) moves the view down, the
 * zoom-out gesture (wheel down) moves it up. The wheel event is intercepted
 * in the capture phase on the canvas container, so OrbitControls never sees
 * it and no zoom is applied.
 */
function ShiftWheelVerticalPan() {
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    if (!controls) return;
    // attach in the capture phase on the container: capture handlers on the
    // parent run before the canvas listeners OrbitControls registered
    const el = gl.domElement.parentElement ?? gl.domElement;
    const onWheel = (e: WheelEvent) => {
      if (!e.shiftKey || e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();
      const dist = camera.position.distanceTo(controls.target);
      const raw = controls.target.y - (e.deltaY / 100) * 0.08 * dist;
      const y = Math.min(TARGET_Y_MAX, Math.max(TARGET_Y_MIN, raw));
      const delta = y - controls.target.y;
      if (delta === 0) return;
      controls.target.y = y;
      camera.position.y += delta;
      controls.update();
      invalidate();
    };
    el.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel, { capture: true });
    };
  }, [controls, camera, gl, invalidate]);

  return null;
}

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
  /** point size in world units (default: compact) */
  pointSize?: number;
  /** trail line width in screen pixels (0 = plain 1px line) */
  trailWidth?: number;
  /** terrain palette for the surface mesh (default: viridis) */
  palette?: "viridis" | "redblack";
  /** stats HUD rendered on top of the scene */
  overlay?: ReactNode;
}

/**
 * Shared 3D scene: benchmark surface + live/replay search overlay.
 * Used by the Scene3D workspace, the Live preview panel, dialogs and the
 * Simulation page.
 */
export default function BenchScene({
  surface,
  logScale,
  wireframe,
  positions,
  trajectories,
  visible,
  heightAt,
  pointSize,
  trailWidth,
  palette,
  overlay,
}: BenchSceneProps) {
  return (
    <div className="relative h-full w-full">
      {overlay}
      <Canvas
        camera={{ position: [0.6, 1.5, 1.6], fov: 50 }}
        frameloop="demand"
        dpr={[1, 1.5]}
        gl={{ powerPreference: "high-performance" }}
      >
        <color attach="background" args={["#0c0c0f"]} />
        <ambientLight intensity={0.75} />
        <directionalLight position={[2, 3, 2]} intensity={1.1} />
        <Center>
          <SurfaceMesh
            zs={surface.zs}
            logScale={logScale}
            wireframe={wireframe}
            palette={palette}
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
            pointSize={pointSize}
            trailWidth={trailWidth}
          />
        </Center>
        <OrbitControls makeDefault />
        <ShiftWheelVerticalPan />
      </Canvas>
    </div>
  );
}
