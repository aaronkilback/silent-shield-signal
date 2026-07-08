// C-1 tier mapping tests. Run: deno test supabase/functions/_shared/alert-tier.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mapThreatLevelToTier, isDeliveryTier, DELIVERY_TIERS, UNROUTED_RECIPIENT } from "./alert-tier.ts";

Deno.test("threat_level -> tier per master table", () => {
  assertEquals(mapThreatLevelToTier("low"), "log");
  assertEquals(mapThreatLevelToTier("medium"), "finding");
  assertEquals(mapThreatLevelToTier("high"), "notification");
  assertEquals(mapThreatLevelToTier("critical"), "interruption");
});

Deno.test("case / whitespace insensitive", () => {
  assertEquals(mapThreatLevelToTier("HIGH"), "notification");
  assertEquals(mapThreatLevelToTier("  Critical "), "interruption");
});

Deno.test("unknown / null / empty -> most conservative log (never emails)", () => {
  assertEquals(mapThreatLevelToTier(null), "log");
  assertEquals(mapThreatLevelToTier(undefined), "log");
  assertEquals(mapThreatLevelToTier("severe"), "log");
  assertEquals(mapThreatLevelToTier(""), "log");
});

Deno.test("only notification + interruption are delivery tiers", () => {
  assertEquals(isDeliveryTier("log"), false);
  assertEquals(isDeliveryTier("finding"), false);
  assertEquals(isDeliveryTier("notification"), true);
  assertEquals(isDeliveryTier("interruption"), true);
  assertEquals([...DELIVERY_TIERS].sort().join(","), "interruption,notification");
});

Deno.test("unrouted sentinel is not an email (never matches a verified recipient)", () => {
  assertEquals(UNROUTED_RECIPIENT.includes("@"), false);
});
