import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Loader2 } from "lucide-react";

interface DeletionItem {
  label: string;
  count?: number | string;
  variant?: "default" | "destructive" | "outline" | "secondary";
}

interface ConfirmDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmationText?: string; // If provided, user must type this to confirm
  items?: DeletionItem[];
  onConfirm: () => Promise<void>;
  loading?: boolean;
}

export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmationText,
  items,
  onConfirm,
  loading = false,
}: ConfirmDeleteDialogProps) {
  const [confirmText, setConfirmText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  const handleConfirm = async () => {
    if (confirmationText && confirmText !== confirmationText) {
      return;
    }
    
    setIsDeleting(true);
    try {
      await onConfirm();
    } finally {
      setIsDeleting(false);
      setConfirmText("");
    }
  };

  const handleClose = () => {
    if (!isDeleting && !loading) {
      setConfirmText("");
      onOpenChange(false);
    }
  };

  const isLoading = isDeleting || loading;
  const canConfirm = !confirmationText || confirmText === confirmationText;

  return (
    <AlertDialog open={open} onOpenChange={handleClose}>
      <AlertDialogContent className="max-w-2xl">
        <AlertDialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-6 h-6 text-destructive" />
            <AlertDialogTitle className="text-xl">{title}</AlertDialogTitle>
          </div>
          <AlertDialogDescription className="space-y-4 pt-4">
            {description && <p className="text-base">{description}</p>}

            {items && items.length > 0 && (
              <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 space-y-3">
                <p className="font-semibold text-foreground flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  The following will be permanently deleted:
                </p>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  {items.map((item, idx) => (
                    <li key={idx} className="flex items-center justify-between">
                      <span>• {item.label}</span>
                      {item.count !== undefined && (
                        <Badge variant={item.variant || "outline"}>
                          {item.count}
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {confirmationText && (
              <div className="space-y-2">
                <Label htmlFor="confirm-text" className="text-base">
                  Type <strong>{confirmationText}</strong> to confirm:
                </Label>
                <Input
                  id="confirm-text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="Enter confirmation text"
                  disabled={isLoading}
                  className="font-mono"
                />
              </div>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading} onClick={handleClose}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={isLoading || !canConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Delete Permanently
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
