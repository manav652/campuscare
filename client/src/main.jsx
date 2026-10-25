import React, { createContext, useContext, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import './styles.css';

const API = import.meta.env.VITE_API_URL || '/api';
const categories = ['Academics', 'Administration', 'Finance/Accounts', 'Examination', 'Transport', 'Student Welfare and Discipline', 'Placement/Internship', 'Library', 'LMS/Portal Issues', 'Hostel', 'General Feedback/Suggestion', 'Other'];
const getToken = () => null;
const getUser = (fallback = {}) => { try { return JSON.parse(localStorage.getItem('user') || JSON.stringify(fallback)) || fallback; } catch { return fallback; } };
const cleanComplaintText = (value) => String(value ?? '').replaceAll('`', '');
const titleCase = (value) => String(value ?? '').toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
const api = async (path, options = {}) => {
  const headers = options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' };
  const response = await fetch(`${API}${path}`, { ...options, credentials: 'include', headers: { ...headers, ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
};
function CopyTicketButton({ ticketId }) {
  const [copied, setCopied] = useState(false);
  const copy = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    await navigator.clipboard.writeText(ticketId);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  return <button type="button" className="copy-ticket" onClick={copy} aria-label={`Copy complaint ID ${ticketId}`}>{copied ? 'Copied' : 'Copy ID'}</button>;
}

const AuthContext = createContext({ user: null, loading: true, refresh: async () => null, clear: () => {} });
const ThemeContext = createContext({ theme: 'light', toggle: () => {} });
const publicPaths = ['/login', '/admin-login', '/auth/callback', '/privacy', '/terms'];
function AuthProvider({ children }) {
  const location = useLocation();
  const [user, setUser] = useState(() => getUser(null));
  const [loading, setLoading] = useState(true);
  const refresh = async () => {
    const data = await api('/me');
    if (!data.user) throw new Error('Account could not be loaded');
    setUser(data.user);
    localStorage.setItem('user', JSON.stringify(data.user));
    return data.user;
  };
  const clear = () => { setUser(null); localStorage.removeItem('user'); };
  useEffect(() => {
    if (publicPaths.includes(location.pathname)) {
      setLoading(false);
      return;
    }
    refresh().catch(clear).finally(() => setLoading(false));
  }, []);
  return <AuthContext.Provider value={{ user, loading, refresh, clear }}>{children}</AuthContext.Provider>;
}
const useAuth = () => useContext(AuthContext);
const Icon = ({ children }) => <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">{children}</svg>;
const MenuIcon = () => <Icon><path d="M5 7h14M5 12h14M5 17h14" /></Icon>;
const DashboardIcon = () => <Icon><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></Icon>;
const PlusIcon = () => <Icon><path d="M12 4v16M4 12h16" /></Icon>;
const ClipboardIcon = () => <Icon><path d="M8 4.5h8M9 3h6v3H9zM6 5.5h12a1.5 1.5 0 0 1 1.5 1.5v12A1.5 1.5 0 0 1 18 20.5H6A1.5 1.5 0 0 1 4.5 19V7A1.5 1.5 0 0 1 6 5.5Z" /><path d="M8 10h8M8 14h6" /></Icon>;
const UserIcon = () => <Icon><circle cx="12" cy="8" r="3.2" /><path d="M5 20a7 7 0 0 1 14 0" /></Icon>;
const LogoutIcon = () => <Icon><path d="M10 5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19H10M14 8l4 4-4 4M10 12h8" /></Icon>;
const SunIcon = () => <Icon><circle cx="12" cy="12" r="3.5" /><path d="M12 2.5v2M12 19.5v2M21.5 12h-2M4.5 12h-2M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4M18.7 18.7l-1.4-1.4M6.7 6.7L5.3 5.3" /></Icon>;
const MoonIcon = () => <Icon><path d="M20 15.2A8.3 8.3 0 0 1 8.8 4a8.4 8.4 0 1 0 11.2 11.2Z" /></Icon>;
const BellIcon = () => <Icon><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" /></Icon>;
function LogoMark() { return <span className="logo-mark" aria-hidden="true"><img src="/campuscare-logo.png" alt="" /></span>; }
function ConfirmDialog({ title, message, confirmLabel = 'Yes', open, onConfirm, onCancel, danger = false }) {
  if (!open) return null;
  return <div className="dialog-backdrop" role="presentation"><section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><h2 id="confirm-title">{title}</h2><p>{message}</p><div className="confirm-actions"><button type="button" className="button secondary" onClick={onCancel}>No</button><button type="button" className={`button ${danger ? 'danger-button' : 'primary'}`} onClick={onConfirm}>{confirmLabel}</button></div></section></div>;
}
function SelectField({ label, value, options, placeholder, onChange, disabled = false }) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option === value);
  useEffect(() => {
    const close = (event) => { if (!event.target.closest('.custom-select')) setOpen(false); };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);
  const choose = (option) => { onChange(option); setOpen(false); };
  return <div className="custom-select"><span className="custom-select-label">{label}</span><button type="button" className="custom-select-trigger" aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => setOpen(!open)} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); } }}><span className={selected ? '' : 'placeholder'}>{selected || placeholder}</span><span className={`select-chevron${open ? ' open' : ''}`} aria-hidden="true" /></button>{open && <div className="custom-select-menu" role="listbox" aria-label={label}>{options.map((option) => <button type="button" role="option" aria-selected={option === value} className={option === value ? 'selected' : ''} key={option} onClick={() => choose(option)}>{option}</button>)}</div>}</div>;
}
function Notifications() {
  const [open, setOpen] = useState(false); const [items, setItems] = useState([]); const [unread, setUnread] = useState(0); const [confirmClear, setConfirmClear] = useState(false);
  const load = () => api('/notifications').then((data) => { setItems(data.notifications); setUnread(data.unread); }).catch(() => {});
  useEffect(() => { load(); }, []);
  const toggle = async () => { setOpen(!open); if (!open && unread) { await api('/notifications/read', { method: 'PATCH' }).catch(() => {}); setUnread(0); } };
  const clearAll = async () => { await api('/notifications', { method: 'DELETE' }); setItems([]); setUnread(0); setConfirmClear(false); };
  return <><div className="notification-wrap"><button className="notification-button" type="button" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} onClick={toggle}><BellIcon />{unread > 0 && <span className="notification-count">{unread > 9 ? '9+' : unread}</span>}</button>{open && <div className="notification-panel"><div className="notification-head"><strong>Notifications</strong><span><button type="button" onClick={load}>Refresh</button><button type="button" className="notification-clear" onClick={() => setConfirmClear(true)} disabled={!items.length}>Clear all</button></span></div>{items.length ? items.map((item) => <Link className={`notification-item${item.readAt ? '' : ' unread'}`} to={item.link || '#'} key={item._id} onClick={() => setOpen(false)}><strong>{item.title}</strong><span>{item.message}</span><small>{new Date(item.createdAt).toLocaleString()}</small></Link>) : <p className="muted notification-empty">You’re all caught up.</p>}</div>}</div><ConfirmDialog title="Clear notifications?" message="This will remove all notifications from your account." confirmLabel="Yes, clear all" open={confirmClear} onConfirm={clearAll} onCancel={() => setConfirmClear(false)} danger /></>;
}

