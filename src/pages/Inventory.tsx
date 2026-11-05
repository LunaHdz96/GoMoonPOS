import { useEffect, useState } from 'react';
import { api, money, Product } from '../api';
import { askText } from '../dialog';

const empty = { sku: '', name: '', price: 0, cost: 0, stock: 0, min_stock: 0 };

export default function Inventory() {
  const [rows, setRows] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<Partial<Product>>(empty);
  const [err, setErr] = useState('');
  const load = () => api<Product[]>('products.list', search).then(setRows);
  useEffect(() => { load(); }, [search]);

  const guard = async (fn: () => Promise<unknown>) => {
    setErr('');
    try { await fn(); load(); } catch (e) { setErr((e as Error).message); }
  };
  const save = () => guard(async () => { await api('products.save', form); setForm(empty); });
  const move = async (p: Product, type: 'purchase' | 'waste' | 'adjust') => {
    const label = { purchase: 'Cantidad a ingresar', waste: 'Cantidad de merma', adjust: 'Ajuste (+/-)' }[type];
    const qty = await askText(label);
    if (!qty) return;
    const note = (await askText('Motivo / nota')) || '';
    guard(() => api('stock.move', { product_id: p.id, qty: Number(qty), type, note }));
  };
  const num = (k: keyof Product) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: Number(e.target.value) });

  return (
    <>
      <div className="card">
        <h3>{form.id ? 'Editar producto' : 'Nuevo producto'}</h3>
        <div className="row">
          <input placeholder="SKU" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
          <input placeholder="Nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input type="number" placeholder="Precio" value={form.price} onChange={num('price')} />
          <input type="number" placeholder="Costo" value={form.cost} onChange={num('cost')} />
          {!form.id && <input type="number" placeholder="Existencia inicial" value={form.stock} onChange={num('stock')} />}
          <input type="number" placeholder="Stock mínimo" value={form.min_stock} onChange={num('min_stock')} />
          <button className="btn" onClick={save}>Guardar</button>
          {form.id && <button className="btn alt" onClick={() => setForm(empty)}>Cancelar</button>}
        </div>
        {err && <div className="err">{err}</div>}
      </div>
      <div className="card">
        <div className="row"><input placeholder="Buscar" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <table>
          <thead><tr><th>SKU</th><th>Producto</th><th>Precio</th><th>Costo</th><th>Stock</th><th>Mín.</th><th /></tr></thead>
          <tbody>{rows.map((p) => (
            <tr key={p.id}><td>{p.sku}</td><td>{p.name}</td><td>{money(p.price)}</td><td>{money(p.cost)}</td>
              <td className={p.stock <= p.min_stock ? 'bad' : ''}>{p.stock}{p.stock <= p.min_stock ? ' ⚠ stock bajo' : ''}</td><td>{p.min_stock}</td>
              <td>
                <button className="btn" onClick={() => move(p, 'purchase')}>Entrada</button>{' '}
                <button className="btn danger" onClick={() => move(p, 'waste')}>Merma</button>{' '}
                <button className="btn alt" onClick={() => move(p, 'adjust')}>Ajuste</button>{' '}
                <button className="btn alt" onClick={() => setForm(p)}>Editar</button>{' '}
                <button className="btn danger" onClick={() => window.confirm(`¿Eliminar ${p.name}?`) && guard(() => api('products.remove', p.id))}>✕</button>
              </td></tr>
          ))}</tbody>
        </table>
      </div>
    </>
  );
}
