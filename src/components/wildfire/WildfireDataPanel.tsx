import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Flame, Wind, Thermometer, Droplets, AlertTriangle, 
  TrendingUp, TrendingDown, Minus, RefreshCw, Loader2,
  Sun, Cloud, CloudRain
} from 'lucide-react';

interface FWIData {
  region: string;
  fwi_rating: string;
  ffmc: number;
  dmc: number;
  dc: number;
  isi: number;
  bui: number;
  fwi: number;
}

interface WeatherAlert {
  event: string;
  severity: string;
  headline: string;
  areaDesc: string;
  onset: string;
  expires: string;
  urgency: string;
}

export function WildfireDataPanel() {
  const [selectedRegion, setSelectedRegion] = useState('all');

  // Fetch recent wildfire signals
  const { data: wildfireSignals, isLoading: signalsLoading } = useQuery({
    queryKey: ['wildfire-signals'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('signals')
        .select('*')
        .eq('category', 'wildfire')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
    refetchInterval: 60000, // Refresh every minute
  });

  // Mock FWI data (in production this would come from the edge function)
  const fwiData: FWIData[] = [
    { region: 'British Columbia', fwi_rating: 'High', ffmc: 89, dmc: 45, dc: 320, isi: 8, bui: 78, fwi: 24 },
    { region: 'Alberta', fwi_rating: 'Moderate', ffmc: 82, dmc: 38, dc: 280, isi: 6, bui: 62, fwi: 16 },
    { region: 'California', fwi_rating: 'Extreme', ffmc: 94, dmc: 58, dc: 420, isi: 12, bui: 95, fwi: 38 },
    { region: 'Oregon', fwi_rating: 'High', ffmc: 87, dmc: 42, dc: 310, isi: 7, bui: 72, fwi: 21 },
    { region: 'Washington', fwi_rating: 'Moderate', ffmc: 78, dmc: 35, dc: 250, isi: 5, bui: 55, fwi: 12 },
  ];

  // Mock weather alerts
  const weatherAlerts: WeatherAlert[] = [
    { event: 'Red Flag Warning', severity: 'Extreme', headline: 'Critical fire weather conditions expected', areaDesc: 'Los Angeles County Mountains', onset: '2024-08-15T12:00:00', expires: '2024-08-16T21:00:00', urgency: 'Immediate' },
    { event: 'Fire Weather Watch', severity: 'Severe', headline: 'Elevated fire danger developing', areaDesc: 'Interior British Columbia', onset: '2024-08-16T06:00:00', expires: '2024-08-17T18:00:00', urgency: 'Expected' },
    { event: 'Red Flag Warning', severity: 'Extreme', headline: 'Strong winds and low humidity', areaDesc: 'Northern California', onset: '2024-08-15T15:00:00', expires: '2024-08-16T06:00:00', urgency: 'Immediate' },
  ];

  const getFWIColor = (fwi: number) => {
    if (fwi >= 30) return 'text-red-500';
    if (fwi >= 20) return 'text-orange-500';
    if (fwi >= 10) return 'text-yellow-500';
    return 'text-green-500';
  };

  const getFWIBadge = (rating: string) => {
    switch (rating) {
      case 'Extreme': return 'bg-red-600 text-white';
      case 'Very High': return 'bg-orange-600 text-white';
      case 'High': return 'bg-orange-500 text-white';
      case 'Moderate': return 'bg-yellow-500 text-black';
      default: return 'bg-green-500 text-white';
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'Extreme': return 'border-red-500 bg-red-950/30';
      case 'Severe': return 'border-orange-500 bg-orange-950/30';
      case 'Moderate': return 'border-yellow-500 bg-yellow-950/30';
      default: return 'border-green-500 bg-green-950/30';
    }
  };

  const getTrendIcon = (trend: number) => {
    if (trend > 0) return <TrendingUp className="h-4 w-4 text-red-500" />;
    if (trend < 0) return <TrendingDown className="h-4 w-4 text-green-500" />;
    return <Minus className="h-4 w-4 text-muted-foreground" />;
  };

  return (
    <div className="space-y-4">
      <Tabs defaultValue="fwi" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="fwi" className="flex items-center gap-2">
            <Thermometer className="h-4 w-4" />
            Fire Weather Index
          </TabsTrigger>
          <TabsTrigger value="alerts" className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Weather Alerts
          </TabsTrigger>
          <TabsTrigger value="fuel" className="flex items-center gap-2">
            <Droplets className="h-4 w-4" />
            Fuel Moisture
          </TabsTrigger>
          <TabsTrigger value="signals" className="flex items-center gap-2">
            <Flame className="h-4 w-4" />
            Recent Signals
          </TabsTrigger>
        </TabsList>

        {/* Fire Weather Index Tab */}
        <TabsContent value="fwi" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {fwiData.map((region) => (
              <Card key={region.region} className="border-orange-500/20">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{region.region}</CardTitle>
                    <Badge className={getFWIBadge(region.fwi_rating)}>
                      {region.fwi_rating}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-center mb-4">
                    <div className={`text-4xl font-bold ${getFWIColor(region.fwi)}`}>
                      {region.fwi}
                    </div>
                    <div className="ml-2 text-sm text-muted-foreground">FWI</div>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="text-center p-2 bg-muted/50 rounded">
                      <div className="font-medium">FFMC</div>
                      <div className={region.ffmc > 85 ? 'text-orange-500' : 'text-foreground'}>
                        {region.ffmc}
                      </div>
                    </div>
                    <div className="text-center p-2 bg-muted/50 rounded">
                      <div className="font-medium">DMC</div>
                      <div className={region.dmc > 40 ? 'text-orange-500' : 'text-foreground'}>
                        {region.dmc}
                      </div>
                    </div>
                    <div className="text-center p-2 bg-muted/50 rounded">
                      <div className="font-medium">DC</div>
                      <div className={region.dc > 300 ? 'text-red-500' : 'text-foreground'}>
                        {region.dc}
                      </div>
                    </div>
                    <div className="text-center p-2 bg-muted/50 rounded">
                      <div className="font-medium">ISI</div>
                      <div className={region.isi > 7 ? 'text-orange-500' : 'text-foreground'}>
                        {region.isi}
                      </div>
                    </div>
                    <div className="text-center p-2 bg-muted/50 rounded">
                      <div className="font-medium">BUI</div>
                      <div className={region.bui > 70 ? 'text-orange-500' : 'text-foreground'}>
                        {region.bui}
                      </div>
                    </div>
                    <div className="text-center p-2 bg-muted/50 rounded">
                      <div className="font-medium">Trend</div>
                      <div className="flex justify-center">{getTrendIcon(1)}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* FWI Legend */}
          <Card className="mt-4">
            <CardContent className="p-4">
              <h4 className="font-medium mb-2">Fire Weather Index Components</h4>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm text-muted-foreground">
                <div><strong>FFMC:</strong> Fine Fuel Moisture Code (surface litter)</div>
                <div><strong>DMC:</strong> Duff Moisture Code (moderate depth)</div>
                <div><strong>DC:</strong> Drought Code (deep organic layers)</div>
                <div><strong>ISI:</strong> Initial Spread Index (rate of spread)</div>
                <div><strong>BUI:</strong> Build Up Index (total fuel available)</div>
                <div><strong>FWI:</strong> Fire Weather Index (overall intensity)</div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Weather Alerts Tab */}
        <TabsContent value="alerts" className="mt-4">
          <div className="space-y-3">
            {weatherAlerts.map((alert, index) => (
              <Card key={index} className={`border-l-4 ${getSeverityColor(alert.severity)}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        {alert.event === 'Red Flag Warning' ? (
                          <AlertTriangle className="h-5 w-5 text-red-500" />
                        ) : (
                          <Wind className="h-5 w-5 text-orange-500" />
                        )}
                        <h4 className="font-semibold">{alert.event}</h4>
                        <Badge variant="outline" className={
                          alert.urgency === 'Immediate' ? 'border-red-500 text-red-500' : 'border-orange-500 text-orange-500'
                        }>
                          {alert.urgency}
                        </Badge>
                      </div>
                      <p className="text-sm font-medium">{alert.headline}</p>
                      <p className="text-sm text-muted-foreground mt-1">{alert.areaDesc}</p>
                      <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                        <span>Onset: {new Date(alert.onset).toLocaleString()}</span>
                        <span>Expires: {new Date(alert.expires).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Fuel Moisture Tab */}
        <TabsContent value="fuel" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Droplets className="h-5 w-5 text-blue-500" />
                  Live Fuel Moisture Content (LFMC)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span>Chamise</span>
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-2 bg-muted rounded overflow-hidden">
                        <div className="h-full bg-orange-500" style={{ width: '45%' }} />
                      </div>
                      <span className="text-sm font-medium text-orange-500">45%</span>
                    </div>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Manzanita</span>
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-2 bg-muted rounded overflow-hidden">
                        <div className="h-full bg-yellow-500" style={{ width: '62%' }} />
                      </div>
                      <span className="text-sm font-medium text-yellow-500">62%</span>
                    </div>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Douglas Fir</span>
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-2 bg-muted rounded overflow-hidden">
                        <div className="h-full bg-green-500" style={{ width: '78%' }} />
                      </div>
                      <span className="text-sm font-medium text-green-500">78%</span>
                    </div>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Ponderosa Pine</span>
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-2 bg-muted rounded overflow-hidden">
                        <div className="h-full bg-red-500" style={{ width: '38%' }} />
                      </div>
                      <span className="text-sm font-medium text-red-500">38%</span>
                    </div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-4">
                  LFMC below 60% indicates elevated fire risk. Below 40% is critical.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sun className="h-5 w-5 text-yellow-500" />
                  Drought Conditions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="p-3 bg-red-950/30 border border-red-500/30 rounded">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">Exceptional Drought (D4)</span>
                      <Badge className="bg-red-700">12%</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Southern California, Nevada</p>
                  </div>
                  <div className="p-3 bg-orange-950/30 border border-orange-500/30 rounded">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">Extreme Drought (D3)</span>
                      <Badge className="bg-orange-600">18%</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Central California, Arizona</p>
                  </div>
                  <div className="p-3 bg-yellow-950/30 border border-yellow-500/30 rounded">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">Severe Drought (D2)</span>
                      <Badge className="bg-yellow-600">25%</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Pacific Northwest, BC Interior</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Recent Signals Tab */}
        <TabsContent value="signals" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Recent Wildfire Intelligence</CardTitle>
              <Badge variant="outline">{wildfireSignals?.length || 0} signals</Badge>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                {signalsLoading ? (
                  <div className="flex items-center justify-center h-32">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : wildfireSignals?.length === 0 ? (
                  <div className="text-center text-muted-foreground py-8">
                    No wildfire signals detected
                  </div>
                ) : (
                  <div className="space-y-3">
                    {wildfireSignals?.map((signal) => (
                      <div
                        key={signal.id}
                        className={`p-3 rounded border ${
                          signal.severity === 'critical' ? 'border-red-500/50 bg-red-950/20' :
                          signal.severity === 'high' ? 'border-orange-500/50 bg-orange-950/20' :
                          'border-yellow-500/50 bg-yellow-950/20'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <Flame className={`h-4 w-4 ${
                                signal.severity === 'critical' ? 'text-red-500' :
                                signal.severity === 'high' ? 'text-orange-500' : 'text-yellow-500'
                              }`} />
                              <span className="font-medium text-sm">{signal.title || 'Wildfire Alert'}</span>
                              <Badge variant="outline" className="text-xs">
                                {signal.severity}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                              {signal.normalized_text}
                            </p>
                            <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                              {signal.location && <span>📍 {signal.location}</span>}
                              <span>{new Date(signal.created_at).toLocaleString()}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