function Layout({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading, clear } = useAuth();
  const { theme, toggle } = useContext(ThemeContext);
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window !== 'undefined' && window.innerWidth > 700);
  useEffect(() => {
    const closeOnEscape = (event) => { if (event.key === 'Escape') setSidebarOpen(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);
  useEffect(() => {
    document.title = `${pageTitleFor(location.pathname)} | CampusCare`;
    document.documentElement.dataset.theme = theme;
  }, [location.pathname, theme]);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const signOut = async () => { await api('/auth/logout', { method: 'POST' }).catch(() => {}); clear(); navigate('/login'); };
  const publicRoute = publicPaths.includes(location.pathname);
  if (loading && !publicRoute) return <main><section className="panel">Checking your session...</section></main>;
  if (!user || publicRoute) return <><header className="public-header"><Link className="brand" to="/"><LogoMark />CampusCare</Link><nav>{location.pathname !== '/login' && <Link to="/login">Sign in</Link>}<ThemeButton theme={theme} toggle={toggle} /></nav></header><main>{children}</main><PublicFooter /></>;
  const firstSetup = user.role === 'student' && !user.profile?.studentUid;
  if (firstSetup && location.pathname !== '/profile') return <Navigate to="/profile" replace />;
  if (firstSetup) return <div className="first-setup-shell"><header className="public-header"><Link className="brand" to="/profile"><LogoMark />CampusCare</Link><nav><ThemeButton theme={theme} toggle={toggle} /></nav></header><main>{children}</main><PublicFooter /></div>;
  const pageTitle = pageTitleFor(location.pathname);
  const closeMobile = () => { if (window.innerWidth <= 700) setSidebarOpen(false); };
  return <div className={`app-shell${sidebarOpen ? ' sidebar-expanded' : ''}`}>
    {sidebarOpen && <button className="sidebar-backdrop" type="button" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
    <aside className="sidebar">
      <button className="sidebar-toggle" type="button" aria-label={sidebarOpen ? 'Collapse navigation' : 'Open navigation'} aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(!sidebarOpen)}><MenuIcon /></button>
      <Link className="brand sidebar-brand" to="/dashboard" onClick={closeMobile}><LogoMark /><span className="brand-label">CampusCare</span></Link>
      <p className="sidebar-label">{user.role === 'admin' ? 'ADMIN WORKSPACE' : 'STUDENT WORKSPACE'}</p>
      <nav className="sidebar-nav">
        {user.role === 'admin' ? <><Link title="Admin console" className={location.pathname === '/admin' ? 'active' : ''} to="/admin" onClick={closeMobile}><span className="sidebar-icon"><DashboardIcon /></span><b>Admin console</b></Link><Link title="Student accounts" className={location.pathname.startsWith('/admin/users') ? 'active' : ''} to="/admin/users" onClick={closeMobile}><span className="sidebar-icon"><UserIcon /></span><b>Student accounts</b></Link></> : <><Link title="Dashboard" className={location.pathname === '/dashboard' ? 'active' : ''} to="/dashboard" onClick={closeMobile}><span className="sidebar-icon"><DashboardIcon /></span><b>Dashboard</b></Link><Link title="Submit complaint" className={location.pathname === '/complaints/new' ? 'active' : ''} to="/complaints/new" onClick={closeMobile}><span className="sidebar-icon"><PlusIcon /></span><b>Submit complaint</b></Link><Link title="My complaints" className={location.pathname === '/complaints' || location.pathname.startsWith('/complaints/') && location.pathname !== '/complaints/new' ? 'active' : ''} to="/complaints" onClick={closeMobile}><span className="sidebar-icon"><ClipboardIcon /></span><b>My complaints</b></Link><Link title="My profile" className={location.pathname === '/profile' ? 'active' : ''} to="/profile" onClick={closeMobile}><span className="sidebar-icon"><UserIcon /></span><b>My profile</b></Link></>}
      </nav>
      <div className="sidebar-note"><strong>Your voice matters.</strong><p>Every concern is a step toward a better campus.</p></div>
      <button className="sign-out" onClick={() => setConfirmSignOut(true)}><span className="sidebar-icon"><LogoutIcon /></span><b>Sign out</b></button>
    </aside>
    <div className="workspace">
      <header className="workspace-header"><button className="mobile-menu-toggle" type="button" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}><MenuIcon /></button><div className="breadcrumbs"><Link to={user.role === 'admin' ? '/admin' : '/dashboard'}><LogoMark />CampusCare</Link><b>/</b><strong>{pageTitle}</strong></div><div className="header-actions"><Notifications /><ThemeButton theme={theme} toggle={toggle} /><Link className="account" to={user.role === 'admin' ? '/admin' : '/profile'} aria-label="Open your profile"><span className="avatar">{(user.name || user.email || 'S').charAt(0).toUpperCase()}</span><span className="account-copy"><strong>{user.name || 'Student'}</strong><small>{user.role === 'admin' ? 'Administrator' : 'Student account'}</small></span></Link></div></header>
      <main>{children}</main><PublicFooter /><ConfirmDialog title="Sign out?" message="Are you sure you want to sign out of CampusCare?" confirmLabel="Yes, sign out" open={confirmSignOut} onConfirm={signOut} onCancel={() => setConfirmSignOut(false)} />
    </div>
  </div>;
}

function pageTitleFor(pathname) {
  if (pathname === '/complaints/new') return 'Submit complaint';
  if (pathname === '/complaints') return 'My complaints';
  if (pathname === '/profile') return 'My profile';
  if (pathname.startsWith('/complaints/')) return 'Complaint details';
  if (pathname === '/admin') return 'Admin console';
  if (pathname === '/admin/users') return 'Student accounts';
  if (pathname.startsWith('/admin/users/')) return 'Student profile';
  if (pathname === '/privacy') return 'Privacy policy';
  if (pathname === '/terms') return 'Terms and conditions';
  if (pathname === '/login') return 'Sign in';
  if (pathname === '/admin-login') return 'Admin sign in';
  if (pathname === '/auth/callback') return 'Signing in';
  if (pathname === '/') return 'Home';
  if (pathname !== '/dashboard') return 'Page not found';
  return 'Dashboard';
}

function ThemeButton({ theme, toggle }) {
  return <button className="theme-button" type="button" onClick={toggle} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}>{theme === 'light' ? <MoonIcon /> : <SunIcon />}</button>;
}

