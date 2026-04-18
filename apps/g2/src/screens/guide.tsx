import { useDrawerHeader } from 'even-toolkit/web';
import { OpenVideGuide } from '@/components/guide/openvide-guide';
import { APP_VERSION } from '@/lib/app-meta';
import { useTranslation } from '@/hooks/useTranslation';

export function GuideRoute() {
  const { t } = useTranslation();

  useDrawerHeader({
    title: t('guide.title'),
    right: <span className="data-mono text-[11px] text-text-dim">v{APP_VERSION}</span>,
  });

  return (
    <div className="flex-1 bg-bg">
      <div className="px-3 py-4 flex flex-col gap-3">
        <OpenVideGuide mode="page" />
      </div>
    </div>
  );
}
