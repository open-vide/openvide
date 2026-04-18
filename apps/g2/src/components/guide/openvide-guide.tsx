import { useCallback, useMemo, useState } from 'react';
import { Button, Card, Badge, SliderIndicator, StepIndicator, PagedCarousel } from 'even-toolkit/web';
import { IcFeatLearnExplore, IcFeatMessage, IcFeatTimeCounting, IcStatusDisconnected } from 'even-toolkit/web/icons/svg-icons';
import { OPENVIDE_LINKS } from '@/lib/app-meta';
import { useTranslation } from '@/hooks/useTranslation';

type GuideMode = 'dialog' | 'page';

interface OpenVideGuideProps {
  mode?: GuideMode;
  onClose?: () => void;
}

function openExternal(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function OpenVideGuide({ mode = 'page', onClose }: OpenVideGuideProps) {
  const { t } = useTranslation();
  const [stepIndex, setStepIndex] = useState(0);
  const isDialog = mode === 'dialog';
  const stepBodyClass = mode === 'dialog'
    ? 'mt-2 min-h-[104px] text-[13px] tracking-[-0.13px] text-text-dim leading-[18px]'
    : 'mt-3 min-h-[156px] text-[13px] tracking-[-0.13px] text-text-dim leading-[18px]';

  const steps = useMemo(() => ([
    {
      icon: <IcStatusDisconnected width={18} height={18} />,
      title: t('guide.hostsTitle'),
      body: t('guide.hostsBody'),
    },
    {
      icon: <IcFeatLearnExplore width={18} height={18} />,
      title: t('guide.bridgeTitle'),
      body: t('guide.bridgeBody'),
    },
    {
      icon: <IcFeatMessage width={18} height={18} />,
      title: t('guide.workTitle'),
      body: t('guide.workBody'),
    },
    {
      icon: <IcFeatTimeCounting width={18} height={18} />,
      title: t('guide.agentTitle'),
      body: t('guide.agentBody'),
    },
  ]), [t]);

  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;

  const goToStep = useCallback((index: number) => {
    const next = Math.max(0, Math.min(index, steps.length - 1));
    setStepIndex(next);
  }, [steps.length]);

  return (
    <div className={isDialog ? 'flex h-full min-h-0 flex-col gap-1' : 'flex flex-col gap-3'}>
      <Card className={isDialog ? '' : 'mb-1'}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <Badge variant="neutral">{t('guide.kicker')}</Badge>
            <div className="mt-2 flex flex-col gap-1">
              <h2 className="text-[20px] leading-[20px] tracking-[-0.6px] font-normal text-text">{t('guide.title')}</h2>
              <p className="text-[11px] leading-[15px] tracking-[-0.11px] text-text-dim">{t('guide.subtitle')}</p>
            </div>
          </div>
          <span className="data-mono text-text-dim">{stepIndex + 1}/{steps.length}</span>
        </div>
      </Card>

      <div className={isDialog ? 'flex-1 min-h-0 overflow-hidden pr-1' : ''}>
        <div className="flex flex-col gap-2">
          <Card className="flex flex-col">
            <PagedCarousel
              currentIndex={stepIndex}
              onIndexChange={goToStep}
              className="min-w-0"
              viewportClassName="min-w-0"
              slideClassName="min-w-0"
            >
              {steps.map((step) => (
                <div key={step.title} className="min-w-0">
                  <div className="flex items-center gap-2 text-accent min-w-0">
                    {step.icon}
                    <span className="text-[15px] tracking-[-0.15px] font-normal text-text">{step.title}</span>
                  </div>
                  <div className={stepBodyClass}>
                    <p>{step.body}</p>
                  </div>
                </div>
              ))}
            </PagedCarousel>

            <SliderIndicator count={steps.length} active={stepIndex} className="mt-2" />
            <StepIndicator
              className="mt-2"
              currentStep={stepIndex + 1}
              totalSteps={steps.length}
              prevLabel={t('guide.back')}
              nextLabel={isLast ? t('guide.finish') : t('guide.next')}
              onPrev={!isFirst ? () => goToStep(stepIndex - 1) : undefined}
              onNext={() => {
                if (isLast) {
                  onClose?.();
                  return;
                }
                goToStep(stepIndex + 1);
              }}
            />
          </Card>

          <Card>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[15px] tracking-[-0.15px] font-normal text-text">{t('guide.linksTitle')}</p>
                <p className="mt-1 text-[11px] tracking-[-0.11px] text-text-dim">{t('guide.linksBody')}</p>
              </div>
            </div>
            <div className="mt-2 flex flex-nowrap items-center justify-center gap-1.5">
              <Button size="sm" variant="highlight" className="min-w-[74px] px-3" onClick={() => openExternal(OPENVIDE_LINKS.github)}>
                GitHub
              </Button>
              <Button size="sm" variant="highlight" className="min-w-[74px] px-3" onClick={() => openExternal(OPENVIDE_LINKS.website)}>
                Website
              </Button>
              <Button size="sm" variant="highlight" className="min-w-[74px] px-3" onClick={() => openExternal(OPENVIDE_LINKS.docs)}>
                Docs
              </Button>
            </div>
          </Card>
        </div>
      </div>

      {onClose && (
        <div className="flex items-center justify-center">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('guide.skip')}
          </Button>
        </div>
      )}
    </div>
  );
}