function BackButton() {
  const navigate = useNavigate();
  return <button className="back-button" type="button" onClick={() => navigate(-1)} aria-label="Go back"><span aria-hidden="true">←</span></button>;
}

function PublicFooter() { return <footer className="site-footer"><Link className="footer-brand" to="/"><LogoMark />CampusCare</Link><span><Link to="/privacy">Privacy Policy</Link><Link to="/terms">Terms & Conditions</Link><Link to="/login">Sign in</Link></span><small>© {new Date().getFullYear()} CampusCare</small></footer>; }

function NotFound() {
  return <section className="panel narrow not-found"><p className="eyebrow">PAGE NOT FOUND</p><h1>We could not find that page.</h1><p className="muted">The link may be outdated or the page may have moved.</p><Link className="button primary" to="/">Return to CampusCare</Link></section>;
}

function LegalPage({ type }) {
  const privacy = type === 'privacy';
  return <section className="panel legal-page"><div className="page-tools"><BackButton /></div><p className="eyebrow">{privacy ? 'PRIVACY' : 'TERMS'}</p><h1>{privacy ? 'Privacy Policy' : 'Terms & Conditions'}</h1><p className="muted">Project policy · Last updated: 25 October 2026</p>{privacy ? <><h2>Information we collect</h2><p>CampusCare may collect your email address, name, student UID, guardian name, course, semester, section, mobile number, complaint details, attachments, replies, status history, and security logs needed to operate the support service.</p><h2>Why we use it</h2><p>We use this information to authenticate students, receive and track complaints, communicate about a complaint, protect the service, and provide authorized administrative reports.</p><h2>Who can access it</h2><p>Your complaint and profile are available to you and authorized CampusCare administrators. Internal notes are not shown to students. Attachments and exports are protected by server-side authorization.</p><h2>Third-party services</h2><p>The current project may use MongoDB Atlas for database hosting, Google OAuth for optional sign-in, and an SMTP provider for email OTP delivery. The owner must review the selected providers, locations, contracts, and their privacy terms before deployment.</p><h2>Account deletion</h2><p>You may request account deletion from your profile. The account is signed out immediately and remains unavailable while an administrator reviews the request. Once approved, the account is deleted and the same email may be used to create a new account. Complaint records may remain for integrity and review.</p></> : <><h2>Acceptable use</h2><p>Use CampusCare only for genuine college-related concerns. Do not submit unlawful, abusive, knowingly false, malicious, or unsafe content, and do not attempt to access another person’s account, complaint, attachment, or export.</p><h2>Complaint rules</h2><p>Provide accurate details and avoid unnecessary sensitive information. Attachments must be relevant PDF or JPEG files within the stated size limit. The support team may request clarification or update a complaint status.</p><h2>Account responsibilities</h2><p>Keep access codes and account access private. You are responsible for activity performed through your authenticated account. Report suspected unauthorized access promptly.</p><h2>Limitations</h2><p>CampusCare is a project portal, not an emergency service, legal service, or guarantee of a particular institutional outcome. Availability, response times, and retention depend on the institution’s operating decisions.</p></>}</section>;
}

