import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  FileEdit,
  History,
  PlusCircle,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import { auth } from '../firebase';
import { fetchRecentFirestoreAuditLogs } from '../lib/firestoreSync';
import type { AuditLogRecord, Language, NumeralSystem } from '../types';
import { t, toDisplayDigits } from '../i18n/translations';

interface RecentAdminActivityWidgetProps {
  lang: Language;
  numerals: NumeralSystem;
  refreshKey?: string | number;
  onNavigate: (tab: string, subContext?: string) => void;
}

type ActionTone = 'emerald' | 'amber' | 'rose' | 'sky';

function getActionMeta(action: string): {
  label: string;
  tone: ActionTone;
  Icon: React.ComponentType<{ className?: string }>;
} {
  const upper = (action || '').toUpperCase();
  const label = upper
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');

  if (
    upper.includes('REVERS') ||
    upper.includes('REJECT') ||
    upper.includes('REVOK') ||
    upper.includes('DELETE') ||
    upper.includes('SUSPEND') ||
    upper.includes('DEACTIVAT') ||
    upper.includes('CLEAR')
  ) {
    return { label: label || 'System Reversal', tone: 'rose', Icon: RotateCcw };
  }

  if (
    upper.includes('APPROV') ||
    upper.includes('VERIF') ||
    upper.includes('CREAT') ||
    upper.includes('RECORD') ||
    upper.includes('PAID') ||
    upper.includes('ACTIVAT')
  ) {
    return {
      label: label || 'Record Created',
      tone: 'emerald',
      Icon: upper.includes('APPROV') || upper.includes('VERIF') ? CheckCircle2 : PlusCircle,
    };
  }

  if (
    upper.includes('OWNER') ||
    upper.includes('ADMIN') ||
    upper.includes('PASSWORD') ||
    upper.includes('2FA') ||
    upper.includes('ROLE') ||
    upper.includes('LOGIN') ||
    upper.includes('SECURITY')
  ) {
    return { label: label || 'Governance Update', tone: 'sky', Icon: ShieldCheck };
  }

  return { label: label || 'System Update', tone: 'amber', Icon: FileEdit };
}

