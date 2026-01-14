import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileJson, Lock, Zap } from "lucide-react";

export function ApiDocumentation() {
  const baseUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileJson className="h-5 w-5" />
            API Documentation
          </CardTitle>
          <CardDescription>
            RESTful API endpoints for external system integration
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {/* Authentication */}
            <div className="p-4 bg-muted rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Lock className="h-4 w-4" />
                <span className="font-medium">Authentication</span>
              </div>
              <p className="text-sm text-muted-foreground mb-3">
                All API requests require an API key passed in the <code className="bg-background px-1 rounded">X-API-Key</code> header.
              </p>
              <pre className="p-3 bg-background rounded text-xs overflow-x-auto">
{`curl -X GET "${baseUrl}/api-v1-signals" \\
  -H "X-API-Key: fai_your_api_key_here"`}
              </pre>
            </div>

            {/* Endpoints */}
            <Tabs defaultValue="signals">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="signals">Signals</TabsTrigger>
                <TabsTrigger value="clients">Clients</TabsTrigger>
                <TabsTrigger value="webhooks">Webhook Events</TabsTrigger>
              </TabsList>

              <TabsContent value="signals" className="space-y-4 mt-4">
                {/* GET /signals */}
                <div className="border rounded-lg overflow-hidden">
                  <div className="p-4 bg-muted/50 border-b flex items-center gap-3">
                    <Badge className="bg-green-600">GET</Badge>
                    <code className="text-sm">/api-v1-signals</code>
                    <span className="text-sm text-muted-foreground ml-auto">List signals</span>
                  </div>
                  <div className="p-4 space-y-3">
                    <div>
                      <span className="text-sm font-medium">Query Parameters:</span>
                      <div className="mt-2 space-y-1 text-sm">
                        <div><code>client_id</code> - Filter by client UUID</div>
                        <div><code>severity</code> - Filter by severity (critical, high, medium, low)</div>
                        <div><code>category</code> - Filter by category</div>
                        <div><code>status</code> - Filter by status (open, closed, etc.)</div>
                        <div><code>start_date</code> - ISO date string for range start</div>
                        <div><code>end_date</code> - ISO date string for range end</div>
                        <div><code>keyword_search</code> - Text search in signal content</div>
                        <div><code>limit</code> - Max results (default: 50, max: 100)</div>
                        <div><code>offset</code> - Pagination offset</div>
                      </div>
                    </div>
                    <div>
                      <span className="text-sm font-medium">Example Response:</span>
                      <pre className="mt-2 p-3 bg-muted rounded text-xs overflow-x-auto">
{`{
  "data": [
    {
      "id": "uuid",
      "normalized_text": "Potential threat detected...",
      "source": "news",
      "category": "security",
      "severity": "high",
      "status": "open",
      "client_id": "uuid",
      "match_confidence": 0.85,
      "detected_at": "2025-01-14T12:00:00Z"
    }
  ],
  "pagination": {
    "total": 150,
    "limit": 50,
    "offset": 0,
    "has_more": true
  }
}`}
                      </pre>
                    </div>
                  </div>
                </div>

                {/* GET /signals/{id} */}
                <div className="border rounded-lg overflow-hidden">
                  <div className="p-4 bg-muted/50 border-b flex items-center gap-3">
                    <Badge className="bg-green-600">GET</Badge>
                    <code className="text-sm">/api-v1-signals/{"{signal_id}"}</code>
                    <span className="text-sm text-muted-foreground ml-auto">Get signal details</span>
                  </div>
                  <div className="p-4">
                    <span className="text-sm text-muted-foreground">
                      Returns full details for a specific signal including metadata.
                    </span>
                  </div>
                </div>

                {/* GET /signals/{id}/matches */}
                <div className="border rounded-lg overflow-hidden">
                  <div className="p-4 bg-muted/50 border-b flex items-center gap-3">
                    <Badge className="bg-green-600">GET</Badge>
                    <code className="text-sm">/api-v1-signals/{"{signal_id}"}/matches</code>
                    <span className="text-sm text-muted-foreground ml-auto">Get match data</span>
                  </div>
                  <div className="p-4 space-y-3">
                    <span className="text-sm text-muted-foreground">
                      Returns the client match confidence and timestamp for a signal.
                    </span>
                    <pre className="p-3 bg-muted rounded text-xs overflow-x-auto">
{`{
  "signal_id": "uuid",
  "client_id": "uuid",
  "client_name": "Acme Corp",
  "match_confidence": 0.92,
  "match_timestamp": "2025-01-14T12:00:00Z"
}`}
                    </pre>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="clients" className="space-y-4 mt-4">
                {/* GET /clients */}
                <div className="border rounded-lg overflow-hidden">
                  <div className="p-4 bg-muted/50 border-b flex items-center gap-3">
                    <Badge className="bg-green-600">GET</Badge>
                    <code className="text-sm">/api-v1-clients</code>
                    <span className="text-sm text-muted-foreground ml-auto">List clients</span>
                  </div>
                  <div className="p-4 space-y-3">
                    <div>
                      <span className="text-sm font-medium">Query Parameters:</span>
                      <div className="mt-2 space-y-1 text-sm">
                        <div><code>industry</code> - Filter by industry</div>
                        <div><code>status</code> - Filter by status</div>
                        <div><code>limit</code> - Max results (default: 50, max: 100)</div>
                        <div><code>offset</code> - Pagination offset</div>
                      </div>
                    </div>
                    <pre className="p-3 bg-muted rounded text-xs overflow-x-auto">
{`{
  "data": [
    {
      "id": "uuid",
      "name": "Acme Corporation",
      "industry": "Technology",
      "status": "active",
      "organization": "Enterprise",
      "locations": ["Toronto", "Vancouver"],
      "contact_email": "security@acme.com"
    }
  ],
  "pagination": { ... }
}`}
                    </pre>
                  </div>
                </div>

                {/* GET /clients/{id} */}
                <div className="border rounded-lg overflow-hidden">
                  <div className="p-4 bg-muted/50 border-b flex items-center gap-3">
                    <Badge className="bg-green-600">GET</Badge>
                    <code className="text-sm">/api-v1-clients/{"{client_id}"}</code>
                    <span className="text-sm text-muted-foreground ml-auto">Get client details</span>
                  </div>
                  <div className="p-4">
                    <span className="text-sm text-muted-foreground">
                      Returns full client profile including monitoring keywords and assets.
                    </span>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="webhooks" className="space-y-4 mt-4">
                <div className="p-4 bg-muted rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <Zap className="h-4 w-4" />
                    <span className="font-medium">Webhook Event Types</span>
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">
                    Configure webhooks to receive real-time notifications for these events:
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="border rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge>signal.critical</Badge>
                      <span className="font-medium">New Critical Signal</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Triggered when a new signal with critical severity is created.
                    </p>
                  </div>

                  <div className="border rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge>signal.high</Badge>
                      <span className="font-medium">New High Severity Signal</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Triggered when a new signal with high severity is created.
                    </p>
                  </div>

                  <div className="border rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge>signal.client_match</Badge>
                      <span className="font-medium">Client Match</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Triggered when a signal matches a client's monitoring keywords.
                    </p>
                  </div>
                </div>

                <div className="border rounded-lg overflow-hidden">
                  <div className="p-4 bg-muted/50 border-b">
                    <span className="font-medium">Webhook Payload (JSON format)</span>
                  </div>
                  <div className="p-4">
                    <pre className="p-3 bg-muted rounded text-xs overflow-x-auto">
{`{
  "event_type": "signal.critical",
  "timestamp": "2025-01-14T12:00:00Z",
  "signal": {
    "id": "uuid",
    "normalized_text": "Critical security breach...",
    "source": "threat_intel",
    "category": "cyber",
    "severity": "critical",
    "status": "open",
    "client_id": "uuid",
    "client_name": "Acme Corp",
    "match_confidence": 0.95,
    "detected_at": "2025-01-14T12:00:00Z"
  }
}`}
                    </pre>
                  </div>
                </div>

                <div className="border rounded-lg overflow-hidden">
                  <div className="p-4 bg-muted/50 border-b">
                    <span className="font-medium">Webhook Payload (CEF format)</span>
                  </div>
                  <div className="p-4">
                    <pre className="p-3 bg-muted rounded text-xs overflow-x-auto whitespace-pre-wrap">
{`CEF:0|Fortress|FortressAI|1.0|signal.critical|cyber|10|externalId=uuid msg=Critical%20security%20breach... src=threat_intel cat=cyber cs1=uuid cs1Label=ClientID cs2=Acme%20Corp cs2Label=ClientName cfp1=0.95 cfp1Label=MatchConfidence rt=1705233600000`}
                    </pre>
                  </div>
                </div>

                <div className="p-4 bg-muted rounded-lg">
                  <span className="font-medium">Verifying Webhook Signatures</span>
                  <p className="text-sm text-muted-foreground mt-2">
                    Each webhook request includes an <code>X-Fortress-Signature</code> header 
                    containing an HMAC-SHA256 signature of the payload. Verify it using your 
                    webhook's signing secret:
                  </p>
                  <pre className="mt-3 p-3 bg-background rounded text-xs overflow-x-auto">
{`const crypto = require('crypto');

function verifySignature(payload, signature, secret) {
  const expected = 'sha256=' + 
    crypto.createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}`}
                  </pre>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