function Login() {
  const navigate = useNavigate(); const location = useLocation(); const { refresh } = useAuth(); const [email, setEmail] = useState(''); const [code, setCode] = useState(''); const [sent, setSent] = useState(false); const [submitting, setSubmitting] = useState(false); const [error, setError] = useState(new URLSearchParams(location.search).get('error') === 'google' ? 'Google sign-in could not be completed. Please try again.' : new URLSearchParams(location.search).get('deleted') === 'pending' ? 'Deletion request submitted. Sign-in is unavailable while an administrator reviews it.' : '');
  const submit = async (event) => { event.preventDefault(); if (submitting) return; setSubmitting(true); setError(''); try { const data = sent ? await api('/auth/verify-otp', { method: 'POST', body: JSON.stringify({ email, code }) }) : await api('/auth/request-otp', { method: 'POST', body: JSON.stringify({ email }) }); if (sent) { const user = await refresh(); navigate(user.role === 'admin' ? '/admin' : user.profile?.studentUid ? '/dashboard' : '/profile'); } else setSent(true); } catch (err) { setError(err.message); } finally { setSubmitting(false); } };
  return <section data-reveal className="auth-card"><p className="eyebrow">COLLEGE SUPPORT PORTAL</p><h1>Make your concern count.</h1><p className="muted">Track academic and campus issues from one calm, transparent dashboard.</p><form onSubmit={submit}><label>Email address<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>{sent && <label>One-time code<input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} required /></label>}<button className="primary" disabled={submitting}>{submitting ? 'Please wait...' : sent ? 'Verify and continue' : 'Send email OTP'}</button></form>{!sent && <a className="google" href={`${API}/auth/google`} onClick={() => localStorage.removeItem('user')}>Continue with Google</a>}{!sent && <Link className="admin-login" to="/admin-login">Admin sign in</Link>}<p className="privacy-notice">We use your email to sign you in and protect your complaints.</p>{error && <p className="error">{error}</p>}</section>;
}

function AdminLogin() {
  const navigate = useNavigate(); const { refresh } = useAuth(); const [form, setForm] = useState({ email: '', password: '' }); const [error, setError] = useState('');
  const submit = async (event) => { event.preventDefault(); try { await api('/auth/admin', { method: 'POST', body: JSON.stringify(form) }); const user = await refresh(); navigate(user.role === 'admin' ? '/admin' : '/login'); } catch (err) { setError(err.message); } };
  return <section className="auth-card"><p className="eyebrow">STAFF ACCESS</p><h1>Admin sign in.</h1><p className="muted">Use the administrator credentials configured by the deployment owner.</p><form onSubmit={submit}><label>Email address<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label><label>Password<input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></label>{error && <p className="error">{error}</p>}<button className="primary">Sign in securely</button></form></section>;
}

function Profile() {
  const navigate = useNavigate(); const { clear, refresh } = useAuth(); const current = getUser(); const profile = current.profile || {}; const [form, setForm] = useState({ name: current.name || '', studentUid: profile.studentUid || '', fatherGuardianName: profile.fatherGuardianName || '', course: profile.course || '', semester: profile.semester || '', section: profile.section || '', mobileNumber: profile.mobileNumber || '' }); const [error, setError] = useState(''); const [deletionError, setDeletionError] = useState(''); const [deleting, setDeleting] = useState(false); const [confirmDeletion, setConfirmDeletion] = useState(false);
  const submit = async (event) => { event.preventDefault(); if (!/^[6-9]\d{9}$/.test(form.mobileNumber)) { setError('Enter a valid 10-digit Indian mobile number'); return; } setError(''); try { await api('/profile', { method: 'PUT', body: JSON.stringify(form) }); const updatedUser = await refresh(); navigate(updatedUser.role === 'admin' ? '/admin' : '/dashboard', { replace: true }); } catch (err) { setError(err.message); } };
  const editing = Boolean(profile.studentUid);
  const requestDeletion = async () => { if (deleting) return; setConfirmDeletion(false); setDeletionError(''); setDeleting(true); try { await api('/account/deletion', { method: 'POST' }); clear(); navigate('/login?deleted=pending', { replace: true }); } catch (err) { setDeleting(false); setDeletionError(err.message); } };
  return <><section className="profile-stack"><section className="panel narrow"><p className="eyebrow">{editing ? 'MY PROFILE' : 'FIRST LOGIN SETUP'}</p><h1>{editing ? 'Update your student profile.' : 'Complete your student profile.'}</h1><p className="privacy-notice">Only information needed to operate CampusCare is requested. See the <Link to="/privacy">Privacy Policy</Link>.</p><p className="contact-links">Account email: <a href={`mailto:${encodeURIComponent(current.email || '')}`}>{current.email}</a>{profile.mobileNumber && <> · Mobile: <a href={`tel:+91${profile.mobileNumber}`}>+91 {profile.mobileNumber}</a></>}</p><form onSubmit={submit}><div className="two-col"><label>Student name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label><label>Student UID<input value={form.studentUid} onChange={(e) => setForm({ ...form, studentUid: e.target.value })} required /></label><label>Father/guardian name<input value={form.fatherGuardianName} onChange={(e) => setForm({ ...form, fatherGuardianName: e.target.value })} required /></label><label>Course<input value={form.course} onChange={(e) => setForm({ ...form, course: e.target.value })} required /></label><label>Semester<input value={form.semester} onChange={(e) => setForm({ ...form, semester: e.target.value })} required /></label><label>Section<input value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value })} /></label><label>Mobile number<div className="phone-input"><span aria-hidden="true">+91</span><input type="tel" inputMode="numeric" pattern="[6-9][0-9]{9}" maxLength="10" value={form.mobileNumber} onChange={(e) => setForm({ ...form, mobileNumber: e.target.value.replace(/\D/g, '').slice(0, 10) })} required /></div>{form.mobileNumber && !/^[6-9]\d{9}$/.test(form.mobileNumber) && <small className="field-warning">Enter all 10 digits of a valid Indian mobile number.</small>}</label></div>{error && <p className="error">{error}</p>}<button className="primary" disabled={!/^[6-9]\d{9}$/.test(form.mobileNumber)}>{editing ? 'Update profile' : 'Save profile'}</button></form></section>{editing && <section className="panel narrow danger-zone"><p className="eyebrow">ACCOUNT CONTROL</p><h2>Delete your account</h2><p className="muted">Your request will be reviewed by an administrator. You will be signed out immediately, and the same email can be used again only after approval and deletion are complete.</p>{deletionError && <p className="error">{deletionError}</p>}<button type="button" className="button danger-button" onClick={() => setConfirmDeletion(true)} disabled={deleting}>{deleting ? 'Submitting deletion request...' : 'Request account deletion'}</button></section>}</section><ConfirmDialog title="Request account deletion?" message="You will be signed out immediately and cannot sign in while an administrator reviews this request." confirmLabel="Yes, request deletion" open={confirmDeletion} onConfirm={requestDeletion} onCancel={() => setConfirmDeletion(false)} danger /></>;
}

