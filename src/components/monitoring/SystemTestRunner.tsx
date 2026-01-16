import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { 
  Play, 
  CheckCircle2, 
  XCircle, 
  ChevronDown,
  Clock,
  RefreshCw,
  AlertTriangle,
  Trash2
} from 'lucide-react';
import { 
  runAllTests, 
  getTestSummary, 
  TestSuite, 
  TestResult 
} from '@/lib/testing/e2eTests';

const STORAGE_KEY = 'system-test-results';

interface StoredTestData {
  results: TestSuite[];
  lastRun: string;
}

export function SystemTestRunner() {
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<TestSuite[] | null>(null);
  const [lastRun, setLastRun] = useState<Date | null>(null);

  // Load persisted results on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const data: StoredTestData = JSON.parse(stored);
        setResults(data.results);
        setLastRun(new Date(data.lastRun));
      }
    } catch (e) {
      console.error('Failed to load stored test results:', e);
    }
  }, []);

  // Persist results when they change
  useEffect(() => {
    if (results && lastRun) {
      try {
        const data: StoredTestData = {
          results,
          lastRun: lastRun.toISOString(),
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch (e) {
        console.error('Failed to persist test results:', e);
      }
    }
  }, [results, lastRun]);

  const handleRunTests = async () => {
    setIsRunning(true);
    try {
      const testResults = await runAllTests();
      setResults(testResults);
      setLastRun(new Date());
    } finally {
      setIsRunning(false);
    }
  };

  const handleClearResults = () => {
    setResults(null);
    setLastRun(null);
    localStorage.removeItem(STORAGE_KEY);
  };

  const summary = results ? getTestSummary(results) : null;

  return (
    <div className="space-y-6">
      {/* Header */}
        <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">System Tests</h2>
          <p className="text-muted-foreground">Run automated tests to verify system health</p>
        </div>
        <div className="flex items-center gap-4">
          {lastRun && (
            <span className="text-sm text-muted-foreground">
              Last run: {lastRun.toLocaleString()}
            </span>
          )}
          {results && (
            <Button 
              variant="outline"
              size="sm"
              onClick={handleClearResults}
              className="gap-2"
            >
              <Trash2 className="h-4 w-4" />
              Clear
            </Button>
          )}
          <Button 
            onClick={handleRunTests} 
            disabled={isRunning}
            className="gap-2"
          >
            {isRunning ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                Running...
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

      {/* Summary */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Pass Rate</CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-3xl font-bold ${summary.passRate === 100 ? 'text-green-500' : summary.passRate >= 80 ? 'text-yellow-500' : 'text-red-500'}`}>
                {summary.passRate.toFixed(0)}%
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Tests Passed</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <span className="text-3xl font-bold text-green-500">{summary.passed}</span>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Tests Failed</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <XCircle className="h-5 w-5 text-red-500" />
                <span className="text-3xl font-bold text-red-500">{summary.failed}</span>
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

      {/* Test Results */}
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
                              <CheckCircle2 className="h-5 w-5 text-green-500" />
                            ) : (
                              <AlertTriangle className="h-5 w-5 text-red-500" />
                            )}
                            <span className="font-medium">{suite.name}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <Badge variant={suite.failed === 0 ? 'default' : 'destructive'}>
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
                            <TestResultRow key={idx} result={test} />
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

      {/* No Results Yet */}
      {!results && !isRunning && (
        <Card>
          <CardContent className="py-12 text-center">
            <Play className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <p className="text-muted-foreground">Click "Run All Tests" to verify system health</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TestResultRow({ result }: { result: TestResult }) {
  return (
    <div className="flex items-center justify-between py-2 px-2 rounded hover:bg-accent/50">
      <div className="flex items-center gap-2">
        {result.passed ? (
          <CheckCircle2 className="h-4 w-4 text-green-500" />
        ) : (
          <XCircle className="h-4 w-4 text-red-500" />
        )}
        <span className={result.passed ? '' : 'text-red-500'}>{result.name}</span>
      </div>
      <div className="flex items-center gap-3">
        {result.error && (
          <span className="text-xs text-red-500 max-w-[300px] truncate">
            {result.error}
          </span>
        )}
        <span className="text-xs text-muted-foreground">
          {result.duration.toFixed(0)}ms
        </span>
      </div>
    </div>
  );
}
