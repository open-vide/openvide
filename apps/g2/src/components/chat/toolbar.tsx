import { IcEditSettings, IcFeatInterfaceSettings } from 'even-toolkit/web/icons/svg-icons';

interface ToolbarItem {
  id: string;
  label: string;
}

interface ToolbarProps {
  mode: string;
  onModeChange: (mode: string) => void;
  model: string;
  onModelChange: (model: string) => void;
  modes: ToolbarItem[];
  models: ToolbarItem[];
}

export function Toolbar({ mode, onModeChange, model, onModelChange, modes, models }: ToolbarProps) {
  const cycleMode = () => {
    const idx = modes.findIndex((m) => m.id === mode);
    const next = modes[(idx + 1) % modes.length];
    if (next) onModeChange(next.id);
  };

  const cycleModel = () => {
    const idx = models.findIndex((m) => m.id === model);
    const next = models[(idx + 1) % models.length];
    if (next) onModelChange(next.id);
  };

  const currentMode = modes.find((m) => m.id === mode);
  const currentModel = models.find((m) => m.id === model);

  return (
    <div className="flex gap-1.5 px-3 py-1.5">
      {/* Mode button */}
      {modes.length > 0 && (
        <button
          className="bg-surface rounded-[6px] border border-border px-3 h-8 flex items-center gap-1.5 cursor-pointer press-spring"
          onClick={cycleMode}
        >
          <IcFeatInterfaceSettings width={14} height={14} className="text-text-dim" />
          <span className="text-[13px] tracking-[-0.13px] text-text font-normal">
            {currentMode?.label ?? mode}
          </span>
        </button>
      )}

      {/* Model button */}
      {models.length > 0 && (
        <button
          className="bg-surface rounded-[6px] border border-border px-3 h-8 flex items-center gap-1.5 cursor-pointer press-spring"
          onClick={cycleModel}
        >
          <IcEditSettings width={14} height={14} className="text-text-dim" />
          <span className="text-[13px] tracking-[-0.13px] text-text font-normal">
            {currentModel?.label ?? model}
          </span>
        </button>
      )}
    </div>
  );
}