function Dashboard() {
  const user = getUser(); const [complaints, setComplaints] = useState([]); const [ticketId, setTicketId] = useState(''); const [error, setError] = useState('');
  const loadComplaints = (query = '') => api(`/complaints${query ? `?search=${encodeURIComponent(query)}` : ''}`).then((data) => setComplaints(data.complaints)).catch((err) => setError(err.message));
  useEffect(() => { loadComplaints(); }, []);
  const search = (event) => { event.preventDefault(); loadComplaints(ticketId.trim()); };
  const active = complaints.filter((item) => !['Resolved', 'Closed'].includes(item.status)).length;
  const resolved = complaints.filter((item) => item.status === 'Resolved').length;
  const closed = complaints.filter((item) => item.status === 'Closed').length;
  return <><section data-reveal className="dashboard-heading"><div><p className="eyebrow">A SPACE THAT LISTENS</p><h1>Hello, {user.name || 'Student'}.</h1><p className="muted">A little clarity. A lot of progress. Here’s your campus support at a glance.</p></div><Link className="primary button" to="/complaints/new">Submit complaint</Link></section><section data-reveal className="welcome-card"><div><p className="eyebrow">WE’RE HERE TO HELP</p><h2>Your concerns deserve<br />to be heard.</h2><p>Share what’s happening. Follow every step toward a resolution.</p><Link to="/complaints/new">Raise a new concern</Link></div><div className="welcome-art" aria-hidden="true"><LogoMark /><span className="welcome-mark">CampusCare</span></div></section><section data-reveal className="dashboard-stats"><div><strong>{complaints.length}</strong><span className="stat-icon blue" aria-hidden="true" /><small>Total complaints</small></div><div><strong>{active}</strong><span className="stat-icon gold" aria-hidden="true" /><small>Pending / active</small></div><div><strong>{resolved}</strong><span className="stat-icon green" aria-hidden="true" /><small>Resolved</small></div><div><strong>{closed}</strong><span className="stat-icon purple" aria-hidden="true" /><small>Closed</small>  </div></section><section data-reveal className="panel recent-panel"><div className="panel-head"><div><h2>Your recent complaints</h2><p className="muted">Latest activity, all in one place.</p></div><Link className="view-all" to="/complaints">View all&nbsp; →</Link></div><form className="tracking-form" onSubmit={search}><input value={ticketId} onChange={(e) => setTicketId(e.target.value)} aria-label="Complaint ID" /><button className="button secondary">Track complaint</button>{ticketId && <button type="button" className="clear-button" onClick={() => { setTicketId(''); loadComplaints(); }}>Clear</button>}</form>{error && <p className="error">{error}</p>}{complaints.length ? <div className="complaint-list">{complaints.map((item) => <Link className="complaint-row" to={`/complaints/${item._id}`} key={item._id}><div><strong>{titleCase(cleanComplaintText(item.title))}</strong><small className="ticket-line">Complaint ID: {item.ticketId}<CopyTicketButton ticketId={item.ticketId} /> · {titleCase(item.category)}</small></div><span className={`status status-${item.status.toLowerCase().replaceAll(' ', '-')}`}>{item.status}</span></Link>)}</div> : <div className="empty dashboard-empty"><h3>Your first step starts here</h3><p>You haven’t submitted a complaint yet.</p><Link className="button secondary" to="/complaints/new">Submit a complaint</Link></div>}</section>{user.role === 'admin' && <Link to="/admin" className="admin-link">Open admin console →</Link>}<p className="privacy-note">Only you and the administrator can access your complaints.</p></>;
}

