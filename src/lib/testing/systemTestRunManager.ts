import { runAllTests, TestSuite } from "@/lib/testing/e2eTests";

export type SystemTestRunStatus =
  | "idle"
  | "running"
  | "completed"
  | "failed"
  | "interrupted";

export interface SystemTestRunState {
  status: SystemTestRunStatus;
  startedAt?: string;
  finishedAt?: string;
  results?: TestSuite[];
  error?: string;
}

const STORAGE_KEY = "system-test-run-state-v1";

type Listener = (state: SystemTestRunState) => void;

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function loadState(): SystemTestRunState {
  if (typeof window === "undefined") return { status: "idle" };

  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { status: "idle" };

  const parsed = safeParse(raw) as Partial<SystemTestRunState> | null;
  if (!parsed || typeof parsed !== "object") return { status: "idle" };

  const status = parsed.status;
  const base: SystemTestRunState = {
    status:
      status === "running" ? "interrupted" : (status as SystemTestRunStatus) || "idle",
    startedAt: parsed.startedAt,
    finishedAt: parsed.finishedAt,
    results: parsed.results as TestSuite[] | undefined,
    error:
      status === "running"
        ? "Previous run was interrupted (page refresh/close)."
        : parsed.error,
  };

  return base;
}

let state: SystemTestRunState = loadState();
const listeners = new Set<Listener>();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("Failed to persist system test run state:", e);
  }
}

function emit() {
  for (const l of listeners) l(state);
}

function setState(next: SystemTestRunState) {
  state = next;
  if (typeof window !== "undefined") persist();
  emit();
}

export const systemTestRunManager = {
  getState(): SystemTestRunState {
    return state;
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    // push current immediately
    listener(state);
    return (): void => {
      listeners.delete(listener);
    };
  },

  clear() {
    setState({ status: "idle" });
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  },

  startRun() {
    if (state.status === "running") return;

    const startedAt = new Date().toISOString();
    setState({ status: "running", startedAt });

    const MAX_TOTAL_MS = 5 * 60 * 1000; // 5 minute hard cap

    (async () => {
      try {
        const results = await Promise.race([
          runAllTests(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Test run exceeded 5-minute limit")), MAX_TOTAL_MS)
          ),
        ]);
        setState({
          status: "completed",
          startedAt,
          finishedAt: new Date().toISOString(),
          results,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setState({
          status: "failed",
          startedAt,
          finishedAt: new Date().toISOString(),
          error: message,
        });
      }
    })();
  },
};

