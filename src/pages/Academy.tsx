import { useState } from "react";
import { PageLayout } from "@/components/PageLayout";
import { GraduationCap, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AcademyIntake } from "@/components/academy/AcademyIntake";
import { AcademyCourseCard } from "@/components/academy/AcademyCourseCard";
import { AcademyScenario } from "@/components/academy/AcademyScenario";
import { AcademyTrainingBridge } from "@/components/academy/AcademyTrainingBridge";
import { AcademyResults } from "@/components/academy/AcademyResults";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

type PageState =
  | { view: "loading" }
  | { view: "intake" }
  | { view: "browse"; courses: any[]; progress: Record<string, any> }
  | { view: "pre_scenario"; course: any; scenario: any }
  | { view: "pre_results"; course: any; result: any; preScore: number }
  | { view: "training_bridge"; course: any; preScore: number }
  | { view: "post_scenario"; course: any; scenario: any }
  | { view: "post_results"; course: any; result: any }
  | { view: "followup_scenario"; course: any; scenario: any }
  | { view: "followup_results"; course: any; result: any };

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";

async function callEdgeFunction(name: string, body: object) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`${name} failed: ${err.slice(0, 200)}`);
  }
  return resp.json();
}

export default function Academy() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [pageState, setPageState] = useState<PageState>({ view: "loading" });
  const [submitting, setSubmitting] = useState(false);

  // Load learner profile and courses
  const { isLoading: profileLoading } = useQuery({
    queryKey: ["academy-init", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;

      // Check for existing profile
      const { data: profile } = await supabase
        .from("academy_learner_profiles")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!profile) {
        setPageState({ view: "intake" });
        return null;
      }

      // Load courses + progress
      const [coursesRes, progressRes] = await Promise.all([
        supabase
          .from("academy_courses")
          .select("id, title, description, scenario_domain, difficulty_level, agent_call_sign, generation_status, published")
          .eq("published", true)
          .eq("generation_status", "complete")
          .order("difficulty_level", { ascending: true }),
        supabase
          .from("academy_judgment_progress")
          .select("*")
          .eq("user_id", user.id),
      ]);

      const courses  = coursesRes.data  || [];
      const progress = Object.fromEntries((progressRes.data || []).map(p => [p.course_id, p]));

      setPageState({ view: "browse", courses, progress });
      return { profile, courses, progress };
    },
    enabled: !!user?.id,
  });

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleIntakeComplete = async (answers: Record<string, string>, contact: any) => {
    if (!user?.id) return;
    setSubmitting(true);
    try {
      await callEdgeFunction("academy-intake", { userId: user.id, answers, contact });

      // Reload
      const [coursesRes, progressRes] = await Promise.all([
        supabase
          .from("academy_courses")
          .select("id, title, description, scenario_domain, difficulty_level, agent_call_sign")
          .eq("published", true)
          .eq("generation_status", "complete")
          .order("difficulty_level", { ascending: true }),
        supabase
          .from("academy_judgment_progress")
          .select("*")
          .eq("user_id", user.id),
      ]);

      const courses  = coursesRes.data  || [];
      const progress = Object.fromEntries((progressRes.data || []).map(p => [p.course_id, p]));
      setPageState({ view: "browse", courses, progress });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Intake failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleStartCourse = async (courseId: string) => {
    if (pageState.view !== "browse") return;
    const course = pageState.courses.find(c => c.id === courseId);
    if (!course) return;

    const progress = pageState.progress[courseId];
    const status   = progress?.status || "enrolled";

    // Follow-up path
    if (status === "followup_pending") {
      const { data: scenario } = await supabase
        .from("academy_scenarios")
        .select("*")
        .eq("course_id", courseId)
        .eq("variant_index", 1)
        .maybeSingle();
      if (scenario) {
        setPageState({ view: "followup_scenario", course, scenario });
      }
      return;
    }

    // Post-test path
    if (status === "post_complete" || status === "in_training" || status === "pre_complete") {
      const { data: scenario } = await supabase
        .from("academy_scenarios")
        .select("*")
        .eq("course_id", courseId)
        .eq("variant_index", 1)
        .maybeSingle();
      if (scenario) {
        if (status === "pre_complete") {
          setPageState({ view: "training_bridge", course, preScore: progress?.pre_score ?? 0 });
        } else {
          setPageState({ view: "post_scenario", course, scenario });
        }
      }
      return;
    }

    // Pre-test path (default)
    const { data: scenario } = await supabase
      .from("academy_scenarios")
      .select("*")
      .eq("course_id", courseId)
      .eq("variant_index", 0)
      .maybeSingle();

    if (!scenario) {
      toast.error("Scenario not yet generated for this course.");
      return;
    }
    setPageState({ view: "pre_scenario", course, scenario });
  };

  const handleScenarioSubmit = async (
    courseId: string,
    scenarioId: string,
    stage: "pre" | "post" | "30day",
    response: any,
  ) => {
    if (!user?.id) return;
    setSubmitting(true);
    try {
      const result = await callEdgeFunction("academy-score", {
        userId: user.id,
        scenarioId,
        courseId,
        stage,
        ...response,
      });

      if (pageState.view === "pre_scenario") {
        setPageState({
          view: "pre_results",
          course: (pageState as any).course,
          result,
          preScore: result.totalScore,
        });
      } else if (pageState.view === "post_scenario") {
        setPageState({ view: "post_results", course: (pageState as any).course, result });
      } else if (pageState.view === "followup_scenario") {
        setPageState({ view: "followup_results", course: (pageState as any).course, result });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Scoring failed");
    } finally {
      setSubmitting(false);
    }
  };

  const goToBrowse = async () => {
    if (!user?.id) return;
    const [coursesRes, progressRes] = await Promise.all([
      supabase
        .from("academy_courses")
        .select("id, title, description, scenario_domain, difficulty_level, agent_call_sign")
        .eq("published", true)
        .eq("generation_status", "complete")
        .order("difficulty_level", { ascending: true }),
      supabase
        .from("academy_judgment_progress")
        .select("*")
        .eq("user_id", user.id),
    ]);
    const courses  = coursesRes.data  || [];
    const progress = Object.fromEntries((progressRes.data || []).map(p => [p.course_id, p]));
    setPageState({ view: "browse", courses, progress });
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  const renderContent = () => {
    if (profileLoading || pageState.view === "loading") {
      return (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      );
    }

    if (pageState.view === "intake") {
      return (
        <div className="py-8">
          <div className="text-center mb-10 space-y-2">
            <h2 className="text-2xl font-bold text-foreground">Welcome to Fortress Academy</h2>
            <p className="text-muted-foreground">
              Answer 5 questions to match you with the right courses and agent.
            </p>
          </div>
          <AcademyIntake onComplete={handleIntakeComplete} loading={submitting} />
        </div>
      );
    }

    if (pageState.view === "browse") {
      const { courses, progress } = pageState;
      return (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {courses.map(course => (
              <AcademyCourseCard
                key={course.id}
                course={course}
                progress={progress[course.id]}
                onStart={handleStartCourse}
              />
            ))}
          </div>
          {courses.length === 0 && (
            <div className="text-center py-16 text-muted-foreground">
              <GraduationCap className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p>No courses available yet. Scenarios are being generated.</p>
            </div>
          )}
        </div>
      );
    }

    if (pageState.view === "pre_scenario") {
      const { course, scenario } = pageState;
      return (
        <div className="py-6">
          <Button variant="ghost" size="sm" onClick={goToBrowse} className="mb-6 text-muted-foreground">
            ← Back to courses
          </Button>
          <AcademyScenario
            scenario={scenario}
            stage="pre"
            onSubmit={(resp) => handleScenarioSubmit(course.id, scenario.id, "pre", resp)}
            loading={submitting}
          />
        </div>
      );
    }

    if (pageState.view === "pre_results") {
      const { course, result, preScore } = pageState;
      return (
        <div className="py-6">
          <AcademyResults
            stage="pre"
            result={result}
            courseTitle={course.title}
            continueLabel="Begin Training"
            onContinue={() => setPageState({ view: "training_bridge", course, preScore })}
          />
        </div>
      );
    }

    if (pageState.view === "training_bridge") {
      const { course, preScore } = pageState;
      return (
        <div className="py-6">
          <AcademyTrainingBridge
            agentCallSign={course.agent_call_sign}
            courseDomain={course.scenario_domain}
            courseTitle={course.title}
            preScore={preScore}
            onBeginTraining={() => navigate(`/command-center?agent=${course.agent_call_sign}&context=${encodeURIComponent(`Training for "${course.title}" — focus on the domain principles and decision doctrine. I just completed a pre-test scenario.`)}`)}
            onSkipToPost={async () => {
              const { data: scenario } = await supabase
                .from("academy_scenarios")
                .select("*")
                .eq("course_id", course.id)
                .eq("variant_index", 1)
                .maybeSingle();
              if (scenario) {
                setPageState({ view: "post_scenario", course, scenario });
              }
            }}
          />
        </div>
      );
    }

    if (pageState.view === "post_scenario") {
      const { course, scenario } = pageState;
      return (
        <div className="py-6">
          <Button variant="ghost" size="sm" onClick={goToBrowse} className="mb-6 text-muted-foreground">
            ← Back to courses
          </Button>
          <AcademyScenario
            scenario={scenario}
            stage="post"
            onSubmit={(resp) => handleScenarioSubmit(course.id, scenario.id, "post", resp)}
            loading={submitting}
          />
        </div>
      );
    }

    if (pageState.view === "post_results") {
      const { course, result } = pageState;
      return (
        <div className="py-6">
          <AcademyResults
            stage="post"
            result={result}
            courseTitle={course.title}
            continueLabel="Back to Courses"
            onContinue={goToBrowse}
          />
        </div>
      );
    }

    if (pageState.view === "followup_scenario") {
      const { course, scenario } = pageState;
      return (
        <div className="py-6">
          <Button variant="ghost" size="sm" onClick={goToBrowse} className="mb-6 text-muted-foreground">
            ← Back to courses
          </Button>
          <AcademyScenario
            scenario={scenario}
            stage="30day"
            onSubmit={(resp) => handleScenarioSubmit(course.id, scenario.id, "30day", resp)}
            loading={submitting}
          />
        </div>
      );
    }

    if (pageState.view === "followup_results") {
      const { course, result } = pageState;
      return (
        <div className="py-6">
          <AcademyResults
            stage="30day"
            result={result}
            courseTitle={course.title}
            continueLabel="Back to Courses"
            onContinue={goToBrowse}
          />
        </div>
      );
    }

    return null;
  };

  return (
    <PageLayout>
      <div className="space-y-6">
        {/* Page header — only show on browse/loading */}
        {(pageState.view === "browse" || pageState.view === "loading") && (
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-lg bg-primary/10">
              <GraduationCap className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-foreground">Fortress Academy</h1>
              <p className="text-muted-foreground">
                Judgment training and decision validation for security professionals
              </p>
            </div>
          </div>
        )}

        {renderContent()}
      </div>
    </PageLayout>
  );
}