function Complaints() {
  const [complaints, setComplaints] = useState([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const load = (search = '') => api(`/complaints${search ? `?search=${encodeURIComponent(search)}` : ''}`).then((data) => setComplaints(data.complaints)).catch((err) => setError(err.message));
  useEffect(() => { load(); }, []);
  const submit = (event) => { event.preventDefault(); load(query.trim()); };
  return <section className="complaints-page"><div className="page-tools"><BackButton /></div><div className="section-heading"><div><p className="eyebrow">YOUR RECORD</p><h1>My Complaints</h1><p className="muted">Review every complaint and follow its progress.</p></div><Link className="primary button" to="/complaints/new">Submit complaint</Link></div><section className="panel complaints-list-panel"><form className="tracking-form" onSubmit={submit}><input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search complaints" /><button className="button secondary">Search</button></form>{error && <p className="error">{error}</p>}{complaints.length ? <div className="complaint-list">{complaints.map((item) => <Link className="complaint-row" to={`/complaints/${item._id}`} key={item._id}><div><strong>{titleCase(cleanComplaintText(item.title))}</strong><small className="ticket-line">Complaint ID: {item.ticketId}<CopyTicketButton ticketId={item.ticketId} /> · {titleCase(item.category)}</small></div><span className={`status status-${item.status.toLowerCase().replaceAll(' ', '-')}`}>{item.status}</span></Link>)}</div> : <div className="empty"><h3>No complaints found</h3><p>Submit a complaint to start tracking it here.</p><Link className="button secondary" to="/complaints/new">Submit complaint</Link></div>}</section></section>;
}

function NewComplaint() {
  const navigate = useNavigate(); const currentUser = JSON.parse(localStorage.getItem('user') || '{}'); const profile = currentUser.profile || {}; const [meta, setMeta] = useState({ categories, subcategories: {} }); const [form, setForm] = useState({ category: '', subcategory: '', title: '', description: '' }); const [file, setFile] = useState(null); const [error, setError] = useState(''); const [challenge, setChallenge] = useState(null); const [code, setCode] = useState(''); const [seconds, setSeconds] = useState(0); const [resendSeconds, setResendSeconds] = useState(0); const [success, setSuccess] = useState('');
  useEffect(() => { api('/meta').then(setMeta).catch((err) => setError(err.message)); }, []);
  useEffect(() => { if (!challenge) return undefined; const timer = window.setInterval(() => { setSeconds(Math.max(0, Math.ceil((new Date(challenge.expiresAt) - Date.now()) / 1000))); setResendSeconds(Math.max(0, Math.ceil((new Date(challenge.resendAvailableAt) - Date.now()) / 1000))); }, 1000); return () => window.clearInterval(timer); }, [challenge]);
  const options = meta.subcategories[form.category] || [];
  const changeCategory = (category) => setForm({ ...form, category, subcategory: '' });
  const startVerification = async (event) => { event.preventDefault(); setError(''); const data = new FormData(); Object.entries(form).forEach(([key, value]) => data.append(key, value)); if (file) data.append('attachment', file); try { const result = await api('/complaints/verification', { method: 'POST', body: data }); setChallenge(result); setCode(''); setSeconds(Math.ceil((new Date(result.expiresAt) - Date.now()) / 1000)); setResendSeconds(Math.ceil((new Date(result.resendAvailableAt) - Date.now()) / 1000)); } catch (err) { setError(err.message); } };
  const verify = async (event) => { event.preventDefault(); setError(''); try { const result = await api(`/complaints/verification/${challenge.challengeId}/verify`, { method: 'POST', body: JSON.stringify({ code }) }); setSuccess(`Complaint ${result.complaint.ticketId} submitted successfully.`); window.setTimeout(() => navigate(`/complaints/${result.complaint._id}`), 900); } catch (err) { setError(err.message); } };
  const resend = async () => { if (resendSeconds > 0) return; setError(''); try { const result = await api(`/complaints/verification/${challenge.challengeId}/resend`, { method: 'POST' }); setChallenge({ ...challenge, expiresAt: result.expiresAt, resendAvailableAt: result.resendAvailableAt }); setCode(''); setResendSeconds(Math.ceil((new Date(result.resendAvailableAt) - Date.now()) / 1000)); } catch (err) { setError(err.message); } };
  const maskedEmail = currentUser.email ? currentUser.email.replace(/^(.{2}).*(@.*)$/, '$1••••$2') : 'your registered email';
  return <section data-reveal className="complaint-page"><div className="page-tools complaint-tools"><BackButton /></div><div className="complaint-page-heading"><div><p className="eyebrow">LET’S MAKE THINGS BETTER</p><h1>Submit a complaint</h1><p className="muted">Share a few details so the support desk can help you.</p></div><span className="heading-note">A clear path forward</span></div><div className="complaint-form-card"><div className="student-summary"><span className="avatar">{(currentUser.name || currentUser.email || 'S').charAt(0).toUpperCase()}</span><div><strong>{currentUser.name || 'Student'}</strong><p>{profile.studentUid || 'Student UID'} · {profile.course || 'Course'} · Semester {profile.semester || '—'}</p><small>{currentUser.email}</small></div><Link to="/profile">View profile</Link></div><div className="form-content">{challenge ? <><p className="eyebrow">SECURITY CHECK</p><h2>Verify your complaint</h2><p className="muted">We sent a fresh 6-digit code to <strong>{maskedEmail}</strong>. Code expires in {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}.</p><form onSubmit={verify} className="verification-form"><label>Verification code<input className="otp-input" type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength="6" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} required /></label>{error && <p className="error">{error}</p>}{success && <p className="success-message">{success}</p>}<button className="primary submit-complaint" disabled={Boolean(success) || seconds === 0}>Verify &amp; Submit Complaint</button><div className="verification-actions"><button type="button" className="button secondary" onClick={() => { setChallenge(null); setCode(''); setError(''); }}>Back to complaint</button><button type="button" className="clear-button" onClick={resend} disabled={resendSeconds > 0}>{resendSeconds > 0 ? `Resend in ${resendSeconds}s` : 'Resend OTP'}</button></div></form></> : <><p className="eyebrow">YOUR CONCERN</p><h2>Tell us what’s happening</h2><p className="muted">Required fields help us understand your concern.</p><p className="privacy-notice">Your complaint is visible to you and authorized administrators. Attach only information needed to explain the issue. <Link to="/privacy">Privacy Policy</Link></p><form onSubmit={startVerification}><div className="two-col"><SelectField label="Complaint category" value={form.category} options={meta.categories} placeholder="Select category" onChange={changeCategory} /><SelectField label="Subcategory" value={form.subcategory} options={options} placeholder={form.category ? 'Select subcategory' : 'Select category first'} onChange={(subcategory) => setForm({ ...form, subcategory })} disabled={!form.category} /></div><label>Complaint title<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength="160" required /></label><label>Issue description<textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength="5000" rows="8" required /><span className="field-help">20–5,000 characters · {form.description.length.toLocaleString()}/5,000</span></label>  <label className="attachment-field">Supporting attachment <span className="muted">(optional)</span><small>PDF or JPEG · Maximum 1 MB</small><span className="file-picker"><input id="complaint-attachment" type="file" accept=".pdf,.jpg,.jpeg,application/pdf,image/jpeg" onChange={(e) => setFile(e.target.files[0] || null)} /><span className="file-picker-button">Choose file</span><span className="file-name">{file?.name || 'No file chosen'}</span></span></label>{error && <p className="error">{error}</p>}<button className="primary submit-complaint">Verify &amp; Submit Complaint</button></form></>}</div></div></section>;
}

function Detail() {
  const { id } = useParams(); const currentUser = JSON.parse(localStorage.getItem('user') || '{}'); const [item, setItem] = useState(null); const [message, setMessage] = useState(''); const [nextStatus, setNextStatus] = useState(''); const [internal, setInternal] = useState(false); const [error, setError] = useState('');
  const load = () => api(`/complaints/${id}`).then((data) => setItem(data.complaint)).catch((err) => setError(err.message)); useEffect(load, [id]);
  const reply = async (event) => { event.preventDefault(); try { await api(`/complaints/${id}/messages`, { method: 'POST', body: JSON.stringify({ body: message, internal }) }); setMessage(''); setInternal(false); load(); } catch (err) { setError(err.message); } };
  const updateStatus = async () => { try { await api(`/complaints/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) }); setNextStatus(''); load(); } catch (err) { setError(err.message); } };
  if (!item) return <section className="panel">{error ? <p className="error">{error}</p> : 'Loading...'}</section>;
  return <section className="panel"><p className="eyebrow ticket-detail">COMPLAINT ID: <strong>{item.ticketId}</strong><CopyTicketButton ticketId={item.ticketId} /></p><h1>{titleCase(cleanComplaintText(item.title))}</h1><div className="detail-actions"><span className={`status status-${item.status.toLowerCase().replaceAll(' ', '-')}`}>{item.status}</span></div>{currentUser.role === 'admin' && <div className="admin-controls"><select value={nextStatus} onChange={(e) => setNextStatus(e.target.value)}><option value="">Update status...</option>{['Submitted', 'Under Review', 'In Progress', 'Waiting for Student', 'Resolved', 'Closed'].map((status) => <option key={status} value={status}>{status}</option>)}</select><button className="button primary" onClick={updateStatus} disabled={!nextStatus}>Save status</button></div>}<p className="description">{cleanComplaintText(item.description)}</p><h2>Status timeline</h2><div className="timeline">{item.history.map((entry, index) => <div className="timeline-item" key={`${entry.createdAt}-${index}`}><strong>{entry.status}</strong><small>{new Date(entry.createdAt).toLocaleString()}</small>{entry.note && <p>{cleanComplaintText(entry.note)}</p>}</div>)}</div>{item.messages.length > 0 && <><h2>Conversation</h2>{item.messages.map((entry, index) => <div className="message" key={index}><strong>{entry.author?.name || entry.author?.email || 'Support team'}</strong><p>{cleanComplaintText(entry.body)}</p></div>)}</>}<form onSubmit={reply} className="reply"><label>{currentUser.role === 'admin' ? 'Response or internal note' : 'Reply to support'}<textarea value={message} onChange={(e) => setMessage(e.target.value)} rows="4" required /></label>{currentUser.role === 'admin' && <label className="checkbox"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Private internal note</label>}<button className="primary">{currentUser.role === 'admin' ? 'Send admin message' : 'Send reply'}</button></form></section>;
}

function Admin() {
  const [items, setItems] = useState([]); const [counts, setCounts] = useState({}); const [requests, setRequests] = useState([]); const [error, setError] = useState('');
  useEffect(() => { Promise.all([api('/complaints'), api('/admin/summary'), api('/admin/data-requests')]).then(([a, b, c]) => { setItems(a.complaints); setCounts(b.counts); setRequests(c.requests); }).catch((err) => setError(err.message)); }, []);
  const exportFile = async (type) => { try { const response = await fetch(`${API}/admin/export.${type}`, { credentials: 'include' }); if (!response.ok) throw new Error('Export failed'); const blob = await response.blob(); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `complaints.${type}`; link.click(); URL.revokeObjectURL(link.href); } catch (err) { setError(err.message); } };
  const reviewRequest = async (id, status) => { try { await api(`/admin/data-requests/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); setRequests(requests.map((request) => request._id === id ? { ...request, status } : request)); } catch (err) { setError(err.message); } };
  return <><section className="hero"><div><p className="eyebrow">ADMIN CONSOLE</p><h1>Keep every case moving.</h1><p className="muted">Review complaints, respond visibly, and maintain a clear audit trail.</p></div><div className="export-actions"><button className="button primary" onClick={() => exportFile('csv')}>Export CSV</button><button className="button secondary" onClick={() => exportFile('xlsx')}>Export Excel</button></div></section><div className="stats">{Object.entries(counts).map(([key, value]) => <div className="stat" key={key}><small>{key}</small><strong>{value}</strong></div>)}</div><section className="panel admin-complaints"><h2>Complaints</h2>{error && <p className="error">{error}</p>}{items.map((item) => <Link className="complaint-row" to={`/complaints/${item._id}`} key={item._id}><div><strong>{titleCase(item.title)}</strong><small>{item.ticketId} · {item.student?.name || item.student?.email || 'Deleted account'}</small></div><span className={`status status-${item.status.toLowerCase().replaceAll(' ', '-')}`}>{item.status}</span></Link>)}</section>{requests.length > 0 && <section className="panel admin-requests"><div className="panel-head"><div><p className="eyebrow">ACCOUNT DELETIONS</p><h2>Deletion requests</h2></div></div>{requests.map((request) => <div className="request-row" key={request._id}><div><strong>{request.email}</strong><small>Requested {new Date(request.createdAt).toLocaleString()}</small></div><span className="status">{titleCase(request.status)}</span>{request.status === 'pending' && <div className="detail-actions"><button className="button secondary" onClick={() => reviewRequest(request._id, 'rejected')}>Reject</button><button className="button primary" onClick={() => reviewRequest(request._id, 'approved')}>Approve</button></div>}</div>)}</section>}</>;
}

function AdminUsers() {
  const [users, setUsers] = useState([]); const [error, setError] = useState('');
  useEffect(() => { api('/admin/users').then((data) => setUsers(data.users)).catch((err) => setError(err.message)); }, []);
  return <section className="admin-page"><div className="page-tools"><BackButton /></div><div className="section-heading"><div><p className="eyebrow">ADMINISTRATION</p><h1>Student accounts</h1><p className="muted">Review profiles, complaint history, and account deletion status.</p></div></div><section className="panel">{error && <p className="error">{error}</p>}{users.length ? users.map((user) => <Link className="user-row" to={`/admin/users/${user._id}`} key={user._id}><span className="avatar">{(user.name || user.email).charAt(0).toUpperCase()}</span><div><strong>{user.name || 'Unnamed student'}</strong><small>{user.email} · {user.profile?.studentUid || 'Profile incomplete'}</small></div><span className="status">{user.profile?.studentUid ? 'Profile complete' : 'Needs setup'}</span></Link>) : <div className="empty"><h3>No student accounts found</h3></div>}</section></section>;
}

function AdminUserDetail() {
  const { id } = useParams(); const [data, setData] = useState(null); const [error, setError] = useState('');
  useEffect(() => { api(`/admin/users/${id}`).then(setData).catch((err) => setError(err.message)); }, [id]);
  if (error) return <section className="panel"><p className="error">{error}</p></section>;
  if (!data) return <section className="panel">Loading student profile...</section>;
  const { user, complaints, deletion } = data;
  return <section className="admin-page"><div className="page-tools"><BackButton /></div><div className="section-heading"><div><p className="eyebrow">STUDENT PROFILE</p><h1>{user.name || 'Unnamed student'}</h1><p className="muted">{user.email}</p></div>{deletion && <span className={`status status-${deletion.status}`}>Deletion {titleCase(deletion.status)}</span>}</div><section className="panel profile-overview"><div><strong>Email</strong><span>{user.email}</span></div><div><strong>Student UID</strong><span>{user.profile?.studentUid || 'Not provided'}</span></div><div><strong>Father/guardian</strong><span>{user.profile?.fatherGuardianName || 'Not provided'}</span></div><div><strong>Course</strong><span>{user.profile?.course || 'Not provided'}</span></div><div><strong>Semester</strong><span>{user.profile?.semester || 'Not provided'}</span></div><div><strong>Section</strong><span>{user.profile?.section || 'Not provided'}</span></div><div><strong>Mobile</strong><span>{user.profile?.mobileNumber || 'Not provided'}</span></div></section><section className="panel admin-complaints"><h2>Complaint history</h2>{complaints.length ? complaints.map((item) => <Link className="complaint-row" to={`/complaints/${item._id}`} key={item._id}><div><strong>{titleCase(item.title)}</strong><small>{item.ticketId} · {new Date(item.createdAt).toLocaleDateString()}</small></div><span className="status">{item.status}</span></Link>) : <p className="muted">No complaints submitted.</p>}</section></section>;
}

function OAuthCallback() { const navigate = useNavigate(); const { refresh, clear } = useAuth(); useEffect(() => { refresh().then((user) => navigate(user.role === 'admin' ? '/admin' : user.profile?.studentUid ? '/dashboard' : '/profile', { replace: true })).catch(() => { clear(); navigate('/login?error=google', { replace: true }); }); }, [navigate]); return <section className="panel">Signing you in securely...</section>; }
function Protected({ children, role }) { const { user, loading } = useAuth(); if (loading) return <section className="panel">Checking your session...</section>; if (!user) return <Navigate to="/login" replace />; return role && user.role !== role ? <Navigate to={user.role === 'admin' ? '/admin' : '/dashboard'} replace /> : children; }
function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');
  const toggle = () => setTheme((current) => {
    const next = current === 'light' ? 'dark' : 'light';
    localStorage.setItem('theme', next);
    return next;
  });
  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}
