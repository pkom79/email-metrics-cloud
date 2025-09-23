const GLOBAL_KEY = '__EMC_DIAG_EVENTS__';
const MAX_EVENTS = 200;

type DiagEvent = { ts: number; source: string; message: string; data?: any };

const envDiagFlag = typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_DIAG_UPLOAD === '1';

const readQueryFlag = () => {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('diag') === '1';
  } catch {
    return false;
  }
};

export const isDiagEnabled = () => envDiagFlag || readQueryFlag();

const getStore = (): DiagEvent[] => {
  if (typeof window === 'undefined') return [];
  const existing = (window as any)[GLOBAL_KEY];
  if (Array.isArray(existing)) return existing;
  (window as any)[GLOBAL_KEY] = [];
  return (window as any)[GLOBAL_KEY];
};

export const recordDiag = (source: string, message: string, data?: any) => {
  if (!isDiagEnabled()) return;
  const store = getStore();
  const entry: DiagEvent = { ts: Date.now(), source, message, data };
  store.push(entry);
  if (store.length > MAX_EVENTS) store.splice(0, store.length - MAX_EVENTS);
  try {
    console.log(`[Diag] ${source}: ${message}`, data);
  } catch {
    /* noop */
  }
};

export const getDiagEvents = (): DiagEvent[] => {
  const store = getStore();
  return store.slice();
};

