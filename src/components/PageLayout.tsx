import { ReactNode, useEffect } from "react";
import { Header } from "@/components/Header";
import { Loader2 } from "lucide-react";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { useIsEmbedded } from "@/hooks/useIsEmbedded";

interface PageLayoutProps {
  children: ReactNode;
  loading?: boolean;
  title?: string;
  description?: string;
  headerContent?: ReactNode;
  fullWidth?: boolean;
  pageName?: string;
  /**
   * Controls overflow behavior of the main content container.
   * Defaults to "hidden" to preserve existing layouts.
   */
  contentOverflow?: "hidden" | "auto";
}

/**
 * Consistent page layout wrapper that prevents layout shifts
 * - Fixed header with sticky positioning
 * - Main content area with min-height to prevent jumping
 * - Consistent loading state that reserves space
 * - Automatic page view tracking (excludes super_admin)
 */
export const PageLayout = ({
  children,
  loading = false,
  title,
  description,
  headerContent,
  fullWidth = false,
  pageName,
  contentOverflow = "hidden",
}: PageLayoutProps) => {
  const { trackPageView, isTracking } = useActivityTracking();
  const isEmbedded = useIsEmbedded();

  // Track page view when component mounts (excludes super_admin)
  useEffect(() => {
    if (isTracking && (pageName || title)) {
      trackPageView(pageName || title || 'Unknown Page');
    }
  }, [isTracking, pageName, title, trackPageView]);

  // When embedded inside a parent page tab, render just the content
  if (isEmbedded) {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      );
    }
    return (
      <div className="space-y-4 sm:space-y-6">
        {(title || headerContent) && (
          <div className="mb-6 min-h-[60px] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            {title && (
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold">{title}</h1>
                {description && (
                  <p className="text-muted-foreground mt-1 text-sm sm:text-base">{description}</p>
                )}
              </div>
            )}
            {headerContent}
          </div>
        )}
        {children}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main 
        className={`flex-1 ${fullWidth ? 'px-4 sm:px-6' : 'container mx-auto px-4 sm:px-6'} py-4 sm:py-8`}
      >
        {/* Page header with title - always renders to reserve space */}
        {(title || headerContent) && (
          <div className="mb-6 min-h-[60px] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            {title && (
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold">{title}</h1>
                {description && (
                  <p className="text-muted-foreground mt-1 text-sm sm:text-base">{description}</p>
                )}
              </div>
            )}
            {headerContent}
          </div>
        )}
        
        {/* Content area with stable minimum height and overflow containment */}
        <div
          className={
            contentOverflow === "auto"
              ? "min-h-[calc(100vh-200px)] relative overflow-y-auto overflow-x-hidden"
              : "min-h-[calc(100vh-200px)] relative overflow-hidden"
          }
        >
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : (
            <div className="space-y-4 sm:space-y-6">
              {children}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};
