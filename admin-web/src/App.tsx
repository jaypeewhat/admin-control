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

  const stats = useMemo(() => {
    const total = people.length;
    const drivers = people.filter((p) => p.user_type === 'driver').length;
    const students = people.filter((p) => p.user_type === 'student').length;
    const blocked = people.filter((p) => p.status === 'blocked' || p.blocked).length;
    return {
      total,
      drivers,
      students,
      blocked,
      active: total - blocked,
    };
  }, [people]);

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
      <div className="auth-shell">
        <div className="auth-panel">
          <div className="auth-header">
            <div className="brand">
              <div className="brand__logo" />
              <div>
                <h1 className="brand__title">SLSU Admin</h1>
                <p className="brand__subtitle">Secure portal for managing drivers and students</p>
              </div>
            </div>
            <div className="auth-toggle" role="tablist" aria-label="Auth Mode">
              <button className={`pill ${mode==='login' ? 'pill--active' : ''}`} onClick={() => { setMode('login'); setErr(null); }}>Sign In</button>
              <button className={`pill ${mode==='register' ? 'pill--active' : ''}`} onClick={() => { setMode('register'); setErr(null); }}>Register Admin</button>
            </div>
          </div>

          {mode === 'login' ? (
            <>
              <h2 className="section-title">Welcome back</h2>
              <p className="section-subtitle">Use your admin credentials to access the dashboard.</p>
              <form onSubmit={doLogin} className="form-grid">
                <label>
                  <span className="label">Email</span>
                  <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </label>
                <label>
                  <span className="label">Password</span>
                  <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                </label>
                <button type="submit" className="btn btn--primary btn--lg">{loading ? 'Signing in…' : 'Login'}</button>
                {err && <div className="alert alert--error">{err}</div>}
                <div className="footer">Need access? Request an invite from an existing administrator.</div>
              </form>
            </>
          ) : (
            <>
              <h2 className="section-title">Create a new admin</h2>
              <p className="section-subtitle">Protected with an admin passcode to prevent unauthorized access.</p>
              <form onSubmit={doRegister} className="form-grid">
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
                <button type="submit" className="btn btn--primary btn--lg">Create admin</button>
                {err && <div className="alert alert--error">{err}</div>}
                <div className="footer">A Firebase Auth user with admin role will be created if the passcode matches.</div>
              </form>
            </>
          )}
        </div>

        <aside className="auth-aside">
          <div className="auth-aside__content">
            <h3>Keep SLSUTrack secure</h3>
            <p>Monitor accounts, block suspicious activity, and stay ahead with realtime control.</p>
            <ul>
              <li>Approve or block drivers instantly</li>
              <li>Filter by role and search across metadata</li>
              <li>Invite trusted teammates with an admin passcode</li>
            </ul>
          </div>
        </aside>
      </div>
    );
  }

  return (
    <div className="dashboard-shell">
      <header className="dashboard-header">
        <div className="brand">
          <div className="brand__logo" />
          <div>
            <h2 className="brand__title">Admin Dashboard</h2>
            <p className="brand__subtitle">Realtime visibility into every SLSUTrack account</p>
          </div>
        </div>
        <div className="actions">
          <button onClick={loadUsers} className="btn btn--info">Refresh data</button>
          <button onClick={doLogout} className="btn">Logout</button>
        </div>
      </header>

      <section className="stats-grid" aria-label="Account summary">
        <article className="stat-card">
          <span className="stat-label">Total accounts</span>
          <span className="stat-value">{stats.total}</span>
          <span className="stat-foot">Drivers &amp; students combined</span>
        </article>
        <article className="stat-card">
          <span className="stat-label">Active users</span>
          <span className="stat-value">{stats.active}</span>
          <span className="stat-foot">{stats.blocked} currently blocked</span>
        </article>
        <article className="stat-card">
          <span className="stat-label">Drivers</span>
          <span className="stat-value">{stats.drivers}</span>
          <span className="stat-foot">Enrolled to share routes</span>
        </article>
        <article className="stat-card">
          <span className="stat-label">Students</span>
          <span className="stat-value">{stats.students}</span>
          <span className="stat-foot">Following the live tracker</span>
        </article>
      </section>

      <section className="card card--panel" aria-label="User management table">
        <div className="toolbar">
          <div className="toolbar__filters">
            {(['driver','student','all'] as const).map((k) => (
              <button key={k} onClick={() => setFilter(k)} className={k === filter ? 'chip chip--active' : 'chip'}>{k.toUpperCase()}</button>
            ))}
          </div>
          <div className="toolbar__search">
            <svg aria-hidden focusable="false" viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
            <input className="input" placeholder="Search name, email, or UID" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        <div className="table-wrap" role="region" aria-live="polite">
          <table className="table">
            <thead>
              <tr>
                <th className="th">User</th>
                <th className="th">Contact</th>
                <th className="th">Role</th>
                <th className="th">Status</th>
                <th className="th">Updated</th>
                <th className="th">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.uid}>
                  <td className="td">
                    <div className="user-cell">
                      <div className="avatar" aria-hidden>{(p.display_name || p.name || p.email || '?').substring(0, 2).toUpperCase()}</div>
                      <div>
                        <div className="user-name">{p.display_name || p.name || '—'}</div>
                        <div className="user-id">{p.uid}</div>
                      </div>
                    </div>
                  </td>
                  <td className="td">
                    <div className="contact-cell">{p.email || '—'}</div>
                  </td>
                  <td className="td">
                    <span className={`role role--${p.user_type}`}>{p.user_type}</span>
                  </td>
                  <td className="td">
                    {(p.status === 'blocked' || p.blocked) ? (
                      <span className="badge badge--warn">Blocked</span>
                    ) : (
                      <span className="badge badge--ok">Active</span>
                    )}
                  </td>
                  <td className="td"><span className="time-chip">{p.updated_at ? new Date(p.updated_at).toLocaleString() : '—'}</span></td>
                  <td className="td">
                    <div className="table-actions">
                      <button
                        disabled={!!busy[p.uid]}
                        onClick={() => toggleBlock(p)}
                        className={(p.status === 'blocked' || p.blocked) ? 'btn btn--sm btn--primary' : 'btn btn--sm btn--danger'}
                      >
                        {(p.status === 'blocked' || p.blocked) ? 'Unblock user' : 'Block user'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {err && <div className="alert alert--error" role="status">{err}</div>}
        {!err && filtered.length === 0 && (
          <div className="empty-state">
            <h3>No matching users</h3>
            <p>Try adjusting the filters or search query.</p>
          </div>
        )}
      </section>
    </div>
  );
}

// Inline components/styles removed in favor of global CSS classes in styles.css
