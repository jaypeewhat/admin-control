import React, { useMemo, useState } from 'react';

// Environment vars (injected at build time by Vite)
const env = (import.meta as any).env || {};

// Sensible defaults so the site still works even if env vars aren't configured (e.g., fresh repo/Pages)
const DEFAULT_DRIVER_APK = 'https://www.mediafire.com/file/md9sim3v9mfvk39/application-723d6cd7-f3f5-415a-ad07-f83a259b4ca0.apk/file';
const DEFAULT_STUDENT_APK = 'https://www.mediafire.com/file/lu290xq74hmxocx/application-c8e6407b-414c-4a6e-ae0b-82f43b2e05b6.apk/file';
const DEFAULT_DRIVER_PASS = 'driveronly123';

const DRIVER_APK = (env.VITE_DRIVER_APK_URL as string | undefined)
  || (env.VITE_ANDROID_APK_URL as string | undefined)
  || DEFAULT_DRIVER_APK;
const STUDENT_APK = (env.VITE_STUDENT_APK_URL as string | undefined)
  || DEFAULT_STUDENT_APK;
const SUPPORT_EMAIL = env.VITE_SUPPORT_EMAIL as string | undefined;
const DRIVER_PASS = (env.VITE_DRIVER_PASSCODE as string | undefined)
  || DEFAULT_DRIVER_PASS;

export default function App() {
  const [copied, setCopied] = useState(false);
  const [which, setWhich] = useState<'driver'|'student'>('driver');
  const [driverPassInput, setDriverPassInput] = useState('');

  const currentUrl = which === 'driver' ? DRIVER_APK : STUDENT_APK;
  const driverLocked = which === 'driver' && !!DRIVER_PASS && driverPassInput !== DRIVER_PASS;
  const disabled = !currentUrl || driverLocked;
  const apkHost = useMemo(() => {
    try { return currentUrl ? new URL(currentUrl).host : ''; } catch { return ''; }
  }, [currentUrl]);

  const copyLink = async () => {
    if (!currentUrl) return;
    try {
      await navigator.clipboard.writeText(currentUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {}
  };

  return (
    <div className="shell">
      <div className="aurora" />
      <header className="nav">
        <div className="brand">
          <div className="brand__logo" />
          <span className="brand__title">SLSUTrack</span>
        </div>
      </header>

      <main className="center">
        <div className="glass">
          <div className="seg" role="tablist" aria-label="Choose app type">
            <button
              className={`seg__btn ${which==='driver'?'is-active':''}`}
              role="tab"
              aria-selected={which==='driver'}
              onClick={() => setWhich('driver')}
            >
              🚚 Driver
            </button>
            <button
              className={`seg__btn ${which==='student'?'is-active':''}`}
              role="tab"
              aria-selected={which==='student'}
              onClick={() => setWhich('student')}
            >
              🎓 Student
            </button>
          </div>
          <h1 className="headline">Download the SLSUTrack {which === 'driver' ? 'Driver' : 'Student'} app</h1>
          <p className="muted">Get the latest Android .apk provided by your administrator.</p>

          {which === 'driver' && (
            <div className="lock" aria-live="polite">
              <div className="lock__label">
                <span className="lock__icon">🔒</span>
                Driver download is protected. Enter passcode to unlock.
              </div>
              <div className="lock__row">
                <input
                  className="input"
                  type="password"
                  placeholder="Enter driver passcode"
                  value={driverPassInput}
                  onChange={(e) => setDriverPassInput(e.target.value)}
                />
                <span className={`badge ${!driverLocked ? 'badge--ok' : ''}`}>
                  {!driverLocked ? 'Unlocked' : 'Locked'}
                </span>
              </div>
              <div className="lock__help">
                Don’t have the passcode? {SUPPORT_EMAIL ? (
                  <a href={`mailto:${SUPPORT_EMAIL}`}>Contact your administrator</a>
                ) : (
                  'Contact your administrator'
                )}.
              </div>
            </div>
          )}

          <div className="cta">
            <a
              className={`btn btn--primary ${disabled ? 'btn--disabled' : ''}`}
              href={currentUrl || '#'}
              aria-disabled={disabled}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => { if (disabled) e.preventDefault(); }}
            >
              <span>Download {which === 'driver' ? 'Driver' : 'Student'} APK</span>
              <span className="arrow">→</span>
            </a>
            <button className="btn btn--ghost" onClick={copyLink} disabled={disabled}>
              {copied ? 'Copied!' : 'Copy link'}
            </button>
          </div>

          {apkHost && (
            <div className="hint">File hosted on <span className="code">{apkHost}</span></div>
          )}

          <div className="steps">
            <div className="step">
              <div className="step__num">1</div>
              <div className="step__body">Tap <b>Download APK</b> and confirm the download.</div>
            </div>
            <div className="step">
              <div className="step__num">2</div>
              <div className="step__body">Open the file and allow installation from your browser or file manager.</div>
            </div>
            <div className="step">
              <div className="step__num">3</div>
              <div className="step__body">Launch SLSUTrack and sign in.</div>
            </div>
          </div>

          <div className="support">
            Need help? {SUPPORT_EMAIL ? <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> : 'Contact your administrator'}.
          </div>
        </div>
      </main>

      <footer className="foot">© {new Date().getFullYear()} SLSUTrack</footer>
    </div>
  );
}
