import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Play,
  RefreshCw,
  Trash2,
  XCircle,
} from "lucide-react";

import { getTestSummary, TestResult, TestSuite } from "@/lib/testing/e2eTests";
import { useSystemTestRun } from "@/hooks/useSystemTestRun";

const AUTO_REPORT_KEY = "system-test-auto-report-bugs-v1";
const LAST_REPORTED_RUN_KEY = "system-test-last-reported-run-v1";

function buildFailuresMarkdown(results: TestSuite[]) {
  const lines: string[] = [];
  for (const suite of results) {
    for (const r of suite.results) {
      if (!r.passed) {
        lines.push(`- [${suite.name}] ${r.name}${r.error ? ` — ${r.error}` : ""}`);
      }
    }
  }
  return lines.length ? lines.join("\n") : "(No failures)";
}

async function createBugReportFromFailures(results: TestSuite[]) {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;
  if (!userData.user) throw new Error("You must be logged in to create bug reports");

  const summary = getTestSummary(results);
  const failedCount = summary.failed;

  const title = `System Tests Failed (${failedCount})`;
  const description = [
    `Automated system tests reported failures.`,
    "",
    `Run time: ${new Date().toISOString()}`,
    `Pass rate: ${summary.passRate.toFixed(0)}%`,
    `Duration: ${(summary.totalDuration / 1000).toFixed(2)}s`,
    "",
    "Failures:",
    buildFailuresMarkdown(results),
  ].join("\n");

  const severity = failedCount >= 10 ? "high" : "medium";

  const { error } = await supabase.from("bug_reports").insert({
    title,
    description,
    severity,
    status: "open",
    page_url: typeof window !== "undefined" ? window.location.href : null,
    browser_info: typeof navigator !== "undefined" ? navigator.userAgent : null,
  });

  if (error) throw error;
}