function formatEntityLabel(entityType: string): string {
  const cleaned = (entityType || 'system').replace(/_/g, ' ').trim();
  return cleaned
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function formatRelativeTimestamp(iso: string, numerals: NumeralSystem): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;

  const diffMs = Date.now() - parsed.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'Just now';

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${toDisplayDigits(diffMin, numerals)}m ago`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${toDisplayDigits(diffHr, numerals)}h ago`;

  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${toDisplayDigits(diffDay, numerals)}d ago`;

  return parsed.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatPayloadPreview(raw: string | null): string {
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const entries = Object.entries(parsed)
        .filter(([, value]) => value !== null && value !== undefined && value !== '')
        .slice(0, 6)
        .map(([key, value]) => {
          const valStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
          return `${key}: ${valStr.length > 60 ? `${valStr.slice(0, 60)}…` : valStr}`;
        });
      return entries.join(' · ') || raw.slice(0, 220);
    }
  } catch {
    // Fallback to plain string preview
  }
  return raw.length > 220 ? `${raw.slice(0, 220)}…` : raw;
}

export const RecentAdminActivityWidget: React.FC<RecentAdminActivityWidgetProps> = ({
  lang,
  numerals,
  refreshKey,
  onNavigate,
}) => {
  const [logs, setLogs] = useState<AuditLogRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadRecentLogs = useCallback(async (isManualRefresh = false) => {
    if (isManualRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const apiPromise = apiRequest<{ logs: AuditLogRecord[] }>('/api/audit-logs?limit=5');
      const firestorePromise =
        auth.currentUser && auth.currentUser.emailVerified
          ? fetchRecentFirestoreAuditLogs(5).catch(() => [] as AuditLogRecord[])
          : Promise.resolve([] as AuditLogRecord[]);

      const [apiRes, firestoreLogs] = await Promise.all([apiPromise, firestorePromise]);

      const mergedById = new Map<string, AuditLogRecord>();
      for (const entry of apiRes.logs || []) {
        mergedById.set(entry.id, entry);
      }
      for (const entry of firestoreLogs) {
        if (!mergedById.has(entry.id)) {
          mergedById.set(entry.id, entry);
        }
      }

      const topFive = Array.from(mergedById.values())
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 5);

      setLogs(topFive);
    } catch (err: any) {
      setError(err?.message || 'Unable to load recent admin activity.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadRecentLogs(false);
  }, [loadRecentLogs, refreshKey]);

  const toneClasses: Record<ActionTone, { iconBox: string; badge: string }> = {
    emerald: {
      iconBox: 'bg-emerald-50 text-[#0B4F32] border-emerald-200/80 dark:bg-emerald-950/60 dark:text-emerald-400 dark:border-emerald-800/60',
      badge: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300',
    },
    amber: {
      iconBox: 'bg-amber-50 text-amber-700 border-amber-200/80 dark:bg-amber-950/50 dark:text-amber-400 dark:border-amber-800/60',
      badge: 'bg-amber-50 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300',
    },
    rose: {
      iconBox: 'bg-rose-50 text-rose-700 border-rose-200/80 dark:bg-rose-950/50 dark:text-rose-400 dark:border-rose-800/60',
      badge: 'bg-rose-50 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300',
    },
    sky: {
      iconBox: 'bg-sky-50 text-sky-700 border-sky-200/80 dark:bg-sky-950/50 dark:text-sky-400 dark:border-sky-800/60',
      badge: 'bg-sky-50 text-sky-800 dark:bg-sky-950/70 dark:text-sky-300',
    },
  };

  return (
    <section
      aria-label="Recent Admin Activity"
      className="rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-5"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800/80">
        <div className="flex items-start gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/70 dark:border-emerald-800/60 text-[#0B4F32] dark:text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
            <History className="w-4 h-4" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Recent Admin Activity
              </h2>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                Last {toDisplayDigits(5, numerals)} Audit Logs
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Immutable transparency feed of recent committee ledger, member, and governance updates.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void loadRecentLogs(true)}
            disabled={refreshing || loading}
            aria-label="Refresh recent admin activity"
            className="min-h-[36px] px-3 py-1.5 rounded-xl bg-[#F6F8F7] dark:bg-[#0D1612] border border-slate-200 dark:border-slate-800 hover:border-[#0B4F32]/50 dark:hover:border-emerald-500/60 text-slate-700 dark:text-slate-200 text-xs font-medium inline-flex items-center gap-1.5 transition-colors disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('settings')}
            className="min-h-[36px] px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 hover:border-[#0B4F32]/60 dark:hover:border-emerald-500 text-[#0B4F32] dark:text-emerald-400 text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap transition-colors"
          >
            <span>{t(lang, 'viewAll')}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="divide-y divide-slate-100 dark:divide-slate-800/80 pt-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="py-3 flex items-center gap-3 animate-pulse">
              <div className="w-8 h-8 rounded-lg bg-slate-200/70 dark:bg-slate-800 shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-48 rounded bg-slate-200/70 dark:bg-slate-800" />
                <div className="h-3 w-72 max-w-full rounded bg-slate-100 dark:bg-slate-800/60" />
              </div>
              <div className="h-3 w-16 rounded bg-slate-200/70 dark:bg-slate-800 shrink-0" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="mt-4 p-4 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 text-xs text-rose-800 dark:text-rose-200">
            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => void loadRecentLogs(true)}
            className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-800 text-xs font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-100/50 transition-colors shrink-0"
          >
            Retry
          </button>
        </div>
      ) : logs.length === 0 ? (
        <div className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
          <ShieldCheck className="w-8 h-8 mx-auto mb-2 opacity-40" />
          No administrative activity has been recorded yet.
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800/80">
          {logs.map((log) => {
            const { label, tone, Icon } = getActionMeta(log.action);
            const styles = toneClasses[tone];
            const hasDetails = Boolean(log.beforeData || log.afterData);
            const isExpanded = expandedId === log.id;
            const parsedDate = new Date(log.timestamp);
            const fullTimestamp = Number.isNaN(parsedDate.getTime())
              ? log.timestamp
              : parsedDate.toLocaleString('en-IN', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                });

            return (
              <li key={log.id} className="py-3.5 first:pt-4 last:pb-1">
                <div className="flex items-start gap-3">
                  <div
                    className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 mt-0.5 ${styles.iconBox}`}
                  >
                    <Icon className="w-4 h-4" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <div className="flex flex-wrap items-center gap-2 min-w-0">
                        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {label}
                        </span>
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${styles.badge}`}
                        >
                          {formatEntityLabel(log.entityType)}
                        </span>
                        {log.entityId && (
                          <span className="text-[11px] font-data text-slate-500 dark:text-slate-400 truncate max-w-[160px]">
                            #{log.entityId}
                          </span>
                        )}
                      </div>

                      <div
                        className="inline-flex items-center gap-1 text-[11px] font-data text-slate-500 dark:text-slate-400 shrink-0"
                        title={fullTimestamp}
                      >
                        <Clock className="w-3 h-3 opacity-70" />
                        <span>{formatRelativeTimestamp(log.timestamp, numerals)}</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 mt-1">
                      <div className="text-xs text-slate-600 dark:text-slate-300 flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
                        <span className="inline-flex items-center gap-1 font-medium text-slate-700 dark:text-slate-200">
                          <UserCheck className="w-3.5 h-3.5 text-[#0B4F32] dark:text-emerald-400 shrink-0" />
                          <span>{log.adminName || 'System Admin'}</span>
                        </span>
                        {log.reason && (
                          <>
                            <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
                              ·
                            </span>
                            <span className="text-slate-500 dark:text-slate-400 truncate max-w-xl">
                              {log.reason}
                            </span>
                          </>
                        )}
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <span className="hidden sm:inline text-[11px] font-data text-slate-400 dark:text-slate-500">
                          {fullTimestamp}
                        </span>
                        {hasDetails && (
                          <button
                            type="button"
                            onClick={() => setExpandedId(isExpanded ? null : log.id)}
                            className="text-[11px] font-semibold text-[#0B4F32] dark:text-emerald-400 hover:underline inline-flex items-center gap-0.5"
                          >
                            <span>{isExpanded ? 'Hide Details' : 'Details'}</span>
                            {isExpanded ? (
                              <ChevronUp className="w-3 h-3" />
                            ) : (
                              <ChevronDown className="w-3 h-3" />
                            )}
                          </button>
                        )}
                      </div>
                    </div>

                    {isExpanded && hasDetails && (
                      <div className="mt-2.5 grid grid-cols-1 md:grid-cols-2 gap-2">
                        {log.beforeData && (
                          <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200/70 dark:border-slate-800 text-[11px] font-data text-slate-600 dark:text-slate-300 break-words">
                            <span className="font-semibold text-slate-800 dark:text-slate-200">
                              Before:{' '}
                            </span>
                            {formatPayloadPreview(log.beforeData)}
                          </div>
                        )}
                        {log.afterData && (
                          <div className="p-2.5 rounded-lg bg-emerald-50/50 dark:bg-emerald-950/25 border border-emerald-200/60 dark:border-emerald-900/50 text-[11px] font-data text-slate-700 dark:text-slate-200 break-words">
                            <span className="font-semibold text-[#0B4F32] dark:text-emerald-400">
                              After:{' '}
                            </span>
                            {formatPayloadPreview(log.afterData)}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};
