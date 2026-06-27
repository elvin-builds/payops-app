import React, { useState, useEffect } from 'react';

const API = '/api';

// ─── API Helper ───────────────────────────────────────────
async function api(path, options = {}) {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ─── Styles ───────────────────────────────────────────────
const styles = {
  app: { maxWidth: 800, margin: '0 auto', padding: 20, fontFamily: 'system-ui, -apple-system, sans-serif', color: '#1a1a1a' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30, paddingBottom: 15, borderBottom: '2px solid #e5e7eb' },
  title: { fontSize: 24, fontWeight: 700, color: '#1e40af' },
  btn: { padding: '8px 16px', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 14 },
  btnPrimary: { backgroundColor: '#2563eb', color: 'white' },
  btnDanger: { backgroundColor: '#dc2626', color: 'white' },
  btnSecondary: { backgroundColor: '#e5e7eb', color: '#374151' },
  input: { width: '100%', padding: 10, border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, marginBottom: 12, boxSizing: 'border-box' },
  card: { backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: 20, marginBottom: 16 },
  balance: { fontSize: 36, fontWeight: 700, color: '#059669' },
  status: { padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 600 },
  error: { color: '#dc2626', marginBottom: 12, fontSize: 14 },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '8px 12px', borderBottom: '2px solid #e5e7eb', fontSize: 13, color: '#6b7280' },
  td: { padding: '8px 12px', borderBottom: '1px solid #f3f4f6', fontSize: 14 },
};

const statusColors = {
  pending: { backgroundColor: '#fef3c7', color: '#92400e' },
  processing: { backgroundColor: '#dbeafe', color: '#1e40af' },
  completed: { backgroundColor: '#d1fae5', color: '#065f46' },
  failed: { backgroundColor: '#fee2e2', color: '#991b1b' },
};

