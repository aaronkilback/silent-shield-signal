import { Component, type ReactNode } from 'react';
import { useRealtimeNotifications } from '@/hooks/useRealtimeNotifications';
import { useErrorNotifications } from '@/hooks/useErrorNotifications';
import { useUserRole } from '@/hooks/useUserRole';

// Inner component that calls the hooks
const RealtimeNotificationsInner = () => {
  useRealtimeNotifications();
  const { roles } = useUserRole();
  const topRole = roles?.includes('super_admin') ? 'super_admin' : roles?.includes('admin') ? 'admin' : undefined;
  useErrorNotifications(topRole);
  return null;
};

// Self-contained error boundary so hook crashes don't take down the app
class RealtimeErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.warn('[RealtimeNotifications] Recovered from error:', error.message);
    // Auto-recover after 5 seconds (e.g., HMR-induced hook mismatch)
    setTimeout(() => this.setState({ hasError: false }), 5000);
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

export const RealtimeNotifications = () => (
  <RealtimeErrorBoundary>
    <RealtimeNotificationsInner />
  </RealtimeErrorBoundary>
);
