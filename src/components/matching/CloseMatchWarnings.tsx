import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";
import { format } from "date-fns";

interface CloseMatchWarning {
  id: string;
  normalized_text: string | null;
  created_at: string;
  runner_up_score: number;
  runner_up_client_id: string | null;
  client_id: string | null;
}

interface CloseMatchWarningsProps {
  warnings: CloseMatchWarning[];
}

export function CloseMatchWarnings({ warnings }: CloseMatchWarningsProps) {
  if (warnings.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            Close Match Warnings
          </CardTitle>
          <CardDescription>
            Signals where runner-up match score was greater than 70% of the best match
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <p>No close match warnings found</p>
            <p className="text-sm mt-1">All matches have clear winners</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-yellow-500" />
          Close Match Warnings
          <Badge variant="secondary">{warnings.length}</Badge>
        </CardTitle>
        <CardDescription>
          Signals where runner-up match score was greater than 70% of the best match - 
          consider reviewing these for potential misattribution
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {warnings.map((warning) => (
            <div 
              key={warning.id}
              className="border rounded-lg p-4 bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-900"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm line-clamp-2 mb-2">
                    {warning.normalized_text || "No text available"}
                  </p>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>{format(new Date(warning.created_at), "PPp")}</span>
                    <Badge variant="outline" className="bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200">
                      Runner-up: {(warning.runner_up_score * 100).toFixed(0)}%
                    </Badge>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
