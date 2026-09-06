  'use client';
import { useEffect, useRef } from 'react';
import { AlertTriangle, ArrowRight, Bell, Check, CheckCheck, ChevronRight, Factory, Flame, MapPin, ShieldAlert, X, Zap } from 'lucide-react';
import { coordinates, formatDate, formatTime } from '@/lib/constants';
import type { ThermalEvent } from '@/lib/types';
import { PrimaryBadge } from './ui';

interface NotificationPanelProps {
  alerts: ThermalEvent[];
  readAlertIds: Set<string>;
  onSelectAlert: (event: ThermalEvent) => void;
  onMarkAllRead: () => void;
  onMarkRead: (id: string) => void;
  onClose: () => void;
  onOpenReviewQueue: () => void;
  filterLabel: string;
}

export default function NotificationPanel({
  alerts,
  readAlertIds,
  onSelectAlert,
  onMarkAllRead,
  onMarkRead,
  onClose,
  onOpenReviewQueue,
  filterLabel,
}: NotificationPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click or escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  const unreadCount = alerts.filter(a => !readAlertIds.has(a.id)).length;
  const criticalCount = alerts.filter(a => a.risk?.level === 'critical').length;
  const highCount = alerts.filter(a => a.risk?.level === 'high').length;

  return (
    <div
      ref={panelRef}
      className="absolute right-0 top-12 z-[2600] w-[440px] max-w-[calc(100vw-24px)] rounded-2xl border border-[#e1e7eb] bg-white shadow-2xl ring-1 ring-black/5 animate-in fade-in slide-in-from-top-2 duration-200"
      role="region"
      aria-label="High and Critical Priority Alerts"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#e9edf0] bg-[#fafbfc] px-5 py-3.5 rounded-t-2xl">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#fee2e2] text-[#dc2626]">
            <ShieldAlert size={17} strokeWidth={2} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-[12.5px] font-semibold text-[#25323a]">Automatic Alert Detection</h2>
              {unreadCount > 0 ? (
                <span className="rounded-full bg-[#dc2626] px-1.5 py-0.2 text-[8.5px] font-bold text-white">
                  {unreadCount} new
                </span>
              ) : (
                <span className="rounded-full bg-[#e2e8ec] px-1.5 py-0.2 text-[8.5px] font-medium text-[#64748b]">
                  all read
                </span>
              )}
            </div>
            <p className="text-[9.5px] text-[#82929e] mt-0.5">
              {filterLabel} · {criticalCount} Critical{criticalCount && highCount ? ', ' : ''}{highCount ? `${highCount} High` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {unreadCount > 0 && (
            <button
              onClick={onMarkAllRead}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[9px] font-medium text-[#6c7d8a] hover:bg-[#edf2f5] hover:text-[#2d3942]"
              title="Mark all alerts as read"
            >
              <CheckCheck size={12} />
              Mark read
            </button>
          )}
          <button
            onClick={onClose}
            aria-label="Close notification panel"
            className="icon-button h-7 w-7 text-[#8796a2] hover:text-[#2d3942]"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Safety Notice Banner */}
      <div className="border-b border-[#fee2e2] bg-[#fff5f5] px-4 py-2 text-[9px] leading-relaxed text-[#b91c1c]">
        <div className="flex items-start gap-1.5">
          <AlertTriangle size={12} className="mt-0.5 shrink-0 text-[#dc2626]" />
          <span>
            <strong>Requires Ground Verification:</strong> Satellite thermal signatures indicate elevated acute heat anomalies. Never claim a confirmed fire, blast, or industrial accident from satellite observations alone.
          </span>
        </div>
      </div>

      {/* Alert List */}
      <div className="max-h-[460px] overflow-y-auto divide-y divide-[#f0f3f6] scroll-thin">
        {alerts.length === 0 ? (
          <div className="p-8 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-[#f1f5f9] text-[#94a3b8]">
              <Bell size={18} />
            </div>
            <h3 className="mt-3 text-[12px] font-semibold text-[#475569]">No High/Critical Alerts Detected</h3>
            <p className="mt-1 text-[10px] text-[#94a3b8] max-w-xs mx-auto">
              No observations in {filterLabel} exceed the high or critical risk threshold. Any incoming detections will be evaluated automatically.
            </p>
          </div>
        ) : (
          alerts.map(alert => {
            const isUnread = !readAlertIds.has(alert.id);
            const riskLevel = alert.risk?.level || 'high';
            const isCritical = riskLevel === 'critical';
            const facility = alert.nearbyFacility || alert.context?.industrial_site_name;
            const distance = alert.context?.industrial_distance_m;

            return (
              <div
                key={alert.id}
                onClick={() => {
                  onMarkRead(alert.id);
                  onSelectAlert(alert);
                }}
                className={`group relative cursor-pointer p-4 transition-colors hover:bg-[#faf6f2] ${
                  isUnread ? 'bg-[#fffaf6]' : 'bg-white'
                }`}
              >
                {/* Unread indicator */}
                {isUnread && (
                  <span className="absolute left-1.5 top-5 h-2 w-2 rounded-full bg-[#e65100]" title="Unread alert" />
                )}

                <div className="ml-1">
                  {/* Top line: Badges and Risk Score */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                          isCritical
                            ? 'bg-[#fee2e2] text-[#b91c1c] border border-[#fca5a5]'
                            : 'bg-[#ffedd5] text-[#c2410c] border border-[#fdba74]'
                        }`}
                      >
                        <Flame size={10} strokeWidth={2.5} />
                        {isCritical ? 'Critical Priority' : 'High Priority'}
                      </span>
                      <PrimaryBadge primaryClass={alert.prediction.primaryClass} compact />
                    </div>
                    <div className="text-right">
                      <span className="tabular text-[12px] font-bold text-[#202930]">
                        {alert.risk ? (alert.risk.score * 100).toFixed(1) : '—'}
                      </span>
                      <span className="text-[8.5px] text-[#8696a2]">/100 Risk</span>
                    </div>
                  </div>

                  {/* Classification Title */}
                  <h3 className="mt-2 text-[11.5px] font-semibold text-[#1e293b] group-hover:text-[#b45309] transition-colors">
                    {alert.prediction.label}
                  </h3>

                  {/* Location & FRP stats */}
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[#64748b]">
                    <span className="flex items-center gap-1 font-medium text-[#475569]">
                      <MapPin size={11} className="text-[#94a3b8]" />
                      {coordinates(alert.latitude, alert.longitude, 4)}
                    </span>
                    <span className="flex items-center gap-1 font-semibold text-[#d97706]">
                      <Zap size={11} />
                      {alert.frp.toFixed(1)} MW FRP
                    </span>
                    <span className="text-[9px] text-[#94a3b8]">
                      {formatDate(alert.acquiredAt, { year: undefined })} · {formatTime(alert.acquiredAt)} UTC
                    </span>
                  </div>

                  {/* Nearby Industrial Facility */}
                  {facility && (
                    <div className="mt-2 flex items-center gap-1.5 rounded-md border border-[#e2e8f0] bg-[#f8fafc] px-2.5 py-1.5 text-[9.5px] text-[#334155]">
                      <Factory size={12} className="shrink-0 text-[#64748b]" />
                      <span className="font-semibold text-[#1e293b] truncate">
                        {facility}
                      </span>
                      {distance != null && (
                        <span className="ml-auto shrink-0 tabular text-[8.5px] font-medium text-[#64748b]">
                          {distance === 0 ? 'Direct perimeter (0 m)' : `${Math.round(distance)} m away`}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Reason for alert / factors */}
                  {alert.risk?.factors && alert.risk.factors.length > 0 && (
                    <div className="mt-2 text-[9.5px] text-[#4b5563] space-y-0.5">
                      <div className="font-medium text-[#374151]">Alert Reasons:</div>
                      <ul className="list-disc pl-4 space-y-0.5 text-[#6b7280]">
                        {alert.risk.factors.slice(0, 3).map((factor, idx) => (
                          <li key={idx}>{factor}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Footer requirement & action */}
                  <div className="mt-2.5 flex items-center justify-between pt-2 border-t border-[#f1f5f9] text-[9px]">
                    <span className="font-medium text-[#c2410c] flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#f97316]" />
                      Requires Ground Verification
                    </span>
                    <span className="inline-flex items-center gap-1 text-[#0284c7] font-semibold group-hover:translate-x-0.5 transition-transform">
                      Investigate drawer
                      <ChevronRight size={12} />
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-[#e9edf0] bg-[#f8fafc] px-4 py-2.5 rounded-b-2xl text-[10px]">
        <button
          onClick={() => {
            onClose();
            onOpenReviewQueue();
          }}
          className="flex items-center gap-1.5 font-medium text-[#475569] hover:text-[#0284c7] transition-colors"
        >
          <span>Open in Review Queue</span>
          <ArrowRight size={12} />
        </button>
        <span className="text-[9px] text-[#94a3b8]">
          Auto-synchronized with Review Queue
        </span>
      </div>
    </div>
  );
}
