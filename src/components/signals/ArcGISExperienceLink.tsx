/**
 * ArcGISExperienceLink
 *
 * Renders a one-click link to the client's ArcGIS Experience URL if one is
 * configured. Used in SignalDetailDialog so an analyst reviewing a signal
 * can jump directly to the client's operational map for context.
 *
 * Returns null silently if the signal has no client_id, or the client has
 * no Experience URL configured. Configured at /clients/:id/arcgis.
 */

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ExternalLink, Map } from "lucide-react";

export function ArcGISExperienceLink({ clientId }: { clientId: string | null | undefined }) {
  const [url, setUrl] = useState<string | null>(null);
  const [label, setLabel] = useState<string>("View operational map");

  useEffect(() => {
    if (!clientId) { setUrl(null); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('client_arcgis_connections')
        .select('experience_url, experience_label')
        .eq('client_id', clientId)
        .eq('is_active', true)
        .not('experience_url', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (data?.experience_url) {
        setUrl(data.experience_url);
        if (data.experience_label) setLabel(data.experience_label);
      } else {
        setUrl(null);
      }
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  if (!url) return null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 hover:underline"
    >
      <Map className="w-4 h-4" />
      {label}
      <ExternalLink className="w-3 h-3 opacity-60" />
    </a>
  );
}