// ─── Login/Register Page ──────────────────────────────────
function AuthPage({ onLogin }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const endpoint = isLogin ? '/auth/login' : '/auth/register';
      const data = await api(endpoint, {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      localStorage.setItem('token', data.token);
      onLogin(data.user);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  return (
    <div style={{ ...styles.app, maxWidth: 400, marginTop: 80 }}>
      <h1 style={{ ...styles.title, textAlign: 'center', marginBottom: 30 }}>💰 PayOps Platform</h1>
      <div style={styles.card}>
        <h2 style={{ marginTop: 0 }}>{isLogin ? 'Login' : 'Register'}</h2>
        {error && <div style={styles.error}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <input style={styles.input} type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required />
          <input style={styles.input} type="password" placeholder="Password (min 6 chars)" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} />
          <button style={{ ...styles.btn, ...styles.btnPrimary, width: '100%', padding: 12 }} disabled={loading}>
            {loading ? 'Loading...' : isLogin ? 'Login' : 'Register'}
          </button>
        </form>
        <p style={{ textAlign: 'center', marginTop: 16, fontSize: 14, color: '#6b7280' }}>
          {isLogin ? "Don't have an account? " : 'Already have an account? '}
          <span style={{ color: '#2563eb', cursor: 'pointer' }} onClick={() => { setIsLogin(!isLogin); setError(''); }}>
            {isLogin ? 'Register' : 'Login'}
          </span>
        </p>
        {isLogin && (
          <p style={{ textAlign: 'center', fontSize: 12, color: '#9ca3af' }}>
            Test account: test@payops.local / test123
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────
function Dashboard({ user, onLogout }) {
  const [transactions, setTransactions] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [balance, setBalance] = useState(user.balance);
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [tab, setTab] = useState('transactions');

  const loadData = async () => {
    try {
      const [txData, notifData, userData] = await Promise.all([
        api('/transactions'),
        api('/notifications'),
        api('/auth/me'),
      ]);
      setTransactions(txData.transactions);
      setNotifications(notifData.notifications);
      setBalance(userData.user.balance);
    } catch (err) {
      if (err.message.includes('token') || err.message.includes('401')) {
        onLogout();
      }
    }
  };

  useEffect(() => {
    loadData();
    // 5 saniyədə bir yenilə — transaction status dəyişikliklərini görmək üçün
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, []);

  const createTransaction = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    try {
      await api('/transactions', {
        method: 'POST',
        body: JSON.stringify({ amount: parseFloat(amount), recipient, description }),
      });
      setSuccess('Transaction created! It will be processed shortly.');
      setAmount('');
      setRecipient('');
      setDescription('');
      loadData();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div style={styles.app}>
      <div style={styles.header}>
        <div>
          <span style={styles.title}>💰 PayOps</span>
          <span style={{ marginLeft: 12, color: '#6b7280', fontSize: 14 }}>{user.email}</span>
        </div>
        <button style={{ ...styles.btn, ...styles.btnDanger }} onClick={() => { localStorage.removeItem('token'); onLogout(); }}>
          Logout
        </button>
      </div>

      {/* Balance Card */}
      <div style={styles.card}>
        <div style={{ color: '#6b7280', fontSize: 14, marginBottom: 4 }}>Available Balance</div>
        <div style={styles.balance}>${parseFloat(balance).toFixed(2)}</div>
      </div>

      {/* Create Transaction */}
      <div style={styles.card}>
        <h3 style={{ marginTop: 0, marginBottom: 16 }}>New Transaction</h3>
        {error && <div style={styles.error}>{error}</div>}
        {success && <div style={{ color: '#059669', marginBottom: 12, fontSize: 14 }}>{success}</div>}
        <form onSubmit={createTransaction} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input style={{ ...styles.input, flex: 1, minWidth: 100, marginBottom: 0 }} type="number" step="0.01" min="0.01" placeholder="Amount" value={amount} onChange={e => setAmount(e.target.value)} required />
          <input style={{ ...styles.input, flex: 2, minWidth: 150, marginBottom: 0 }} type="text" placeholder="Recipient" value={recipient} onChange={e => setRecipient(e.target.value)} required />
          <input style={{ ...styles.input, flex: 2, minWidth: 150, marginBottom: 0 }} type="text" placeholder="Description (optional)" value={description} onChange={e => setDescription(e.target.value)} />
          <button style={{ ...styles.btn, ...styles.btnPrimary }} type="submit">Send</button>
        </form>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button style={{ ...styles.btn, ...(tab === 'transactions' ? styles.btnPrimary : styles.btnSecondary) }} onClick={() => setTab('transactions')}>
          Transactions ({transactions.length})
        </button>
        <button style={{ ...styles.btn, ...(tab === 'notifications' ? styles.btnPrimary : styles.btnSecondary) }} onClick={() => setTab('notifications')}>
          Notifications ({notifications.length})
        </button>
      </div>

      {/* Transactions Table */}
      {tab === 'transactions' && (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Date</th>
              <th style={styles.th}>Recipient</th>
              <th style={styles.th}>Amount</th>
              <th style={styles.th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {transactions.length === 0 && (
              <tr><td colSpan={4} style={{ ...styles.td, textAlign: 'center', color: '#9ca3af' }}>No transactions yet</td></tr>
            )}
            {transactions.map(tx => (
              <tr key={tx.id}>
                <td style={styles.td}>{new Date(tx.created_at).toLocaleString()}</td>
                <td style={styles.td}>{tx.recipient}</td>
                <td style={styles.td}>${parseFloat(tx.amount).toFixed(2)}</td>
                <td style={styles.td}>
                  <span style={{ ...styles.status, ...statusColors[tx.status] }}>{tx.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Notifications */}
      {tab === 'notifications' && (
        <div>
          {notifications.length === 0 && (
            <p style={{ textAlign: 'center', color: '#9ca3af' }}>No notifications yet</p>
          )}
          {notifications.map(n => (
            <div key={n.id} style={{ ...styles.card, padding: 12, display: 'flex', justifyContent: 'space-between' }}>
              <span>{n.message}</span>
              <span style={{ color: '#9ca3af', fontSize: 12 }}>{new Date(n.created_at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);

  // Check existing token on mount
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      api('/auth/me')
        .then(data => setUser(data.user))
        .catch(() => localStorage.removeItem('token'));
    }
  }, []);

  if (!user) return <AuthPage onLogin={setUser} />;
  return <Dashboard user={user} onLogout={() => setUser(null)} />;
}
