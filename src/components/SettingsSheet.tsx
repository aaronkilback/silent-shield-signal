import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Settings, Shield, Bell, Zap, Database } from "lucide-react";
import EscalationRulesManager from "./EscalationRulesManager";
import { AutomationSettings } from "./AutomationSettings";
import { NotificationSettings } from "./NotificationSettings";
import { DatabaseSettings } from "./DatabaseSettings";

export const SettingsSheet = () => {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm">
          <Settings className="w-4 h-4" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>System Settings</SheetTitle>
        </SheetHeader>

        <Tabs defaultValue="escalation" className="mt-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="escalation">
              <Shield className="w-4 h-4 mr-2" />
              Escalation
            </TabsTrigger>
            <TabsTrigger value="automation">
              <Zap className="w-4 h-4 mr-2" />
              Automation
            </TabsTrigger>
            <TabsTrigger value="notifications">
              <Bell className="w-4 h-4 mr-2" />
              Notifications
            </TabsTrigger>
            <TabsTrigger value="database">
              <Database className="w-4 h-4 mr-2" />
              Database
            </TabsTrigger>
          </TabsList>

          <TabsContent value="escalation" className="mt-4">
            <EscalationRulesManager />
          </TabsContent>

          <TabsContent value="automation" className="mt-4">
            <AutomationSettings />
          </TabsContent>

          <TabsContent value="notifications" className="mt-4">
            <NotificationSettings />
          </TabsContent>

          <TabsContent value="database" className="mt-4">
            <DatabaseSettings />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
};
