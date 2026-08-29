import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** Simulation workspace - reserved for future implementation. */
export default function SimulationView() {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Simulation</h1>
        <p className="text-sm text-muted-foreground">
          Interactive simulation workspace.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Coming later</CardTitle>
        </CardHeader>
        <CardContent className="py-16 text-center text-sm text-muted-foreground">
          This workspace is reserved for interactive simulation of the
          algorithms. It will be implemented in a future iteration.
        </CardContent>
      </Card>
    </div>
  );
}
