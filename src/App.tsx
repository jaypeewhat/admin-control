import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut, User } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, orderBy, query, setDoc, updateDoc, where } from 'firebase/firestore';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { auth, db } from './firebase';

type Profile = {
  uid: string;
  email?: string;
  display_name?: string;
  name?: string;
  user_type: 'driver' | 'student' | 'admin';
  status?: 'active' | 'blocked';
  blocked?: boolean;
  deleted?: boolean;
  updated_at?: string;
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [adminCode, setAdminCode] = useState('');
  const [filter, setFilter] = useState<'driver' | 'student' | 'all'>('driver');
  const [search, setSearch] = useState('');
  const [people, setPeople] = useState<Profile[]>([]);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const loadUsers = useCallback(async () => {
    try {
      const col = collection(db, 'user_profiles');
      // Avoid composite index requirement when filtered by removing orderBy at Firestore level
      const q = filter === 'all'
        ? query(col, orderBy('updated_at', 'desc'))
        : query(col, where('user_type', '==', filter));

      const snap = await getDocs(q);
      const rows: Profile[] = [];
      snap.forEach((d) => {
        const p = d.data() as any;
        rows.push({
          uid: p.uid || p.id || d.id,
          email: p.email,
          display_name: p.display_name,
          name: p.name,
          user_type: p.user_type,
          status: p.status,
          blocked: p.blocked,
          deleted: p.deleted,
          updated_at: p.updated_at,
        });
      });

      // If we didn't order at the query level, sort on the client by updated_at desc
      if (filter !== 'all') {
        rows.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
      }
      // Hide soft-deleted profiles by default
      const visible = rows.filter((r) => r.deleted !== true);
      setPeople(visible);
      setErr(null);
    } catch (e: any) {
      console.error('Failed to load users:', e);
      setErr(e?.message || 'Failed to load users');
    }
  }, [filter]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setErr(null);
      setLoading(true);
      if (u) {
        const snap = await getDoc(doc(db, 'user_profiles', u.uid));
        const data = snap.data() as Profile | undefined;
        // If the account was soft-deleted or blocked, prevent login
        if (data && (data as any).deleted === true) {
          await signOut(auth);
          setIsAdmin(false);
          setErr('This account has been deleted.');
          setLoading(false);
          return;
        }
        if (data && (data.status === 'blocked' || data.blocked)) {
          await signOut(auth);
          setIsAdmin(false);
          setErr('This account has been blocked.');
          setLoading(false);
          return;
        }
        const admin = data?.user_type === 'admin';
        setIsAdmin(admin);
        if (admin) {
          await loadUsers();
        } else {
          await signOut(auth);
          setErr('This account is not an admin.');
        }
      }
      setLoading(false);
    });
    return () => unsub();
  }, [loadUsers]);

  // When filter changes (or loadUsers identity updates), refresh list if admin
  useEffect(() => {
    if (isAdmin) {
      loadUsers();
    }
  }, [isAdmin, loadUsers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return people;
    return people.filter((p) => {
      const name = (p.display_name || p.name || '').toLowerCase();
      const email = (p.email || '').toLowerCase();
      const uid = (p.uid || '').toLowerCase();
      return name.includes(q) || email.includes(q) || uid.includes(q);
    });
  }, [people, search]);

  const doLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setErr(null);
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error: any) {
      setErr(error.message || 'Login failed');
    }
  };

  const doLogout = async () => {
    await signOut(auth);
  };

  const doRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setErr(null);
      const REQUIRED_PASSCODE = (import.meta as any).env?.VITE_ADMIN_PASSCODE || '';
      if (!REQUIRED_PASSCODE) {
        setErr('Admin registration is disabled: missing VITE_ADMIN_PASSCODE');
        return;
      }
      if (adminCode !== REQUIRED_PASSCODE) {
        setErr('Invalid admin passcode');
        return;
      }
      if (!email || !password) {
        setErr('Email and password are required');
        return;
      }
      if (password.length < 6) {
        setErr('Password must be at least 6 characters');
        return;
      }
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      const uid = cred.user.uid;
      const now = new Date().toISOString();
      await setDoc(doc(db, 'user_profiles', uid), {
        uid,
        email,
        display_name: name || email.split('@')[0],
        user_type: 'admin',
        status: 'active',
        blocked: false,
        created_at: now,
        updated_at: now,
        email_verified: cred.user.emailVerified ?? false,
      }, { merge: true });
      // onAuthStateChanged will flip to admin and load the dashboard
    } catch (error: any) {
      setErr(error.message || 'Registration failed');
    }
  };

  const toggleBlock = async (p: Profile) => {
    try {
      setBusy((b) => ({ ...b, [p.uid]: true }));
      const next = p.status === 'blocked' || p.blocked ? 'active' : 'blocked';
      await updateDoc(doc(db, 'user_profiles', p.uid), {
        status: next,
        blocked: next === 'blocked',
        updated_at: new Date().toISOString(),
      });
      setPeople((prev) => prev.map((x) => (x.uid === p.uid ? { ...x, status: next, blocked: next === 'blocked' } : x)));
    } catch (e: any) {
      setErr(e.message || 'Failed to update status');
    } finally {
      setBusy((b) => ({ ...b, [p.uid]: false }));
    }
  };

  if (!user || !isAdmin) {
    return (
      <div className="container">
        <div className="card login">
          <div className="card--p login__body">
            <div className="brand" style={{ marginBottom: 10 }}>
              <div className="brand__logo" />
              <h1 className="brand__title">SLSU Admin</h1>
            </div>
            <div style={{ display:'flex', gap:8, marginBottom: 8 }}>
              <button className={`btn btn--sm ${mode==='login' ? 'btn--info' : ''}`} onClick={() => { setMode('login'); setErr(null); }}>Sign in</button>
              <button className={`btn btn--sm ${mode==='register' ? 'btn--info' : ''}`} onClick={() => { setMode('register'); setErr(null); }}>Register admin</button>
            </div>
            {mode === 'login' ? (
              <>
                <h2 className="login__title">Sign in</h2>
                <form onSubmit={doLogin} className="login__grid">
                  <label>
                    <span className="label">Email</span>
                    <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                  </label>
                  <label>
                    <span className="label">Password</span>
                    <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                  </label>
                  <button type="submit" className="btn btn--primary">{loading ? 'Signing in…' : 'Login'}</button>
                  {err && <div className="badge badge--warn">{err}</div>}
                  <div className="footer">Use an account with <b>user_type = admin</b>.</div>
                </form>
              </>
            ) : (
              <>
                <h2 className="login__title">Register new admin</h2>
                <form onSubmit={doRegister} className="login__grid">
                  <label>
                    <span className="label">Full name</span>
                    <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jane Doe" />
                  </label>
                  <label>
                    <span className="label">Email</span>
                    <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                  </label>
                  <label>
                    <span className="label">Password</span>
                    <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                  </label>
                  <label>
                    <span className="label">Admin passcode</span>
                    <input className="input" type="password" value={adminCode} onChange={(e) => setAdminCode(e.target.value)} placeholder="Enter admin passcode" required />
                  </label>
                  <button type="submit" className="btn btn--primary">Create admin</button>
                  {err && <div className="badge badge--warn">{err}</div>}
                  <div className="footer">This creates a Firebase Auth user and grants admin access if the passcode matches.</div>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="header">
        <div className="brand">
          <div className="brand__logo" />
          <h2 className="brand__title">Admin Dashboard</h2>
        </div>
        <div className="actions">
          <button onClick={loadUsers} className="btn btn--info">Reload</button>
          <button onClick={doLogout} className="btn">Logout</button>
        </div>
      </div>

      <div className="card card--p">
        <div className="toolbar">
          {(['driver','student','all'] as const).map((k) => (
            <button key={k} onClick={() => setFilter(k)} className={k === filter ? 'chip chip--active' : 'chip'}>{k.toUpperCase()}</button>
          ))}
          <input className="input" placeholder="Search name, email, uid" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th className="th">UID</th>
                <th className="th">Name</th>
                <th className="th">Email</th>
                <th className="th">Type</th>
                <th className="th">Status</th>
                <th className="th">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.uid}>
                  <td className="td td--mono">{p.uid}</td>
                  <td className="td">{p.display_name || p.name || '—'}</td>
                  <td className="td">{p.email || '—'}</td>
                  <td className="td">{p.user_type}</td>
                  <td className="td">
                    {(p.status === 'blocked' || p.blocked) ? (
                      <span className="badge badge--warn">Blocked</span>
                    ) : (
                      <span className="badge badge--ok">Active</span>
                    )}
                  </td>
                  <td className="td">
                    <div className="table-actions">
                      <button disabled={!!busy[p.uid]} onClick={() => toggleBlock(p)} className="btn btn--sm btn--ghost">
                        {(p.status === 'blocked' || p.blocked) ? 'Unblock' : 'Block'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {err && <div style={{ color: 'var(--danger)', marginTop: 12 }}>{err}</div>}
      </div>
    </div>
  );
}

// Inline components/styles removed in favor of global CSS classes in styles.css
