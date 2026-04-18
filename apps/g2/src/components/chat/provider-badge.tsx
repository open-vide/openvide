import { useMemo } from 'react';

type Provider = 'claude' | 'codex' | 'gemini';

const providerColors: Record<Provider, string> = {
  claude: '#C4704B',
  codex: '#10A37F',
  gemini: '#4285F4',
};

const providerLetters: Record<Provider, string> = {
  claude: 'C',
  codex: 'X',
  gemini: 'G',
};

const providerIcons: Partial<Record<Provider, { light: string; dark: string }>> = {
  claude: {
    light: '/provider-icons/claude_light.png',
    dark: '/provider-icons/claude_dark.png',
  },
  codex: {
    light: '/provider-icons/openai_light.png',
    dark: '/provider-icons/openai_dark.png',
  },
};

interface ProviderBadgeProps {
  provider: Provider;
  size?: number;
  className?: string;
}

/**
 * Gemini's 4-pointed sparkle mark as an inline SVG so we don't need to ship
 * PNG assets for the logo. Renders with the official blue→violet gradient.
 */
function GeminiMark({ size }: { size: number }) {
  return (
    <svg
      width={Math.round(size * 0.62)}
      height={Math.round(size * 0.62)}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Gemini"
    >
      <defs>
        <linearGradient id="gemini-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#4796E3" />
          <stop offset="40%" stopColor="#8B69DD" />
          <stop offset="100%" stopColor="#D96570" />
        </linearGradient>
      </defs>
      <path
        d="M50 0 C50 27.6142 72.3858 50 100 50 C72.3858 50 50 72.3858 50 100 C50 72.3858 27.6142 50 0 50 C27.6142 50 50 27.6142 50 0 Z"
        fill="url(#gemini-grad)"
      />
    </svg>
  );
}

export function ProviderBadge({ provider, size = 32, className }: ProviderBadgeProps) {
  const color = providerColors[provider] ?? 'var(--color-text-dim)';
  const letter = providerLetters[provider] ?? provider.charAt(0).toUpperCase();
  const iconSet = providerIcons[provider];
  const backgroundColor = provider === 'codex' ? '#000000' : undefined;
  const iconSrc = useMemo(() => {
    if (!iconSet || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return iconSet?.light ?? null;
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? iconSet.dark : iconSet.light;
  }, [iconSet]);

  return (
    <div
      className={`bg-surface-light rounded-full flex items-center justify-center shrink-0 ${className ?? ''}`}
      style={{ width: size, height: size, backgroundColor }}
    >
      {iconSrc ? (
        <img
          src={iconSrc}
          alt={provider}
          style={{
            width: Math.round(size * 0.62),
            height: Math.round(size * 0.62),
            borderRadius: Math.round(size * 0.31),
          }}
        />
      ) : provider === 'gemini' ? (
        <GeminiMark size={size} />
      ) : (
        <span
          className="font-normal"
          style={{
            color,
            fontSize: size * 0.44,
            lineHeight: 1,
            fontFamily: 'var(--font-mono)',
          }}
        >
          {letter}
        </span>
      )}
    </div>
  );
}
