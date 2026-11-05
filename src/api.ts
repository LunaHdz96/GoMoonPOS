import { askText } from './dialog';

export type Role = 'cashier' | 'manager' | 'admin';
export interface User { id: number; username: string; name: string; role: Role; active?: number }
export interface Product { id: number; sku: string; name: string; price: number; cost: number; stock: number; min_stock: number }
export interface Customer { id: number; name: string; phone: string; credit_limit: number; credit_days: number; balance: number }
export interface Supervisor { username: string; password: string }

declare global {
  interface Window {
    api: {
      call(method: string, ...args: unknown[]): Promise<{ ok: boolean; data?: any; error?: string }>;
      onUpdateStatus(listener: (status: UpdateStatus) => void): () => void;
    };
  }
}

export interface UpdateStatus {
  state: 'idle' | 'checking' | 'available' | 'none' | 'downloading' | 'downloaded' | 'error';
  version?: string;
  percent?: number;
  message?: string;
}

export async function api<T = any>(method: string, ...args: unknown[]): Promise<T> {
  const r = await window.api.call(method, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.data as T;
}

export async function updateApi<T = any>(method: 'status' | 'check' | 'download' | 'install'): Promise<T> {
  return window.api.call(`updates.${method}`) as Promise<T>;
}

export const money = (n: number) => `$${(n || 0).toFixed(2)}`;
export const dateStr = (s?: string | null) => (s ? new Date(s).toLocaleDateString('es-MX') : '');

export function dayRange(from: string, to: string) {
  const f = from ? new Date(from + 'T00:00:00').toISOString() : undefined;
  const t = to ? new Date(to + 'T23:59:59.999').toISOString() : undefined;
  return { from: f, to: t };
}

// Runs an action; if it needs supervisor approval, asks for credentials and retries.
export async function withSupervisor<T>(run: (sup?: Supervisor) => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (!/supervisor/i.test((e as Error).message)) throw e;
    const username = await askText('Autorización requerida. Usuario del supervisor:');
    if (!username) throw e;
    const password = await askText('Contraseña del supervisor:', { secret: true });
    if (password === null) throw e;
    return run({ username, password });
  }
}
