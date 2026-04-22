import type { PendingPermissionRequest, PermissionDecision } from '../../types';
import { useTranslation } from '../../hooks/useTranslation';

interface PermissionApprovalCardProps {
  permission: PendingPermissionRequest;
  disabled?: boolean;
  error?: string;
  onDecision: (decision: PermissionDecision) => void;
}

type PermissionOption = NonNullable<PendingPermissionRequest['options']>[number];
type DecisionPermissionOption = PermissionOption & { kind: PermissionDecision };

function optionClass(kind: PermissionDecision): string {
  if (kind === 'approve_once') {
    return 'border-accent bg-accent text-text-highlight';
  }
  if (kind === 'abort_run') {
    return 'border-negative/40 bg-negative/10 text-negative';
  }
  return 'border-border bg-surface text-text';
}

function kindLabel(kind: PendingPermissionRequest['kind'], t: (key: string) => string): string {
  if (kind === 'file_write') return t('permission.fileAccess');
  if (kind === 'network') return t('permission.network');
  if (kind === 'dangerous_action') return t('permission.highRisk');
  if (kind === 'command') return t('permission.command');
  return t('permission.generic');
}

function riskLabel(risk: NonNullable<PendingPermissionRequest['risk']>, t: (key: string) => string): string {
  if (risk === 'low') return t('permission.risk.low');
  if (risk === 'medium') return t('permission.risk.medium');
  return t('permission.risk.high');
}

function optionLabel(kind: PermissionDecision, t: (key: string) => string): string {
  if (kind === 'approve_once') return t('permission.approveOnce');
  if (kind === 'reject') return t('permission.reject');
  return t('permission.abortRun');
}

function isDecisionKind(kind: string): kind is PermissionDecision {
  return kind === 'approve_once' || kind === 'reject' || kind === 'abort_run';
}

function isDecisionOption(option: PermissionOption): option is DecisionPermissionOption {
  return isDecisionKind(option.kind);
}

export function PermissionApprovalCard({ permission, disabled = false, error, onDecision }: PermissionApprovalCardProps) {
  const { t } = useTranslation();
  const fallbackOptions: DecisionPermissionOption[] = [
    { id: 'approve_once', label: t('permission.approveOnce'), kind: 'approve_once' },
    { id: 'reject', label: t('permission.reject'), kind: 'reject' },
    { id: 'abort_run', label: t('permission.abortRun'), kind: 'abort_run' },
  ];
  const options = (permission.options ?? fallbackOptions).filter(isDecisionOption);
  const riskText = permission.risk ? riskLabel(permission.risk, t) : undefined;

  return (
    <div className="bg-surface border border-accent-warning rounded-[6px] p-3 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-[6px] bg-accent-warning/20 text-accent-warning flex items-center justify-center shrink-0 data-mono">
          !
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-text font-normal">{permission.title}</span>
            <span className="data-mono text-accent-warning">{kindLabel(permission.kind, t)}</span>
            {riskText && <span className="data-mono text-text-dim">{riskText}</span>}
          </div>
          {permission.description && (
            <p className="mt-1 text-[13px] text-text-dim leading-normal">
              {permission.description}
            </p>
          )}
        </div>
      </div>

      {permission.command && (
        <div className="code-surface px-3 py-2 text-[11px] whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
          {permission.command}
        </div>
      )}

      {permission.files && permission.files.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="data-mono text-text-dim">{t('permission.files')}</span>
          <div className="flex flex-col gap-1">
            {permission.files.map((file) => (
              <span key={file} className="text-[12px] text-text break-all">
                {file}
              </span>
            ))}
          </div>
        </div>
      )}

      {permission.reason && permission.reason !== permission.description && (
        <p className="text-[12px] text-text-dim leading-normal">
          {permission.reason}
        </p>
      )}

      {error && (
        <p className="text-[12px] text-negative leading-normal">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            disabled={disabled}
            onClick={() => onDecision(option.kind)}
            className={`h-9 rounded-[6px] border px-3 text-[13px] font-normal cursor-pointer press-spring disabled:cursor-not-allowed disabled:opacity-50 ${optionClass(option.kind)}`}
          >
            {optionLabel(option.kind, t)}
          </button>
        ))}
      </div>
    </div>
  );
}
