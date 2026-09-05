'use client';
import { useEffect, useRef } from 'react';
import { AlertCircle, ArrowUpRight, Check, LoaderCircle, Satellite, X } from 'lucide-react';
import { CLASSES } from '@/lib/constants';
import type { ClassKey, SourceState } from '@/lib/types';

export function ClassBadge({ classKey, compact = false }: {classKey: ClassKey; compact?: boolean}) {
  const config = CLASSES[classKey];
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-1 font-medium ${compact ? 'text-[10px]' : 'text-[11px]'}`} style={{ color: config.color, background: config.bg }}><span className="h-1.5 w-1.5 rounded-full" style={{background: config.color}} />{config.short}</span>;
}
const stateLabels: Record<SourceState, string> = { connected: 'Connected', unreachable: 'Unavailable', not_configured: 'Not configured', idle: 'On demand', local: 'Local journal', degraded: 'Degraded' };
export function StatusBadge({ state }: {state: SourceState}) {
  const style = state === 'connected' ? 'text-[#28856a] bg-[#eaf6f0]' : ['unreachable', 'degraded'].includes(state) ? 'text-[#bd8050] bg-[#fff4e7]' : 'text-[#75818c] bg-[#eff2f5]';
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium ${style}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{stateLabels[state]}</span>;
}
export function EmptyState({ title, description, action, icon }: {title: string; description: string; action?: React.ReactNode; icon?: React.ReactNode}) {
  return <div className="flex min-h-56 flex-col items-center justify-center px-8 py-10 text-center"><div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f2f4f6] text-[#91a0ac]">{icon || <Satellite size={23} strokeWidth={1.4} />}</div><h3 className="font-display text-sm font-semibold text-[#475560]">{title}</h3><p className="mt-2 max-w-md text-xs leading-6 text-[#8a949c]">{description}</p>{action && <div className="mt-4">{action}</div>}</div>;
}
export function Loading({ text = 'Reading source observations…' }: {text?: string}) {
  return <div className="flex min-h-48 items-center justify-center gap-3 text-xs text-[#82919b]"><LoaderCircle className="animate-spin" size={17} />{text}</div>;
}
export function ErrorState({ message, retry }: {message: string; retry?: () => void}) {
  return <div role="alert" className="flex items-start gap-3 rounded-lg border border-[#eedccd] bg-[#fff8f1] p-4 text-xs leading-6 text-[#9f744f]"><AlertCircle size={17} className="mt-1 shrink-0" /><div className="flex-1">{message}</div>{retry && <button className="shrink-0 font-semibold underline underline-offset-4" onClick={retry}>Retry</button>}</div>;
}
export function ExternalLink({ href, children, className = '' }: {href: string; children: React.ReactNode; className?: string}) {
  const safeHref = /^https?:\/\//i.test(href) || href.startsWith('/') ? href : undefined;
  return <a href={safeHref} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-1.5 text-[#be754d] hover:text-[#9b5530] ${className}`}>{children}<ArrowUpRight size={13} /></a>;
}
export function Modal({ title, children, onClose, wide = false }: {title: string; children: React.ReactNode; onClose: () => void; wide?: boolean}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key === 'Tab') {
        const nodes = ref.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]');
        if (!nodes?.length) return;
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.body.style.overflow = original; document.removeEventListener('keydown', keydown); before?.focus(); };
  }, []);
  return <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-[#15232c66] p-4 backdrop-blur-[3px]" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={`fade-in max-h-[90vh] w-full overflow-y-auto rounded-2xl border border-white/80 bg-white shadow-2xl outline-none ${wide ? 'max-w-3xl' : 'max-w-lg'}`}>
      <div className="flex items-center justify-between border-b border-[#edf0f2] px-6 py-5"><h2 className="font-display text-base font-semibold">{title}</h2><button aria-label="Close dialog" className="icon-button" onClick={onClose}><X size={18} /></button></div>
      <div className="p-6">{children}</div>
    </div>
  </div>;
}
export function Toast({ message, error, onClose }: {message: string; error?: boolean; onClose: () => void}) {
  useEffect(() => { const timer = setTimeout(onClose, error ? 7000 : 4500); return () => clearTimeout(timer); }, [message, error, onClose]);
  return <div role={error ? 'alert' : 'status'} className="fade-in fixed bottom-6 right-6 z-[4000] flex max-w-lg items-start gap-3 rounded-xl border border-[#45545e] bg-[#25343e] px-5 py-4 text-xs leading-5 text-white shadow-xl">{error ? <AlertCircle size={16} className="mt-0.5 shrink-0 text-[#f4b780]" /> : <Check size={16} className="mt-0.5 shrink-0 text-[#8ac9b6]" />}<span>{message}</span><button aria-label="Dismiss message" className="ml-2 text-[#9cabb5]" onClick={onClose}><X size={15} /></button></div>;
}
