import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  useUserConsortia, 
  useConsortiumMembers, 
  useSharedIntelProducts,
  useSharedIncidents,
  usePendingShares
} from "@/hooks/useConsortia";
import { TLPBadge } from "./TLPBadge";
import { CreateConsortiumDialog } from "./CreateConsortiumDialog";
import { AddMemberDialog } from "./AddMemberDialog";
import { 
  ROLE_LABELS, 
  GRANULARITY_LABELS,
  PRODUCT_TYPE_LABELS 
} from "@/lib/consortiumTypes";
import { 
  Shield, 
  Plus, 
  Users, 
  FileText, 
  AlertTriangle,
  Building2,
  Clock,
  CheckCircle,
  Globe,
  Loader2,
  ChevronRight
} from "lucide-react";
import { format } from "date-fns";

export const ConsortiumDashboard = () => {
  const [selectedConsortiumId, setSelectedConsortiumId] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showAddMemberDialog, setShowAddMemberDialog] = useState(false);
  
  const { data: consortia, isLoading: loadingConsortia } = useUserConsortia();
  const { data: members } = useConsortiumMembers(selectedConsortiumId);
  const { data: products } = useSharedIntelProducts(selectedConsortiumId);
  const { data: incidents } = useSharedIncidents(selectedConsortiumId);
  const { data: pendingShares } = usePendingShares(selectedConsortiumId);
  
  const selectedConsortium = consortia?.find(c => c.id === selectedConsortiumId);
  
  if (loadingConsortia) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }
  
  return (
    <div className="space-y-6">
      {/* Consortium Selector */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Shield className="w-5 h-5 text-primary" />
              </div>
              <div>
                <CardTitle>Intelligence Sharing Consortia</CardTitle>
                <CardDescription>Secure intelligence sharing with trusted partners</CardDescription>
              </div>
            </div>
            <Button onClick={() => setShowCreateDialog(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create Consortium
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {consortia && consortia.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {consortia.map((consortium) => (
                <Card 
                  key={consortium.id}
                  className={`cursor-pointer transition-all hover:border-primary ${
                    selectedConsortiumId === consortium.id ? 'border-primary bg-primary/5' : ''
                  }`}
                  onClick={() => setSelectedConsortiumId(consortium.id)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="font-semibold">{consortium.name}</h3>
                        {consortium.region && (
                          <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                            <Globe className="w-3 h-3" />
                            {consortium.region}
                          </p>
                        )}
                      </div>
                      <TLPBadge classification={consortium.classification_default} size="sm" />
                    </div>
                    {consortium.description && (
                      <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                        {consortium.description}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-3">
                      <Badge variant="secondary" className="text-xs">
                        {consortium.sector}
                      </Badge>
                      <ChevronRight className="w-4 h-4 text-muted-foreground ml-auto" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Shield className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <p>No consortia yet. Create one to start sharing intelligence.</p>
            </div>
          )}
        </CardContent>
      </Card>
      
      {/* Selected Consortium Details */}
      {selectedConsortium && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  {selectedConsortium.name}
                  <TLPBadge classification={selectedConsortium.classification_default} showDescription />
                </CardTitle>
                <CardDescription>{selectedConsortium.description}</CardDescription>
              </div>
              <Button onClick={() => setShowAddMemberDialog(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Add Member
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="members">
              <TabsList>
                <TabsTrigger value="members" className="flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  Members ({members?.length || 0})
                </TabsTrigger>
                <TabsTrigger value="products" className="flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Intel Products ({products?.length || 0})
                </TabsTrigger>
                <TabsTrigger value="incidents" className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Shared Incidents ({incidents?.length || 0})
                </TabsTrigger>
                <TabsTrigger value="pending" className="flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  Pending ({pendingShares?.length || 0})
                </TabsTrigger>
              </TabsList>
              
              {/* Members Tab */}
              <TabsContent value="members" className="mt-4">
                {members && members.length > 0 ? (
                  <div className="space-y-3">
                    {members.map((member) => (
                      <Card key={member.id}>
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <Building2 className="w-5 h-5 text-muted-foreground" />
                              <div>
                                <h4 className="font-medium">
                                  {member.client?.name || member.tenant?.name || 'Unknown'}
                                </h4>
                                <p className="text-xs text-muted-foreground">
                                  Joined {format(new Date(member.joined_at), 'MMM d, yyyy')}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline">
                                {ROLE_LABELS[member.role].label}
                              </Badge>
                              <TLPBadge classification={member.max_classification} size="sm" />
                            </div>
                          </div>
                          <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                            <span>Incidents: {GRANULARITY_LABELS[member.sharing_incidents].label}</span>
                            <span>Signals: {GRANULARITY_LABELS[member.sharing_signals].label}</span>
                            {member.nda_signed_at && (
                              <span className="flex items-center gap-1 text-green-500">
                                <CheckCircle className="w-3 h-3" />
                                NDA Signed
                              </span>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Users className="w-12 h-12 mx-auto mb-4 opacity-20" />
                    <p>No members yet. Add organizations to start sharing.</p>
                  </div>
                )}
              </TabsContent>
              
              {/* Intel Products Tab */}
              <TabsContent value="products" className="mt-4">
                {products && products.length > 0 ? (
                  <div className="space-y-3">
                    {products.map((product) => (
                      <Card key={product.id}>
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="flex items-center gap-2">
                                <Badge variant="secondary">
                                  {PRODUCT_TYPE_LABELS[product.product_type].label}
                                </Badge>
                                <TLPBadge classification={product.classification} size="sm" />
                                {product.is_draft && (
                                  <Badge variant="outline">Draft</Badge>
                                )}
                              </div>
                              <h4 className="font-medium mt-2">{product.title}</h4>
                              {product.summary && (
                                <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                                  {product.summary}
                                </p>
                              )}
                            </div>
                            <div className="text-right text-xs text-muted-foreground">
                              <p>{format(new Date(product.created_at), 'MMM d, yyyy')}</p>
                              {product.is_published && (
                                <p className="text-green-500">Published</p>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <FileText className="w-12 h-12 mx-auto mb-4 opacity-20" />
                    <p>No intelligence products yet.</p>
                  </div>
                )}
              </TabsContent>
              
              {/* Shared Incidents Tab */}
              <TabsContent value="incidents" className="mt-4">
                {incidents && incidents.length > 0 ? (
                  <div className="space-y-3">
                    {incidents.map((incident) => (
                      <Card key={incident.id}>
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="flex items-center gap-2">
                                <TLPBadge classification={incident.classification} size="sm" />
                                {incident.severity && (
                                  <Badge variant={incident.severity === 'critical' ? 'destructive' : 'outline'}>
                                    {incident.severity}
                                  </Badge>
                                )}
                              </div>
                              <h4 className="font-medium mt-2">{incident.title}</h4>
                              {incident.description && (
                                <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                                  {incident.description}
                                </p>
                              )}
                              <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                                {incident.region && (
                                  <span className="flex items-center gap-1">
                                    <Globe className="w-3 h-3" />
                                    {incident.region}
                                  </span>
                                )}
                                {incident.threat_category && (
                                  <Badge variant="secondary" className="text-xs">
                                    {incident.threat_category}
                                  </Badge>
                                )}
                              </div>
                            </div>
                            <div className="text-right text-xs text-muted-foreground">
                              <p>Shared {format(new Date(incident.shared_at), 'MMM d, yyyy')}</p>
                              {incident.occurred_at && (
                                <p>Occurred {format(new Date(incident.occurred_at), 'MMM d')}</p>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <AlertTriangle className="w-12 h-12 mx-auto mb-4 opacity-20" />
                    <p>No shared incidents yet.</p>
                  </div>
                )}
              </TabsContent>
              
              {/* Pending Shares Tab */}
              <TabsContent value="pending" className="mt-4">
                {pendingShares && pendingShares.length > 0 ? (
                  <div className="space-y-3">
                    {pendingShares.map((share) => (
                      <Card key={share.id}>
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <Badge variant="outline">{share.source_type}</Badge>
                              <p className="text-sm text-muted-foreground mt-1">
                                Submitted {format(new Date(share.submitted_at), 'MMM d, yyyy HH:mm')}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button size="sm" variant="outline">Reject</Button>
                              <Button size="sm">Approve</Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Clock className="w-12 h-12 mx-auto mb-4 opacity-20" />
                    <p>No pending shares to review.</p>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}
      
      {/* Dialogs */}
      <CreateConsortiumDialog 
        open={showCreateDialog} 
        onOpenChange={setShowCreateDialog} 
      />
      
      {selectedConsortiumId && (
        <AddMemberDialog 
          open={showAddMemberDialog} 
          onOpenChange={setShowAddMemberDialog}
          consortiumId={selectedConsortiumId}
        />
      )}
    </div>
  );
};
