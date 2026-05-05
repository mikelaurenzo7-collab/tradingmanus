import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const shortcuts = {
  navigation: [
    { keys: ["⌘/Ctrl", "K"], description: "Open command palette" },
    { keys: ["G", "then", "D"], description: "Go to Dashboard" },
    { keys: ["G", "then", "S"], description: "Go to Signals" },
    { keys: ["G", "then", "P"], description: "Go to Positions" },
    { keys: ["G", "then", "T"], description: "Go to Trades" },
  ],
  actions: [
    { keys: ["?"], description: "Show keyboard shortcuts" },
    { keys: ["Esc"], description: "Close dialogs" },
  ],
};

export function KeyboardShortcuts() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Only trigger on ? key (Shift + /)
      if (e.key === "?" && e.shiftKey) {
        // Ignore if user is typing in an input field
        const target = e.target as HTMLElement;
        const isInputField =
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable;

        if (!isInputField) {
          e.preventDefault();
          setOpen(true);
        }
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="glass-card border-white/10 max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl gradient-text">
            Keyboard Shortcuts
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Navigate faster with these keyboard shortcuts
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* Navigation shortcuts */}
          <div>
            <h3 className="text-sm font-semibold text-foreground/90 mb-3 uppercase tracking-wide">
              Navigation
            </h3>
            <div className="space-y-2">
              {shortcuts.navigation.map((shortcut, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-white/5 transition-colors"
                >
                  <span className="text-sm text-muted-foreground">
                    {shortcut.description}
                  </span>
                  <div className="flex items-center gap-1">
                    {shortcut.keys.map((key, keyIndex) => (
                      <kbd
                        key={keyIndex}
                        className={`inline-flex items-center justify-center min-w-[28px] h-6 px-2 rounded border border-border/40 bg-muted/30 font-mono text-[11px] font-medium text-foreground/80 ${
                          key === "then" ? "border-none bg-transparent" : ""
                        }`}
                      >
                        {key}
                      </kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Actions shortcuts */}
          <div>
            <h3 className="text-sm font-semibold text-foreground/90 mb-3 uppercase tracking-wide">
              Actions
            </h3>
            <div className="space-y-2">
              {shortcuts.actions.map((shortcut, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-white/5 transition-colors"
                >
                  <span className="text-sm text-muted-foreground">
                    {shortcut.description}
                  </span>
                  <div className="flex items-center gap-1">
                    {shortcut.keys.map((key, keyIndex) => (
                      <kbd
                        key={keyIndex}
                        className="inline-flex items-center justify-center min-w-[28px] h-6 px-2 rounded border border-border/40 bg-muted/30 font-mono text-[11px] font-medium text-foreground/80"
                      >
                        {key}
                      </kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default KeyboardShortcuts;
