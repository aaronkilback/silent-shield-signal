import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileJson, Lock, Zap, Key, Shield, AlertTriangle, Clock, BookOpen } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

export function ApiDocumentation() {
  const baseUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

  return (
    <div className="space-y-6">
      {/* Quick Start Guide */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Quick Start Guide
          </CardTitle>
          <CardDescription>
            Get started with Fortress AI API in minutes
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="p-4 border rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">1</div>
                  <span className="font-medium">Create API Key</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Go to the API Keys tab and create a new key with the required permissions.
                </p>
              </div>
              <div className="p-4 border rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">2</div>
                  <span className="font-medium">Make Your First Request</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Use your API key in the X-API-Key header to authenticate requests.
                </p>
              </div>
              <div className="p-4 border rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">3</div>
                  <span className="font-medium">Configure Webhooks</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Set up webhooks to receive real-time alerts for critical events.
                </p>
              </div>
            </div>

            <div className="p-4 bg-muted rounded-lg">
              <span className="font-medium">Base URL</span>
              <pre className="mt-2 p-3 bg-background rounded text-sm overflow-x-auto">
                {baseUrl}
              </pre>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Authentication Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            Authentication
          </CardTitle>
          <CardDescription>
            Secure your API access with API Keys or OAuth 2.0
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="api-keys" className="space-y-4">
            <TabsList>
              <TabsTrigger value="api-keys" className="flex items-center gap-2">
                <Key className="h-4 w-4" />
                API Keys
              </TabsTrigger>
              <TabsTrigger value="oauth" className="flex items-center gap-2">
                <Shield className="h-4 w-4" />
                OAuth 2.0
              </TabsTrigger>
            </TabsList>

            <TabsContent value="api-keys" className="space-y-4">
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground mb-3">
                  API keys provide a simple way to authenticate API requests. Include your key in the <code className="bg-background px-1 rounded">X-API-Key</code> header.
                </p>
                <pre className="p-3 bg-background rounded text-xs overflow-x-auto">
{`curl -X GET "${baseUrl}/api-v1-signals" \\
  -H "X-API-Key: fai_your_api_key_here" \\
  -H "Content-Type: application/json"`}
                </pre>
              </div>

              <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="key-format">
                  <AccordionTrigger>API Key Format</AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-2 text-sm">
                      <p>API keys follow the format: <code className="bg-muted px-1 rounded">fai_xxxxxxxxxxxxxxxx</code></p>
                      <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                        <li>Prefix: <code>fai_</code> (Fortress AI)</li>
                        <li>Key: 32 character alphanumeric string</li>
                        <li>Keys are shown once upon creation - store securely</li>
                      </ul>
                    </div>
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="permissions">
                  <AccordionTrigger>Permissions & Scopes</AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-3 text-sm">
                      <p className="text-muted-foreground">API keys can be configured with granular permissions:</p>
                      <div className="grid gap-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">signals:read</Badge>
                          <span className="text-muted-foreground">Read signals and matches</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">signals:write</Badge>
                          <span className="text-muted-foreground">Create and update signals</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">clients:read</Badge>
                          <span className="text-muted-foreground">Read client information</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">clients:write</Badge>
                          <span className="text-muted-foreground">Create and update clients</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">webhooks:manage</Badge>
                          <span className="text-muted-foreground">Configure webhooks</span>
                        </div>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="best-practices">
                  <AccordionTrigger>Security Best Practices</AccordionTrigger>
                  <AccordionContent>
                    <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
                      <li>Never expose API keys in client-side code or version control</li>
                      <li>Rotate keys periodically and after any suspected compromise</li>
                      <li>Use the minimum required permissions for each integration</li>
                      <li>Set expiration dates for temporary integrations</li>
                      <li>Monitor API usage logs for unusual activity</li>
                      <li>Scope keys to specific clients when possible</li>
                    </ul>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </TabsContent>

            <TabsContent value="oauth" className="space-y-4">
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground mb-3">
                  OAuth 2.0 Client Credentials flow for server-to-server authentication. Ideal for automated systems and backend integrations.
                </p>
              </div>

              <div className="border rounded-lg overflow-hidden">
                <div className="p-4 bg-muted/50 border-b">
                  <span className="font-medium">Step 1: Obtain Access Token</span>
                </div>
                <div className="p-4 space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Exchange your client credentials for an access token:
                  </p>
                  <pre className="p-3 bg-muted rounded text-xs overflow-x-auto">
{`curl -X POST "${baseUrl}/oauth-token" \\
  -H "Content-Type: application/json" \\
  -d '{
    "grant_type": "client_credentials",
    "client_id": "your_client_id",
    "client_secret": "your_client_secret",
    "scope": "signals:read clients:read"
  }'`}
                  </pre>
                  <div className="text-sm">
                    <span className="font-medium">Response:</span>
                    <pre className="mt-2 p-3 bg-muted rounded text-xs overflow-x-auto">
{`{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "signals:read clients:read"
}`}
                    </pre>
                  </div>
                </div>
              </div>

              <div className="border rounded-lg overflow-hidden">
                <div className="p-4 bg-muted/50 border-b">
                  <span className="font-medium">Step 2: Use Access Token</span>
                </div>
                <div className="p-4 space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Include the token in the Authorization header for all API requests:
                  </p>
                  <pre className="p-3 bg-muted rounded text-xs overflow-x-auto">
{`curl -X GET "${baseUrl}/api-v1-signals" \\
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..." \\
  -H "Content-Type: application/json"`}
                  </pre>
                </div>
              </div>

              <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="oauth-scopes">
                  <AccordionTrigger>Available Scopes</AccordionTrigger>
                  <AccordionContent>
                    <div className="grid gap-2 text-sm">
                      <div className="flex items-center gap-2">
                        <code className="bg-muted px-2 py-1 rounded">signals:read</code>
                        <span className="text-muted-foreground">Read signals and matches</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <code className="bg-muted px-2 py-1 rounded">signals:write</code>
                        <span className="text-muted-foreground">Create and update signals</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <code className="bg-muted px-2 py-1 rounded">clients:read</code>
                        <span className="text-muted-foreground">Read client information</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <code className="bg-muted px-2 py-1 rounded">clients:write</code>
                        <span className="text-muted-foreground">Manage clients</span>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="token-refresh">
                  <AccordionTrigger>Token Lifecycle</AccordionTrigger>
                  <AccordionContent>
                    <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
                      <li>Access tokens expire after 1 hour (3600 seconds)</li>
                      <li>Request a new token before expiration for uninterrupted access</li>
                      <li>Tokens cannot be refreshed - request a new one using your credentials</li>
                      <li>Store tokens securely and never expose them in logs</li>
                    </ul>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* API Endpoints */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileJson className="h-5 w-5" />
            API Endpoints
          </CardTitle>
          <CardDescription>
            RESTful endpoints for accessing Fortress AI intelligence
          </CardDescription>
        </CardHeader>
        <CardContent>
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
                    <div className="mt-2 grid gap-2 text-sm">
                      <div className="flex items-start gap-2">
                        <code className="bg-muted px-1 rounded min-w-[120px]">client_id</code>
                        <span className="text-muted-foreground">Filter by client UUID</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <code className="bg-muted px-1 rounded min-w-[120px]">severity</code>
                        <span className="text-muted-foreground">Filter by severity (critical, high, medium, low)</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <code className="bg-muted px-1 rounded min-w-[120px]">category</code>
                        <span className="text-muted-foreground">Filter by category</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <code className="bg-muted px-1 rounded min-w-[120px]">status</code>
                        <span className="text-muted-foreground">Filter by status (open, closed, etc.)</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <code className="bg-muted px-1 rounded min-w-[120px]">start_date</code>
                        <span className="text-muted-foreground">ISO date string for range start</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <code className="bg-muted px-1 rounded min-w-[120px]">end_date</code>
                        <span className="text-muted-foreground">ISO date string for range end</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <code className="bg-muted px-1 rounded min-w-[120px]">keyword_search</code>
                        <span className="text-muted-foreground">Text search in signal content</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <code className="bg-muted px-1 rounded min-w-[120px]">limit</code>
                        <span className="text-muted-foreground">Max results (default: 50, max: 100)</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <code className="bg-muted px-1 rounded min-w-[120px]">offset</code>
                        <span className="text-muted-foreground">Pagination offset</span>
                      </div>
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
                    Returns full details for a specific signal including metadata, enrichments, and linked entities.
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
                    <div className="mt-2 grid gap-2 text-sm">
                      <div className="flex items-start gap-2">
                        <code className="bg-muted px-1 rounded min-w-[100px]">industry</code>
                        <span className="text-muted-foreground">Filter by industry</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <code className="bg-muted px-1 rounded min-w-[100px]">status</code>
                        <span className="text-muted-foreground">Filter by status</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <code className="bg-muted px-1 rounded min-w-[100px]">limit</code>
                        <span className="text-muted-foreground">Max results (default: 50, max: 100)</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <code className="bg-muted px-1 rounded min-w-[100px]">offset</code>
                        <span className="text-muted-foreground">Pagination offset</span>
                      </div>
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
                    Returns full client profile including monitoring keywords, high-value assets, and threat profile.
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
                    <Badge variant="destructive">signal.critical</Badge>
                    <span className="font-medium">New Critical Signal</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Triggered immediately when a new signal with critical severity is created. Use for immediate response workflows.
                  </p>
                </div>

                <div className="border rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge className="bg-orange-600">signal.high</Badge>
                    <span className="font-medium">New High Severity Signal</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Triggered when a new signal with high severity is created. Ideal for escalation workflows.
                  </p>
                </div>

                <div className="border rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge className="bg-blue-600">signal.client_match</Badge>
                    <span className="font-medium">Client Match</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Triggered when a signal matches a client's monitoring keywords with confidence ≥70%. Includes match details.
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
  "webhook_id": "uuid",
  "delivery_id": "uuid",
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
    "detected_at": "2025-01-14T12:00:00Z",
    "metadata": { ... }
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
                  <p className="text-sm text-muted-foreground mb-3">
                    Common Event Format for SIEM integration (Splunk, QRadar, ArcSight):
                  </p>
                  <pre className="p-3 bg-muted rounded text-xs overflow-x-auto whitespace-pre-wrap">
{`CEF:0|Fortress|FortressAI|1.0|signal.critical|cyber|10|externalId=uuid msg=Critical%20security%20breach... src=threat_intel cat=cyber cs1=uuid cs1Label=ClientID cs2=Acme%20Corp cs2Label=ClientName cfp1=0.95 cfp1Label=MatchConfidence rt=1705233600000`}
                  </pre>
                </div>
              </div>

              <div className="p-4 bg-muted rounded-lg space-y-3">
                <span className="font-medium">Verifying Webhook Signatures</span>
                <p className="text-sm text-muted-foreground">
                  Each webhook request includes an <code className="bg-background px-1 rounded">X-Fortress-Signature</code> header 
                  containing an HMAC-SHA256 signature. Always verify signatures to ensure authenticity:
                </p>
                <pre className="p-3 bg-background rounded text-xs overflow-x-auto">
{`// Node.js example
const crypto = require('crypto');

function verifyWebhookSignature(payload, signature, secret) {
  const expectedSignature = 'sha256=' + 
    crypto.createHmac('sha256', secret)
      .update(JSON.stringify(payload))
      .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

// Python example
import hmac
import hashlib

def verify_webhook_signature(payload: str, signature: str, secret: str) -> bool:
    expected = 'sha256=' + hmac.new(
        secret.encode(),
        payload.encode(),
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(signature, expected)`}
                </pre>
              </div>

              <div className="p-4 border rounded-lg space-y-3">
                <span className="font-medium">Webhook Delivery & Retry Policy</span>
                <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                  <li>Webhooks expect a 2xx response within 30 seconds</li>
                  <li>Failed deliveries are retried up to 3 times with exponential back-off</li>
                  <li>Retry intervals: 1 minute, 5 minutes, 15 minutes</li>
                  <li>After 3 failures, the delivery is marked as failed</li>
                  <li>View delivery history in the Webhooks tab</li>
                </ul>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Rate Limiting & Error Codes */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            Rate Limiting & Error Handling
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Rate Limiting */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              <span className="font-medium">Rate Limits</span>
            </div>
            <div className="p-4 bg-muted rounded-lg space-y-2 text-sm">
              <p className="text-muted-foreground">
                API requests are rate-limited per API key. Default limits:
              </p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li><strong>60 requests per minute</strong> - Standard API keys</li>
                <li><strong>300 requests per minute</strong> - Enterprise API keys</li>
              </ul>
              <p className="text-muted-foreground mt-2">
                Rate limit headers are included in all responses:
              </p>
              <pre className="p-2 bg-background rounded text-xs mt-2">
{`X-RateLimit-Limit: 60
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1705234200`}
              </pre>
            </div>
          </div>

          {/* Error Codes */}
          <div className="space-y-3">
            <span className="font-medium">HTTP Status Codes</span>
            <div className="grid gap-2">
              <div className="flex items-center gap-3 p-3 border rounded-lg">
                <Badge className="bg-green-600 min-w-[60px] justify-center">200</Badge>
                <div>
                  <span className="font-medium">Success</span>
                  <p className="text-sm text-muted-foreground">Request completed successfully</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 border rounded-lg">
                <Badge variant="secondary" className="min-w-[60px] justify-center">400</Badge>
                <div>
                  <span className="font-medium">Bad Request</span>
                  <p className="text-sm text-muted-foreground">Invalid parameters or malformed request</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 border rounded-lg">
                <Badge variant="destructive" className="min-w-[60px] justify-center">401</Badge>
                <div>
                  <span className="font-medium">Unauthorized</span>
                  <p className="text-sm text-muted-foreground">Missing or invalid API key/token</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 border rounded-lg">
                <Badge variant="destructive" className="min-w-[60px] justify-center">403</Badge>
                <div>
                  <span className="font-medium">Forbidden</span>
                  <p className="text-sm text-muted-foreground">Insufficient permissions for this resource</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 border rounded-lg">
                <Badge variant="secondary" className="min-w-[60px] justify-center">404</Badge>
                <div>
                  <span className="font-medium">Not Found</span>
                  <p className="text-sm text-muted-foreground">Resource does not exist</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 border rounded-lg">
                <Badge className="bg-orange-600 min-w-[60px] justify-center">429</Badge>
                <div>
                  <span className="font-medium">Rate Limited</span>
                  <p className="text-sm text-muted-foreground">Too many requests - wait and retry</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 border rounded-lg">
                <Badge variant="destructive" className="min-w-[60px] justify-center">500</Badge>
                <div>
                  <span className="font-medium">Server Error</span>
                  <p className="text-sm text-muted-foreground">Internal error - contact support if persistent</p>
                </div>
              </div>
            </div>
          </div>

          {/* Error Response Format */}
          <div className="space-y-3">
            <span className="font-medium">Error Response Format</span>
            <pre className="p-3 bg-muted rounded text-xs overflow-x-auto">
{`{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Rate limit exceeded. Please wait before retrying.",
    "details": {
      "limit": 60,
      "reset_at": "2025-01-14T12:05:00Z"
    }
  }
}`}
            </pre>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
