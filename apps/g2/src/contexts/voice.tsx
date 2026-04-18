import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

interface VoiceContextValue {
  listening: boolean;
  text: string | null;
  setListening: (listening: boolean) => void;
  setText: (text: string | null) => void;
}

const VoiceContext = createContext<VoiceContextValue | null>(null);

export function VoiceProvider({ children }: { children: ReactNode }) {
  const [listening, setListening] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const value = useMemo(() => ({ listening, text, setListening, setText }), [listening, text]);
  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

export function useVoice(): VoiceContextValue {
  const ctx = useContext(VoiceContext);
  if (!ctx) {
    // Fallback values so the route still renders if provider is missing.
    return {
      listening: false,
      text: null,
      setListening: () => {},
      setText: () => {},
    };
  }
  return ctx;
}
