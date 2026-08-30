import { useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Maximize2, Minus, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Titlebar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const appWindow = getCurrentWindow();

  const handleMinimize = () => appWindow.minimize();
  const handleToggleMaximize = () => {
    appWindow.toggleMaximize();
    setIsMaximized((prev) => !prev);
  };
  const handleClose = () => appWindow.close();

  return (
    <div className="titlebar flex h-9 shrink-0 select-none items-center border-b bg-background">
      <div className="flex-1" />
      <div className="titlebar-controls flex h-full pr-2">
        <Button
          variant="ghost"
          size="icon-xs"
          className="h-full rounded-none text-muted-foreground hover:text-foreground"
          onClick={handleMinimize}
        >
          <Minus className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          className="h-full rounded-none text-muted-foreground hover:text-foreground"
          onClick={handleToggleMaximize}
        >
          {isMaximized ? (
            <Square className="h-3 w-3" />
          ) : (
            <Maximize2 className="h-3 w-3" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          className="h-full rounded-none text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
          onClick={handleClose}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
