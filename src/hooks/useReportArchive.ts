import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface GeneratedReport {
  id: string;
  user_id: string;
  client_id: string | null;
  report_type: string;
  title: string;
  period_start: string | null;
  period_end: string | null;
  html_content: string;
  pdf_storage_path: string | null;
  metadata: Record<string, any>;
  created_at: string;
}

export interface ReportSchedule {
  id: string;
  user_id: string;
  client_id: string;
  report_type: string;
  frequency: string;
  day_of_week: number;
  hour_utc: number;
  email_recipients: string[];
  is_active: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  config: Record<string, any>;
  created_at: string;
}

export function useReportArchive() {
  const queryClient = useQueryClient();

  const { data: reports, isLoading } = useQuery({
    queryKey: ["generated-reports"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("generated_reports")
        .select("id, user_id, client_id, report_type, title, period_start, period_end, pdf_storage_path, metadata, created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as Omit<GeneratedReport, 'html_content'>[];
    },
  });

  const persistReport = useMutation({
    mutationFn: async (params: {
      report_type: string;
      title: string;
      client_id?: string;
      period_start?: string;
      period_end?: string;
      html_content: string;
      metadata?: Record<string, any>;
    }) => {
      const { data, error } = await supabase.functions.invoke("persist-report", {
        body: params,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["generated-reports"] });
      toast.success("Report archived successfully");
    },
    onError: (error) => {
      console.error("Failed to persist report:", error);
      toast.error("Failed to archive report");
    },
  });

  const deleteReport = useMutation({
    mutationFn: async (reportId: string) => {
      const { error } = await supabase
        .from("generated_reports")
        .delete()
        .eq("id", reportId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["generated-reports"] });
      toast.success("Report deleted");
    },
  });

  const getReportHtml = async (reportId: string): Promise<string> => {
    const { data, error } = await supabase
      .from("generated_reports")
      .select("html_content")
      .eq("id", reportId)
      .single();
    if (error) throw error;
    return data.html_content;
  };

  return { reports, isLoading, persistReport, deleteReport, getReportHtml };
}

export function useReportSchedules() {
  const queryClient = useQueryClient();

  const { data: schedules, isLoading } = useQuery({
    queryKey: ["report-schedules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("report_schedules")
        .select("*, clients(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const createSchedule = useMutation({
    mutationFn: async (params: {
      client_id: string;
      report_type: string;
      frequency: string;
      day_of_week?: number;
      hour_utc?: number;
      email_recipients: string[];
      config?: Record<string, any>;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const nextRun = calculateNextRun(params.frequency, params.day_of_week || 1, params.hour_utc || 13);

      const { data, error } = await supabase
        .from("report_schedules")
        .insert({
          user_id: user.id,
          client_id: params.client_id,
          report_type: params.report_type,
          frequency: params.frequency,
          day_of_week: params.day_of_week || 1,
          hour_utc: params.hour_utc || 13,
          email_recipients: params.email_recipients,
          next_run_at: nextRun.toISOString(),
          config: params.config || {},
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["report-schedules"] });
      toast.success("Report schedule created");
    },
    onError: (error) => {
      toast.error("Failed to create schedule");
      console.error(error);
    },
  });

  const toggleSchedule = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from("report_schedules")
        .update({ is_active })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["report-schedules"] });
    },
  });

  const deleteSchedule = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("report_schedules")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["report-schedules"] });
      toast.success("Schedule deleted");
    },
  });

  return { schedules, isLoading, createSchedule, toggleSchedule, deleteSchedule };
}

function calculateNextRun(frequency: string, dayOfWeek: number, hourUtc: number): Date {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(hourUtc, 0, 0, 0);

  switch (frequency) {
    case 'daily':
      if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
      break;
    case 'weekly':
      do { next.setUTCDate(next.getUTCDate() + 1); } while (next.getUTCDay() !== dayOfWeek);
      break;
    case 'biweekly':
      do { next.setUTCDate(next.getUTCDate() + 1); } while (next.getUTCDay() !== dayOfWeek);
      next.setUTCDate(next.getUTCDate() + 7);
      break;
    case 'monthly':
      next.setUTCMonth(next.getUTCMonth() + 1, 1);
      break;
  }
  return next;
}