function App() { return <ThemeProvider><AuthProvider><Layout><Routes><Route path="/" element={<Navigate to="/dashboard" />} /><Route path="/login" element={<Login />} /><Route path="/privacy" element={<LegalPage type="privacy" />} /><Route path="/terms" element={<LegalPage type="terms" />} /><Route path="/auth/callback" element={<OAuthCallback />} /><Route path="/admin-login" element={<AdminLogin />} /><Route path="/dashboard" element={<Protected role="student"><Dashboard /></Protected>} /><Route path="/complaints" element={<Protected role="student"><Complaints /></Protected>} /><Route path="/profile" element={<Protected role="student"><Profile /></Protected>} /><Route path="/complaints/new" element={<Protected role="student"><NewComplaint /></Protected>} /><Route path="/complaints/:id" element={<Protected><Detail /></Protected>} /><Route path="/admin" element={<Protected role="admin"><Admin /></Protected>} /><Route path="/admin/users" element={<Protected role="admin"><AdminUsers /></Protected>} /><Route path="/admin/users/:id" element={<Protected role="admin"><AdminUserDetail /></Protected>} /><Route path="*" element={<NotFound />} /></Routes></Layout></AuthProvider></ThemeProvider>; }
createRoot(document.getElementById('root')).render(<BrowserRouter><App /></BrowserRouter>);
