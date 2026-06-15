import { Plane } from "lucide-react";

/**
 * Shown when get-my-travel returns linked:false. Reveals NO tenant/client
 * information — just a neutral "not linked yet" message.
 */
export function TravellerEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <Plane className="h-10 w-10 text-muted-foreground mb-4" />
      <h2 className="text-lg font-medium">No travel profile linked yet</h2>
      <p className="text-sm text-muted-foreground mt-2 max-w-sm">
        When your travel coordinator links your profile, your trips and alerts will appear here.
      </p>
    </div>
  );
}
