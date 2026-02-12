import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useReportSchedules } from "@/hooks/useReportArchive";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CalendarClock, Plus, Trash2, Loader2 } from "lucide-react";
import { format } from "date-fns";

const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const frequencyLabels: Record<string, string> = {
  daily: "Daily",
  weekly: "Weekly",
  biweekly: "Bi-weekly",
  monthly: "Monthly",
};

export const ReportScheduleManager = () => {
  const { schedules, isLoading, createSchedule, toggleSchedule, deleteSchedule } = useReportSchedules();
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    client_id: "",
    report_type: "executive",
    frequency: "weekly",
    day_of_week: 1,
    hour_utc: 13,
    email_recipients: "",
  });

  const { data: clients } = useQuery({
    queryKey: ["clients-for-schedule"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });

  const handleCreate = () => {
    if (!formData.client_id || !formData.email_recipients.trim()) return;

    createSchedule.mutate({
      client_id: formData.client_id,
      report_type: formData.report_type,
      frequency: formData.frequency,
      day_of_week: formData.day_of_week,
      hour_utc: formData.hour_utc,
      email_recipients: formData.email_recipients.split(",").map((e) => e.trim()).filter(Boolean),
      config: { period_days: formData.frequency === "daily" ? 1 : formData.frequency === "monthly" ? 30 : 7 },
    }, {
      onSuccess: () => {
        setShowForm(false);
        setFormData({ client_id: "", report_type: "executive", frequency: "weekly", day_of_week: 1, hour_utc: 13, email_recipients: "" });
      },
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="w-5 h-5 text-primary" />
              Scheduled Reports
            </CardTitle>
            <CardDescription>Automate recurring report generation and email delivery</CardDescription>
          </div>
          <Button size="sm" onClick={() => setShowForm(!showForm)}>
            <Plus className="w-4 h-4 mr-1" />
            New Schedule
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {showForm && (
          <div className="p-4 rounded-lg border border-border bg-muted/30 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Client</label>
                <Select value={formData.client_id} onValueChange={(v) => setFormData({ ...formData, client_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                  <SelectContent>
                    {clients?.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Report Type</label>
                <Select value={formData.report_type} onValueChange={(v) => setFormData({ ...formData, report_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="executive">Executive Report</SelectItem>
                    <SelectItem value="risk_snapshot">Risk Snapshot</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Frequency</label>
                <Select value={formData.frequency} onValueChange={(v) => setFormData({ ...formData, frequency: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="biweekly">Bi-weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Day of Week</label>
                <Select value={String(formData.day_of_week)} onValueChange={(v) => setFormData({ ...formData, day_of_week: parseInt(v) })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {dayNames.map((name, i) => <SelectItem key={i} value={String(i)}>{name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Email Recipients (comma-separated)</label>
              <Input
                placeholder="analyst@company.com, ciso@company.com"
                value={formData.email_recipients}
                onChange={(e) => setFormData({ ...formData, email_recipients: e.target.value })}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button size="sm" onClick={handleCreate} disabled={createSchedule.isPending || !formData.client_id}>
                {createSchedule.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                Create Schedule
              </Button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : !schedules || schedules.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No scheduled reports. Create one to automate delivery.
          </p>
        ) : (
          <div className="space-y-2">
            {schedules.map((schedule: any) => (
              <div key={schedule.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-card">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">
                    {schedule.clients?.name || "Unknown"} — {schedule.report_type === "executive" ? "Executive Report" : "Risk Snapshot"}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-xs text-muted-foreground">
                      {frequencyLabels[schedule.frequency] || schedule.frequency}
                      {schedule.frequency !== "daily" && ` on ${dayNames[schedule.day_of_week]}`}
                      {" at "}
                      {schedule.hour_utc}:00 UTC
                    </span>
                    <span className="text-xs text-muted-foreground">
                      • {schedule.email_recipients?.length || 0} recipient(s)
                    </span>
                    {schedule.next_run_at && (
                      <span className="text-xs text-muted-foreground">
                        • Next: {format(new Date(schedule.next_run_at), "MMM d, h:mm a")}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-2">
                  <Switch
                    checked={schedule.is_active}
                    onCheckedChange={(checked) => toggleSchedule.mutate({ id: schedule.id, is_active: checked })}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => deleteSchedule.mutate(schedule.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
