import { useCallback, useEffect, useState } from "react";
import {
  systemTestRunManager,
  SystemTestRunState,
} from "@/lib/testing/systemTestRunManager";

export function useSystemTestRun() {
  const [state, setState] = useState<SystemTestRunState>(
    systemTestRunManager.getState()
  );

  useEffect(() => {
    const unsubscribe = systemTestRunManager.subscribe(setState);
    return () => {
      unsubscribe();
    };
  }, []);

  const startRun = useCallback(() => systemTestRunManager.startRun(), []);
  const clearRun = useCallback(() => systemTestRunManager.clear(), []);

  return {
    ...state,
    startRun,
    clearRun,
  };
}
