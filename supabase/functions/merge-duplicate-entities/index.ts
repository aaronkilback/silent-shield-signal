import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const body = await req.json().catch(() => ({}));
    const dry_run = body.dry_run !== false; // default true for safety
    const min_similarity = body.min_similarity ?? 0.92; // only merge very high confidence
    const skip_ids: Set<string> = new Set(body.skip_ids || []);

    const supabase = createServiceClient();

    // Load all active entities
    const { data: entities, error } = await supabase
      .from('entities')
      .select('id, name, type, aliases, description, quality_score, threat_score, risk_level, created_at')
      .eq('is_active', true)
      .order('quality_score', { ascending: false, nullsFirst: false });

    if (error) throw error;

    const ents = entities || [];
    console.log(`Loaded ${ents.length} active entities`);

    // Normalize a name for comparison
    function normalize(s: string): string {
      return s.toLowerCase()
        .replace(/\binc\.?\b|\bcorp\.?\b|\bllc\.?\b|\bltd\.?\b|\bco\.?\b/g, '')
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    // Compute similarity between two strings (Jaccard on character trigrams)
    function similarity(a: string, b: string): number {
      const na = normalize(a);
      const nb = normalize(b);
      if (na === nb) return 1.0;
      if (na.length < 3 || nb.length < 3) return na === nb ? 1.0 : 0.0;

      const getTrigrams = (s: string): Set<string> => {
        const set = new Set<string>();
        for (let i = 0; i <= s.length - 3; i++) set.add(s.slice(i, i + 3));
        return set;
      };

      const ta = getTrigrams(na);
      const tb = getTrigrams(nb);
      const intersection = [...ta].filter(x => tb.has(x)).length;
      const union = new Set([...ta, ...tb]).size;
      return union === 0 ? 0 : intersection / union;
    }

    // Also check if one entity name is an alias of another
    function isAlias(e1: any, e2: any): boolean {
      const n1 = normalize(e1.name);
      const n2 = normalize(e2.name);
      const aliases1: string[] = (e1.aliases || []).map((a: string) => normalize(a));
      const aliases2: string[] = (e2.aliases || []).map((a: string) => normalize(a));
      return aliases1.includes(n2) || aliases2.includes(n1);
    }

    interface MergeGroup {
      keeper: any;
      duplicates: any[];
      reason: string;
      score: number;
    }

    const groups: MergeGroup[] = [];
    const processed = new Set<string>();

    for (let i = 0; i < ents.length; i++) {
      const e1 = ents[i];
      if (processed.has(e1.id)) continue;

      const group: any[] = [];

      for (let j = i + 1; j < ents.length; j++) {
        const e2 = ents[j];
        if (processed.has(e2.id)) continue;
        if (e1.type !== e2.type) continue; // only merge same type
        if (skip_ids.has(e1.id) || skip_ids.has(e2.id)) continue;

        const sim = similarity(e1.name, e2.name);
        const aliasMatch = isAlias(e1, e2);

        if (sim >= min_similarity || aliasMatch) {
          group.push({ entity: e2, score: sim, reason: aliasMatch ? 'alias_match' : 'name_similarity' });
        }
      }

      if (group.length > 0) {
        // The keeper is e1 (already sorted by quality_score desc)
        groups.push({
          keeper: e1,
          duplicates: group.map(g => g.entity),
          reason: group[0].reason,
          score: group[0].score,
        });
        group.forEach(g => processed.add(g.entity.id));
        processed.add(e1.id);
      }
    }

    console.log(`Found ${groups.length} duplicate groups`);

    if (dry_run) {
      return successResponse({
        dry_run: true,
        groups_found: groups.length,
        groups: groups.map(g => ({
          keeper: { id: g.keeper.id, name: g.keeper.name, type: g.keeper.type, quality_score: g.keeper.quality_score },
          duplicates: g.duplicates.map(d => ({ id: d.id, name: d.name, quality_score: d.quality_score })),
          reason: g.reason,
          score: g.score,
        })),
      });
    }

    // Execute merges
    let merged = 0;
    const errors: string[] = [];

    for (const group of groups) {
      const keeperId = group.keeper.id;
      const dupIds = group.duplicates.map(d => d.id);

      try {
        // 1. Move entity_mentions to keeper
        await supabase
          .from('entity_mentions')
          .update({ entity_id: keeperId })
          .in('entity_id', dupIds);

        // 2. Move entity_content to keeper
        await supabase
          .from('entity_content')
          .update({ entity_id: keeperId })
          .in('entity_id', dupIds);

        // 3. Move entity_photos to keeper
        await supabase
          .from('entity_photos')
          .update({ entity_id: keeperId })
          .in('entity_id', dupIds);

        // 4. Update entity_relationships: replace dup references with keeper
        for (const dupId of dupIds) {
          await supabase
            .from('entity_relationships')
            .update({ entity_a_id: keeperId })
            .eq('entity_a_id', dupId)
            .neq('entity_b_id', keeperId); // avoid self-referential

          await supabase
            .from('entity_relationships')
            .update({ entity_b_id: keeperId })
            .eq('entity_b_id', dupId)
            .neq('entity_a_id', keeperId);
        }

        // 5. Collect aliases from duplicates and merge into keeper
        const allAliases = new Set<string>([...(group.keeper.aliases || [])]);
        for (const dup of group.duplicates) {
          allAliases.add(dup.name); // add dup name as alias
          (dup.aliases || []).forEach((a: string) => allAliases.add(a));
        }
        allAliases.delete(group.keeper.name); // don't add keeper name as alias

        await supabase
          .from('entities')
          .update({ aliases: Array.from(allAliases) })
          .eq('id', keeperId);

        // 6. Soft-delete duplicates
        await supabase
          .from('entities')
          .update({ is_active: false, description: `Merged into ${group.keeper.name} (${keeperId})` })
          .in('id', dupIds);

        // 7. Update entity_suggestions: update matched_entity_id
        await supabase
          .from('entity_suggestions')
          .update({ matched_entity_id: keeperId })
          .in('matched_entity_id', dupIds);

        merged += dupIds.length;
        console.log(`Merged ${dupIds.length} duplicates into: ${group.keeper.name}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Failed to merge into ${group.keeper.name}: ${msg}`);
        console.error(msg);
      }
    }

    // Refresh quality scores for all keepers
    for (const group of groups) {
      try {
        await supabase.rpc('refresh_entity_quality_score', { p_entity_id: group.keeper.id });
      } catch (_) { /* non-fatal */ }
    }

    return successResponse({
      dry_run: false,
      groups_merged: groups.length,
      entities_merged: merged,
      errors: errors.length > 0 ? errors : undefined,
    });

  } catch (error) {
    console.error('merge-duplicate-entities error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
