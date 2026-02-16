import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Settings, Shield, Bell, Zap, Database, TestTube, Lock, Volume2 } from "lucide-react";
import EscalationRulesManager from "./EscalationRulesManager";
import { AutomationSettings } from "./AutomationSettings";
import { NotificationSettings } from "./NotificationSettings";
import { DatabaseSettings } from "./DatabaseSettings";
import { TestSignalGenerator } from "./TestSignalGenerator";
import { MFAEnrollment } from "./MFAEnrollment";
import { MFASetup } from "./MFASetup";
import { VoiceSettings } from "./VoiceSettings";
import { ChangePassword } from "./ChangePassword";

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

        <Tabs defaultValue="security" className="mt-6">
          <TabsList className="grid w-full grid-cols-7">
            <TabsTrigger value="security">
              <Lock className="w-4 h-4 mr-2" />
              Security
            </TabsTrigger>
            <TabsTrigger value="voice">
              <Volume2 className="w-4 h-4 mr-2" />
              Voice
            </TabsTrigger>
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
            <TabsTrigger value="testing">
              <TestTube className="w-4 h-4 mr-2" />
              Testing
            </TabsTrigger>
            <TabsTrigger value="database">
              <Database className="w-4 h-4 mr-2" />
              Database
            </TabsTrigger>
          </TabsList>

          <TabsContent value="security" className="mt-4 space-y-6">
            <div className="space-y-2">
              <h3 className="text-lg font-semibold">Account Security</h3>
              <p className="text-sm text-muted-foreground">
                Manage your account security settings including password and two-factor authentication.
              </p>
            </div>
            
            {/* Password Management */}
            <ChangePassword />
            
            {/* SMS MFA - Primary Option */}
            <MFASetup />
            
            {/* TOTP MFA - Alternative */}
            <MFAEnrollment />
          </TabsContent>

          <TabsContent value="voice" className="mt-4">
            <VoiceSettings />
          </TabsContent>

          <TabsContent value="escalation" className="mt-4">
            <EscalationRulesManager />
          </TabsContent>

          <TabsContent value="automation" className="mt-4">
            <AutomationSettings />
          </TabsContent>

          <TabsContent value="notifications" className="mt-4">
            <NotificationSettings />
          </TabsContent>

          <TabsContent value="testing" className="mt-4">
            <TestSignalGenerator />
          </TabsContent>

          <TabsContent value="database" className="mt-4">
            <DatabaseSettings />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
};
