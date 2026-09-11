'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
let administratorKey = '';
export function setAdministratorKey(value: string) { administratorKey = value; }
export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (administratorKey) headers.set('X-Admin-Key', administratorKey);
  const response = await fetch(url, { ...options, headers });
  let body: any;
  try { body = await response.json(); } catch { throw new Error(`The service returned an unreadable response (HTTP ${response.status}). Check Data sources.`); }
  if (!response.ok) throw new Error([body.error || body.detail || `Request failed (${response.status})`, ...(body.details || [])].join('. '));
  return body as T;
}
export function useApi<T>(url: string | null, refresh = 0, pollMs = 0) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(url));
  const [tick, setTick] = useState(0);
  const previousUrl = useRef<string | null>(null);
  const reload = useCallback(() => setTick(value => value + 1), []);
  useEffect(() => {
    if (!pollMs || !url) return;
    const timer = setInterval(reload, pollMs);
    return () => clearInterval(timer);
  }, [pollMs, url, reload]);
  useEffect(() => {
    if (!url) { setLoading(false); return; }
    const controller = new AbortController();
    previousUrl.current = url;
    setLoading(true); setError(null);
    api<T>(url, { signal: controller.signal }).then(result => { setData(result); setLoading(false); }).catch(error => {
      if (error.name === 'AbortError') return;
      setError(error.message); setLoading(false);
    });
    return () => controller.abort();
  }, [url, refresh, tick]);
  return { data, error, loading, reload, setData };
}
