import { describe, it, expect } from "vitest";
import { canAccessRoute, getNavVisibility, getUiProfile, type UiProfile } from "@/lib/ui-profile";

describe("canAccessRoute — CRT tenant route restrictions", () => {
  const crt: UiProfile = "crt";
  const operator: UiProfile = "operator";

  it("operator profile allows every path (no gate)", () => {
    expect(canAccessRoute(operator, "/vip-deep-scan")).toBe(true);
    expect(canAccessRoute(operator, "/site-audits")).toBe(true);
    expect(canAccessRoute(operator, "/travel")).toBe(true);
    expect(canAccessRoute(operator, "/super-admin")).toBe(true);
    expect(canAccessRoute(operator, "/command-center")).toBe(true);
  });

  it("CRT profile allows the eight explicitly-listed allowed paths", () => {
    for (const allowed of ["/", "/signals", "/incidents", "/clients", "/entities", "/sources", "/reports", "/investigations"]) {
      expect(canAccessRoute(crt, allowed)).toBe(true);
    }
  });

  it("CRT profile blocks the three explicitly-restricted paths", () => {
    expect(canAccessRoute(crt, "/vip-deep-scan")).toBe(false);
    expect(canAccessRoute(crt, "/site-audits")).toBe(false);
    expect(canAccessRoute(crt, "/travel")).toBe(false);
  });

  it("CRT profile blocks everything not in the allowed set (default-deny)", () => {
    expect(canAccessRoute(crt, "/super-admin")).toBe(false);
    expect(canAccessRoute(crt, "/tenant-admin")).toBe(false);
    expect(canAccessRoute(crt, "/command-center")).toBe(false);
    expect(canAccessRoute(crt, "/threat-radar")).toBe(false);
    expect(canAccessRoute(crt, "/intelligence-hub")).toBe(false);
    expect(canAccessRoute(crt, "/user-management")).toBe(false);
    expect(canAccessRoute(crt, "/bug-reports")).toBe(false);
    expect(canAccessRoute(crt, "/integrations")).toBe(false);
  });

  it("CRT profile allows known sub-route prefixes for active list views", () => {
    expect(canAccessRoute(crt, "/investigation/abc-uuid-123")).toBe(true);
    expect(canAccessRoute(crt, "/client/abc-uuid-123")).toBe(true);
    expect(canAccessRoute(crt, "/clients/abc-uuid-123/arcgis")).toBe(true);
  });

  it("CRT profile blocks sub-route prefixes for restricted list views", () => {
    expect(canAccessRoute(crt, "/site-audits/abc-uuid-123")).toBe(false);
  });
});

describe("canAccessRoute — state-bug regression", () => {
  // The production bug: CRT-restricted routes became accessible after
  // navigating through other pages. The route decision must be a pure
  // function of (profile, path) and must NOT depend on call history.
  const crt: UiProfile = "crt";

  it("is stateless — repeated calls in any order return identical results", () => {
    const sequence = [
      "/vip-deep-scan", "/signals", "/vip-deep-scan",
      "/entities", "/vip-deep-scan",
      "/incidents", "/site-audits",
      "/", "/vip-deep-scan", "/travel",
    ];
    const expected: Record<string, boolean> = {
      "/vip-deep-scan": false,
      "/signals": true,
      "/entities": true,
      "/incidents": true,
      "/site-audits": false,
      "/": true,
      "/travel": false,
    };
    for (const path of sequence) {
      expect(canAccessRoute(crt, path)).toBe(expected[path]);
    }
  });

  it("simulated navigation: restricted → allowed → restricted preserves denial", () => {
    expect(canAccessRoute(crt, "/vip-deep-scan")).toBe(false);
    expect(canAccessRoute(crt, "/signals")).toBe(true);
    expect(canAccessRoute(crt, "/incidents")).toBe(true);
    expect(canAccessRoute(crt, "/entities")).toBe(true);
    expect(canAccessRoute(crt, "/reports")).toBe(true);
    // After navigating through five allowed pages, restricted routes
    // must STILL be denied. The regression report described this exact
    // sequence breaking.
    expect(canAccessRoute(crt, "/vip-deep-scan")).toBe(false);
    expect(canAccessRoute(crt, "/site-audits")).toBe(false);
    expect(canAccessRoute(crt, "/travel")).toBe(false);
  });

  it("running the same check 1000 times never changes the answer", () => {
    for (let i = 0; i < 1000; i++) {
      expect(canAccessRoute(crt, "/vip-deep-scan")).toBe(false);
      expect(canAccessRoute(crt, "/signals")).toBe(true);
    }
  });
});

describe("getNavVisibility delegates to canAccessRoute (single source of truth)", () => {
  const crt: UiProfile = "crt";

  it("returns 'active' iff canAccessRoute returns true", () => {
    expect(getNavVisibility(crt, "/signals")).toBe("active");
    expect(getNavVisibility(crt, "/investigations")).toBe("active");
    expect(getNavVisibility(crt, "/investigation/abc")).toBe("active");
  });

  it("returns 'greyed' for explicitly-greyed paths (visible-but-disabled affordance)", () => {
    expect(getNavVisibility(crt, "/vip-deep-scan")).toBe("greyed");
    expect(getNavVisibility(crt, "/site-audits")).toBe("greyed");
    expect(getNavVisibility(crt, "/travel")).toBe("greyed");
  });

  it("returns 'hidden' for paths that are neither allowed nor explicitly greyed", () => {
    expect(getNavVisibility(crt, "/super-admin")).toBe("hidden");
    expect(getNavVisibility(crt, "/command-center")).toBe("hidden");
    expect(getNavVisibility(crt, "/threat-radar")).toBe("hidden");
  });

  it("operator profile is universally 'active'", () => {
    expect(getNavVisibility("operator", "/vip-deep-scan")).toBe("active");
    expect(getNavVisibility("operator", "/super-admin")).toBe("active");
    expect(getNavVisibility("operator", "/anything-at-all")).toBe("active");
  });
});

describe("getUiProfile — tenant settings derivation", () => {
  it("returns 'crt' when tenant.settings.ui_profile === 'crt'", () => {
    expect(getUiProfile({ ui_profile: "crt" })).toBe("crt");
  });

  it("returns 'operator' for everything else (missing, null, other values)", () => {
    expect(getUiProfile(null)).toBe("operator");
    expect(getUiProfile(undefined)).toBe("operator");
    expect(getUiProfile({})).toBe("operator");
    expect(getUiProfile({ ui_profile: "operator" })).toBe("operator");
    expect(getUiProfile({ ui_profile: "unknown" })).toBe("operator");
  });
});
