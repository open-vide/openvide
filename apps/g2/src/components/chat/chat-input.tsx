import { useRef, useCallback, useEffect, type ChangeEvent, type KeyboardEvent } from 'react';

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onVoiceStart?: () => void;
  onVoiceStop?: () => void;
  isListening?: boolean;
  isRunning?: boolean;
  disabled?: boolean;
  placeholder?: string;
}

/* Inline SVG icons — always use currentColor so they inherit button color */
const MicIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="2" width="6" height="11" rx="3" />
    <path d="M5 10a7 7 0 0 0 14 0" />
    <line x1="12" y1="19" x2="12" y2="22" />
    <line x1="8" y1="22" x2="16" y2="22" />
  </svg>
);

const SendIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="19" x2="12" y2="5" />
    <polyline points="5 12 12 5 19 12" />
  </svg>
);

const StopIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <rect x="4" y="4" width="16" height="16" rx="2" />
  </svg>
);

export function ChatInput({
  value,
  onChange,
  onSend,
  onVoiceStart,
  onVoiceStop,
  isListening = false,
  isRunning = false,
  disabled = false,
  placeholder = 'Type a message...',
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }, []);

  useEffect(() => {
    autoResize();
  }, [value, autoResize]);

  const handleInput = (e: ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (disabled) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  const handleActionClick = () => {
    if (disabled) return;
    if (isRunning && !value.trim()) {
      onVoiceStop?.();
      return;
    }
    if (value.trim()) {
      onSend();
      return;
    }
    if (isListening) {
      onVoiceStop?.();
    } else {
      onVoiceStart?.();
    }
  };

  const waveformBars = Array.from({ length: 24 }, (_, i) => (
    <div
      key={i}
      className="waveform-bar"
      style={{ animation: `wave-bar 0.6s ease-in-out ${i * 0.04}s infinite` }}
    />
  ));

  const renderActionIcon = () => {
    if (isRunning && !value.trim()) return <StopIcon />;
    if (value.trim()) return <SendIcon />;
    return <MicIcon />;
  };

  return (
    <div className="flex items-end gap-2">
      {/* Input area */}
      <div className="flex-1 bg-surface rounded-[6px] border border-border flex items-end px-3 gap-2 min-h-[44px]">
        {isListening ? (
          <>
            <button
              className="bg-surface-light rounded-[6px] w-9 h-9 flex items-center justify-center shrink-0 cursor-pointer border-none press-spring my-0.5 text-text"
              onClick={() => onVoiceStop?.()}
            >
              <StopIcon />
            </button>
            <div className="flex-1 flex items-center justify-center gap-[2px] h-10">
              {waveformBars}
            </div>
          </>
        ) : (
          <textarea
            ref={textareaRef}
            className="flex-1 resize-none bg-transparent border-none outline-none text-[15px] tracking-[-0.15px] font-normal text-text py-2.5 leading-normal disabled:cursor-not-allowed disabled:text-text-dim"
            style={{ fontFamily: 'var(--font-display)', maxHeight: 120 }}
            value={value}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={1}
            disabled={disabled}
          />
        )}
      </div>

      {/* Action button — white icon on dark accent */}
      <button
        className="bg-accent rounded-[6px] w-11 h-11 flex items-center justify-center shrink-0 cursor-pointer border-none press-spring text-white disabled:cursor-not-allowed disabled:opacity-50"
        onClick={handleActionClick}
        disabled={disabled}
      >
        {renderActionIcon()}
      </button>
    </div>
  );
}