export function SystemTestRunner() {
  const { status, results, startedAt, finishedAt, error, startRun, clearRun } = useSystemTestRun();

  const [autoReport, setAutoReport] = useState(() => {
    try {
      const raw = localStorage.getItem(AUTO_REPORT_KEY);
      return raw ? raw === "true" : true;
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(AUTO_REPORT_KEY, String(autoReport));
    } catch {
      // ignore
    }
  }, [autoReport]);

  const summary = useMemo(() => (results ? getTestSummary(results) : null), [results]);

  const failedCount = summary?.failed ?? 0;
  const canReport = !!results && failedCount > 0;

  // Auto-create a bug report once per completed run.
  useEffect(() => {
    if (!autoReport) return;
    if (!results || !finishedAt) return;
    if (failedCount <= 0) return;

    const key = finishedAt;
    const already = (() => {
      try {
        return localStorage.getItem(LAST_REPORTED_RUN_KEY) === key;
      } catch {
        return false;
      }
    })();

    if (already) return;

    (async () => {
      try {
        await createBugReportFromFailures(results);
        try {
          localStorage.setItem(LAST_REPORTED_RUN_KEY, key);
        } catch {
          // ignore
        }
        toast.success("Created a bug report from failed system tests");
      } catch (e) {
        // Don't block UI; just inform.
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(`Couldn't create bug report: ${msg}`);
      }
    })();
  }, [autoReport, results, finishedAt, failedCount]);

  const handleReportNow = async () => {
    if (!results) return;
    try {
      await createBugReportFromFailures(results);
      if (finishedAt) {
        try {
          localStorage.setItem(LAST_REPORTED_RUN_KEY, finishedAt);
        } catch {
          // ignore
        }
      }
      toast.success("Bug report created from test failures");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Couldn't create bug report: ${msg}`);
    }
  };

  const isRunning = status === "running";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">System Tests</h2>
          <p className="text-muted-foreground">
            Runs persist even if you navigate away
          </p>
        </div>

        <div className="flex items-center gap-3">
          {startedAt && (
            <span className="text-sm text-muted-foreground">
              {status === "running" ? "Started" : "Last run"}: {new Date(startedAt).toLocaleString()}
            </span>
          )}

          {results && (
            <Button variant="outline" size="sm" onClick={clearRun} className="gap-2">
              <Trash2 className="h-4 w-4" />
              Clear
            </Button>
          )}

          <Button onClick={startRun} disabled={isRunning} className="gap-2">
            {isRunning ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                Running…
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                Run All Tests
              </>
            )}
          </Button>
        </div>
      </div>

      {status === "failed" && error && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Test Runner Error
            </CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      )}

      {status === "interrupted" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-muted-foreground" />
              Previous run was interrupted
            </CardTitle>
            <CardDescription>
              This can happen if the tab was refreshed/closed mid-run.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Pass Rate</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{summary.passRate.toFixed(0)}%</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Tests Passed</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-primary" />
                <span className="text-3xl font-bold text-primary">{summary.passed}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Tests Failed</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <XCircle className="h-5 w-5 text-destructive" />
                <span className="text-3xl font-bold text-destructive">{summary.failed}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Duration</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-muted-foreground" />
                <span className="text-3xl font-bold">{(summary.totalDuration / 1000).toFixed(2)}s</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {canReport && (
        <Card>
          <CardHeader>
            <CardTitle>Bug report export</CardTitle>
            <CardDescription>
              Push failed test results into Bug Reports so you can send them here.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="auto-report">Auto-create bug report</Label>
              <Switch
                id="auto-report"
                checked={autoReport}
                onCheckedChange={setAutoReport}
              />
            </div>

            <Button variant="outline" onClick={handleReportNow}>
              Create Bug Report Now
            </Button>
          </CardContent>
        </Card>
      )}

      {results && (
        <Card>
          <CardHeader>
            <CardTitle>Test Results</CardTitle>
            <CardDescription>Detailed results by category</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[500px]">
              <div className="space-y-4">
                {results.map((suite) => (
                  <Collapsible key={suite.name} defaultOpen={suite.failed > 0}>
                    <Card>
                      <CollapsibleTrigger className="w-full">
                        <div className="flex items-center justify-between p-4">
                          <div className="flex items-center gap-3">
                            {suite.failed === 0 ? (
                              <CheckCircle2 className="h-5 w-5 text-primary" />
                            ) : (
                              <AlertTriangle className="h-5 w-5 text-destructive" />
                            )}
                            <span className="font-medium">{suite.name}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <Badge variant={suite.failed === 0 ? "default" : "destructive"}>
                              {suite.passed}/{suite.results.length} passed
                            </Badge>
                            <span className="text-sm text-muted-foreground">
                              {(suite.totalDuration / 1000).toFixed(2)}s
                            </span>
                            <ChevronDown className="h-4 w-4" />
                          </div>
                        </div>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="border-t px-4 py-2 space-y-2">
                          {suite.results.map((test, idx) => (
                            <TestResultRow key={idx} suiteName={suite.name} result={test} />
                          ))}
                        </div>
                      </CollapsibleContent>
                    </Card>
                  </Collapsible>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {!results && status !== "running" && (
        <Card>
          <CardContent className="py-12 text-center">
            <Play className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <p className="text-muted-foreground">Click “Run All Tests” to verify system health</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TestResultRow({
  result,
}: {
  suiteName: string;
  result: TestResult;
}) {
  return (
    <div className="flex items-center justify-between py-2 px-2 rounded hover:bg-accent/50">
      <div className="flex items-center gap-2">
        {result.passed ? (
          <CheckCircle2 className="h-4 w-4 text-primary" />
        ) : (
          <XCircle className="h-4 w-4 text-destructive" />
        )}
        <span className={result.passed ? "" : "text-destructive"}>{result.name}</span>
      </div>
      <div className="flex items-center gap-3">
        {result.error && (
          <span className="text-xs text-destructive max-w-[300px] truncate">{result.error}</span>
        )}
        <span className="text-xs text-muted-foreground">{result.duration.toFixed(0)}ms</span>
      </div>
    </div>
  );
}
