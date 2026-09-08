import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { extractClassDocstring } from "@/lib/simDocstring";
import { Lightbulb } from "lucide-react";

interface BehaviourCardProps {
  source: string;
  className?: string;
}

/**
 * "Why it works" companion to the code panel: the algorithm's own design
 * notes, straight from the vendored source's docstring.
 */
export default function BehaviourCard({
  source,
  className,
}: BehaviourCardProps) {
  const docstring = useMemo(() => extractClassDocstring(source), [source]);
  if (!docstring) return null;

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Lightbulb className="h-4 w-4 text-chart-5" />
          Design intent
        </CardTitle>
      </CardHeader>
      <CardContent>
        <pre className="max-h-64 overflow-auto font-sans text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {docstring}
        </pre>
      </CardContent>
    </Card>
  );
}
