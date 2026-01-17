import { useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

interface KeyboardShortcut {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  action: () => void;
  description: string;
}

export function useKeyboardShortcuts(customShortcuts: KeyboardShortcut[] = []) {
  const navigate = useNavigate();

  const defaultShortcuts: KeyboardShortcut[] = [
    {
      key: 'k',
      meta: true,
      action: () => {
        // Focus search or open command palette
        const searchInput = document.querySelector('[data-search-input]') as HTMLInputElement;
        if (searchInput) {
          searchInput.focus();
        } else {
          toast.info("Search: Cmd+K");
        }
      },
      description: "Open search",
    },
    {
      key: 'n',
      meta: true,
      shift: true,
      action: () => {
        // Trigger new chat
        const newChatBtn = document.querySelector('[data-new-chat]') as HTMLButtonElement;
        if (newChatBtn) {
          newChatBtn.click();
        }
      },
      description: "New chat",
    },
    {
      key: '/',
      action: () => {
        // Show keyboard shortcuts help
        toast.info(
          <div className="space-y-1 text-sm">
            <div className="font-bold mb-2">Keyboard Shortcuts</div>
            <div>⌘K - Search</div>
            <div>⌘⇧N - New chat</div>
            <div>⌘1-5 - Navigate sections</div>
            <div>Esc - Close dialogs</div>
          </div>,
          { duration: 5000 }
        );
      },
      description: "Show shortcuts",
    },
    {
      key: '1',
      meta: true,
      action: () => navigate('/'),
      description: "Go to Dashboard",
    },
    {
      key: '2',
      meta: true,
      action: () => navigate('/signals'),
      description: "Go to Signals",
    },
    {
      key: '3',
      meta: true,
      action: () => navigate('/incidents'),
      description: "Go to Incidents",
    },
    {
      key: '4',
      meta: true,
      action: () => navigate('/entities'),
      description: "Go to Entities",
    },
    {
      key: '5',
      meta: true,
      action: () => navigate('/investigations'),
      description: "Go to Investigations",
    },
  ];

  const allShortcuts = [...defaultShortcuts, ...customShortcuts];

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    // Don't trigger shortcuts when typing in inputs
    const target = event.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    ) {
      // Allow Escape in inputs
      if (event.key !== 'Escape') {
        return;
      }
    }

    for (const shortcut of allShortcuts) {
      const keyMatch = event.key.toLowerCase() === shortcut.key.toLowerCase();
      const ctrlMatch = shortcut.ctrl ? event.ctrlKey : !event.ctrlKey || shortcut.meta;
      const metaMatch = shortcut.meta ? event.metaKey : !event.metaKey || shortcut.ctrl;
      const shiftMatch = shortcut.shift ? event.shiftKey : !event.shiftKey;
      const altMatch = shortcut.alt ? event.altKey : !event.altKey;

      // Handle Cmd/Ctrl cross-platform
      const modifierMatch = shortcut.meta || shortcut.ctrl 
        ? (event.metaKey || event.ctrlKey)
        : (!event.metaKey && !event.ctrlKey);

      if (keyMatch && modifierMatch && shiftMatch && altMatch) {
        event.preventDefault();
        shortcut.action();
        return;
      }
    }
  }, [allShortcuts]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return { shortcuts: allShortcuts };
}
