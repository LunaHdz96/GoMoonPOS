import { useEffect, useState } from 'react';
import { api, dateStr, dayRange, money } from '../api';

const METHOD: Record<string, string> = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia' };
const today = () => new Date().toLocaleDateString('sv-SE');

export default function Reports() {
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState('');

  const load = async () => {
    setErr('');
    const r = dayRange(from, to);
    try {
      const [byProduct, byHour, byEmployee, cash, overdue, sales] = await Promise.all([
        api('reports.byProduct', r), api('reports.byHour', r), api('reports.byEmployee', r),
        api('reports.cashClose', r), api('credit.overdue'), api('sales.list', r),
      ]);
      setData({ byProduct, byHour, byEmployee, cash, overdue, sales });
    } catch (e) { setErr((e as Error).message); }
  };
  useEffect(() => { load(); }, []);

  const cancel = async (id: number) => {
    if (!window.confirm(`¿Cancelar la venta #${id}?`)) return;
    try { await api('sales.cancel', id); load(); } catch (e) { setErr((e as Error).message); }
  };
  const maxHour = data ? Math.max(1, ...data.byHour.map((h: any) => h.sales)) : 1;

  return (
    <>
      <div className="card row">
        Del <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /> al <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <button className="btn" onClick={load}>Consultar</button>
        {err && <span className="err">{err}</span>}
      </div>
      {data && (
        <>
          <div className="grid2">
            <div className="card">
              <h3>Corte de caja</h3>
              <table><tbody>
                {data.cash.byMethod.map((r: any) => <tr key={r.method + r.kind}><td>{METHOD[r.method]}{r.kind === 'abono' ? ' (abonos)' : ''}</td><td>{money(r.amount)}</td></tr>)}
                <tr><th>Total en caja</th><th>{money(data.cash.total)}</th></tr>
                <tr><td>Ventas fiadas (no cuentan)</td><td>{money(data.cash.creditSales)}</td></tr>
              </tbody></table>
              <small>Los préstamos de artículos no afectan el corte.</small>
            </div>
            <div className="card">
              <h3>Rendimiento de empleados</h3>
              <table>
                <thead><tr><th>Empleado</th><th>Ventas</th><th>Total</th><th>Ticket prom.</th></tr></thead>
                <tbody>{data.byEmployee.map((e: any) => <tr key={e.id}><td>{e.name}</td><td>{e.sales}</td><td>{money(e.total)}</td><td>{money(e.avg_ticket)}</td></tr>)}</tbody>
              </table>
            </div>
          </div>
          <div className="grid2">
            <div className="card">
              <h3>Ventas por producto</h3>
              <table>
                <thead><tr><th>Producto</th><th>Cant.</th><th>Importe</th></tr></thead>
                <tbody>{data.byProduct.map((p: any) => <tr key={p.product_id}><td>{p.name}</td><td>{p.qty}</td><td>{money(p.revenue)}</td></tr>)}</tbody>
              </table>
            </div>
            <div className="card">
              <h3>Horarios de mayor afluencia</h3>
              <table><tbody>{data.byHour.filter((h: any) => h.sales > 0).map((h: any) => (
                <tr key={h.hour}><td>{String(h.hour).padStart(2, '0')}:00</td><td style={{ width: '60%' }}><div className="bar" style={{ width: `${(h.sales / maxHour) * 100}%` }} /></td><td>{h.sales} ({money(h.total)})</td></tr>
              ))}</tbody></table>
            </div>
          </div>
          <div className="card">
            <h3>Cartera vencida</h3>
            <table>
              <thead><tr><th>Cliente</th><th>Teléfono</th><th>Saldo</th><th>Vencido</th><th>Desde</th><th>Días</th><th>Motivo</th></tr></thead>
              <tbody>{data.overdue.map((o: any) => (
                <tr key={o.customer_id}><td>{o.name}</td><td>{o.phone}</td><td>{money(o.balance)}</td><td className="bad">{money(o.overdue_amount)}</td>
                  <td>{dateStr(o.oldest_due)}</td><td>{o.days_late}</td><td>{[o.days_late > 0 && 'Fecha de pago vencida', o.over_limit && 'Excede límite'].filter(Boolean).join(' / ')}</td></tr>
              ))}</tbody>
            </table>
            {!data.overdue.length && <small>Sin cartera vencida.</small>}
          </div>
          <div className="card">
            <h3>Ventas del periodo</h3>
            <table>
              <thead><tr><th>#</th><th>Fecha</th><th>Cajero</th><th>Cliente</th><th>Total</th><th>Estado</th><th /></tr></thead>
              <tbody>{data.sales.map((s: any) => (
                <tr key={s.id}><td>{s.id}</td><td>{new Date(s.created_at).toLocaleString('es-MX')}</td><td>{s.user_name}</td><td>{s.customer_name}</td><td>{money(s.total)}</td><td>{s.status === 'done' ? 'Completa' : 'Cancelada'}</td>
                  <td>{s.status === 'done' && <button className="btn danger" onClick={() => cancel(s.id)}>Cancelar</button>}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
