import { useEffect, useState } from 'react';
import { api, Role, UpdateStatus, updateApi, User } from './api';
import logo from './assets/gomoonpos-logo.jpg';
import Sales from './pages/Sales';
import Inventory from './pages/Inventory';
import Customers from './pages/Customers';
import Loans from './pages/Loans';
import Reports from './pages/Reports';
import Users from './pages/Users';

const RANK: Record<Role, number> = { cashier: 1, manager: 2, admin: 3 };
const ROLE_LABEL: Record<Role, string> = { cashier: 'Cajero', manager: 'Gerente', admin: 'Administrador' };

const TABS: { id: string; label: string; min: Role; view: () => JSX.Element }[] = [
  { id: 'sales', label: 'Ventas', min: 'cashier', view: () => <Sales /> },
  { id: 'customers', label: 'Clientes / Fiados', min: 'cashier', view: () => <Customers /> },
  { id: 'loans', label: 'Préstamos', min: 'cashier', view: () => <Loans /> },
  { id: 'inventory', label: 'Inventario', min: 'manager', view: () => <Inventory /> },
  { id: 'reports', label: 'Reportes', min: 'manager', view: () => <Reports /> },
  { id: 'users', label: 'Usuarios', min: 'admin', view: () => <Users /> },
];

function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [username, setU] = useState('');
  const [password, setP] = useState('');
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try { onLogin(await api<User>('login', username, password)); } catch (err) { setError((err as Error).message); }
  };
  return (
    <form className="card login" onSubmit={submit}>
      <img className="login-logo" src={logo} alt="Logotipo de GoMoonPOS" />
      <h2>GoMoonPOS</h2>
      <input placeholder="Usuario" value={username} onChange={(e) => setU(e.target.value)} autoFocus />
      <input placeholder="Contraseña" type="password" value={password} onChange={(e) => setP(e.target.value)} />
      {error && <div className="err">{error}</div>}
      <button className="btn" type="submit">Entrar</button>
    </form>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [tab, setTab] = useState('sales');
  const [update, setUpdate] = useState<UpdateStatus>({ state: 'idle' });
  useEffect(() => { api<User | null>('me').then(setUser); }, []);
  useEffect(() => {
    const unsubscribe = window.api.onUpdateStatus(setUpdate);
    updateApi<UpdateStatus>('status').then(setUpdate).catch(() => undefined);
    return unsubscribe;
  }, []);
  if (!user) return <Login onLogin={(u) => { setUser(u); setTab('sales'); }} />;
  const tabs = TABS.filter((t) => RANK[user.role] >= RANK[t.min]);
  const current = tabs.find((t) => t.id === tab) ?? tabs[0];
  return (
    <div className="app">
      <nav>
        <span className="brand">🌙 GoMoonPOS</span>
        {tabs.map((t) => (
          <button key={t.id} className={t.id === current.id ? 'active' : ''} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
        <span className="spacer" />
        <span style={{ color: '#d1d5db' }}>{user.name} ({ROLE_LABEL[user.role]})</span>
        <button onClick={async () => { await api('logout'); setUser(null); }}>Salir</button>
      </nav>
      <main key={current.id}>{current.view()}</main>
      {(update.state === 'available' || update.state === 'downloading' || update.state === 'downloaded' || update.state === 'error') && (
        <div className={`update ${update.state === 'error' ? 'error' : ''}`}>
          {update.state === 'available' && <>Nueva versión {update.version} disponible. <button className="btn" onClick={() => updateApi('download').catch((e) => setUpdate({ state: 'error', message: e.message }))}>Descargar</button></>}
          {update.state === 'downloading' && <>Descargando actualización: {update.percent}%</>}
          {update.state === 'downloaded' && <>La versión {update.version} está lista. <button className="btn" onClick={() => updateApi('install')}>Instalar y reiniciar</button></>}
          {update.state === 'error' && <>No se pudo buscar o descargar la actualización: {update.message}</>}
        </div>
      )}
    </div>
  );
}
