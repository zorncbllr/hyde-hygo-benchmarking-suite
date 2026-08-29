import { Route, Routes } from "react-router-dom";
import App from "./App";
import RunView from "./views/RunView";
import ResultsView from "./views/ResultsView";
import SimulationView from "./views/SimulationView";

export default function AppRoutes() {
  return (
    <Routes>
      <Route element={<App />}>
        <Route index element={<RunView />} />
        <Route path="/run" element={<RunView />} />
        <Route path="/results" element={<ResultsView />} />
        <Route path="/simulation" element={<SimulationView />} />
      </Route>
    </Routes>
  );
}
