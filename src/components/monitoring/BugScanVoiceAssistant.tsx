import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Mic, MicOff, Volume2, Loader2, X, Bug, TestTube } from "lucide-react";
import { useOpenAIRealtime } from "@/components/voice/useOpenAIRealtime";

interface BugScanVoiceAssistantProps {
  activeTab: string;
  bugReportCount?: number;
  testResults?: {
    passed: number;
    failed: number;
    passRate: number;
  } | null;
}

export function BugScanVoiceAssistant({ 
  activeTab, 
  bugReportCount = 0,
  testResults 
}: BugScanVoiceAssistantProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [transcript, setTranscript] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([]);
  const [error, setError] = useState<string | null>(null);

  const getContextInstructions = () => {
    const baseContext = `You are AEGIS, assisting with the System Stability dashboard. Current tab: ${activeTab}.`;
    
    if (activeTab === 'reports') {
      return `${baseContext}
        
The user is viewing Bug Reports (${bugReportCount} total). You can help them:
- Understand bug severity levels and prioritization
- Explain the bug workflow stages
- Discuss how to triage and categorize issues
- Provide guidance on writing effective bug descriptions
- Explain the AI fix proposal system`;
    }
    
    if (activeTab === 'tests') {
      const testContext = testResults 
        ? `Test results: ${testResults.passed} passed, ${testResults.failed} failed (${testResults.passRate.toFixed(0)}% pass rate).`
        : 'No test results available yet.';
        
      return `${baseContext}
        
The user is viewing System Tests. ${testContext}

You can help them:
- Explain what each test category covers
- Interpret test failures and suggest debugging steps
- Discuss the auto-report bug feature
- Provide guidance on maintaining system health
- Explain how tests relate to overall platform stability`;
    }
    
    if (activeTab === 'monitoring') {
      return `${baseContext}
        
The user is viewing Error Monitoring. You can help them:
- Explain error patterns and trends
- Identify critical vs minor issues
- Discuss error categorization
- Suggest proactive monitoring strategies`;
    }
    
    return baseContext;
  };

  const {
    status,
    isAgentSpeaking,
    isConnected,
    connect,
    disconnect,
  } = useOpenAIRealtime({
    onTranscript: (text, isFinal) => {
      if (isFinal && text.trim()) {
        setTranscript(prev => [...prev, { role: 'user', text }]);
      }
    },
    onAgentResponseComplete: (text) => {
      if (text.trim()) {
        setTranscript(prev => [...prev, { role: 'assistant', text }]);
      }
    },
    onError: (err) => setError(err),
    agentContext: getContextInstructions(),
  });

  const isConnecting = status === 'connecting';
  const isSpeaking = isAgentSpeaking;

  const handleToggleVoice = useCallback(async () => {
    if (isConnected) {
      disconnect();
    } else {
      setTranscript([]);
      setError(null);
      await connect();
    }
  }, [isConnected, connect, disconnect]);

  if (!isExpanded) {
    return (
      <Button
        onClick={() => setIsExpanded(true)}
        className="fixed bottom-20 right-6 h-14 w-14 rounded-full shadow-lg z-50"
        size="icon"
      >
        <Bug className="h-6 w-6" />
      </Button>
    );
  }

  return (
    <Card className="fixed bottom-20 right-6 w-80 shadow-xl z-50 border-primary/20">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2">
          <TestTube className="h-4 w-4" />
          AEGIS Bug Assistant
        </CardTitle>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setIsExpanded(false)}>
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-xs text-muted-foreground">
          {activeTab === 'reports' && "I can help you understand and triage bug reports."}
          {activeTab === 'tests' && "I can explain test results and debugging strategies."}
          {activeTab === 'monitoring' && "I can help analyze error patterns."}
        </div>

        {transcript.length > 0 && (
          <ScrollArea className="h-32 border rounded-md p-2">
            <div className="space-y-2 text-xs">
              {transcript.map((msg, i) => (
                <div key={i} className={msg.role === 'user' ? 'text-primary' : 'text-muted-foreground'}>
                  <span className="font-medium">{msg.role === 'user' ? '🎙️ You: ' : '🔊 AEGIS: '}</span>
                  {msg.text}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        {error && (
          <div className="text-xs text-destructive bg-destructive/10 p-2 rounded">
            {error}
          </div>
        )}

        <div className="flex items-center justify-center gap-2">
          <Button
            onClick={handleToggleVoice}
            disabled={isConnecting}
            variant={isConnected ? "destructive" : "default"}
            className="gap-2"
          >
            {isConnecting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Connecting...
              </>
            ) : isConnected ? (
              <>
                <MicOff className="h-4 w-4" />
                End Session
              </>
            ) : (
              <>
                <Mic className="h-4 w-4" />
                Start Voice
              </>
            )}
          </Button>

          {isConnected && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              {isSpeaking ? (
                <>
                  <Volume2 className="h-3 w-3 animate-pulse text-primary" />
                  Speaking
                </>
              ) : (
                <>
                  <Mic className="h-3 w-3 text-primary" />
                  Listening
                </>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}