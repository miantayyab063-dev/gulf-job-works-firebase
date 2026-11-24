import { Bell, BriefcaseBusiness, ChevronDown, CircleUserRound, CreditCard, FileText, LayoutDashboard, LogOut, Menu, Search, ShieldCheck, Sparkles, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import type { PaymentStatus, Role } from './types';

export function BrandLogo({ compact = false }: { compact?: boolean }) {
  return <Link to="/" className={`brand-crop ${compact ? 'compact' : ''}`} aria-label="Gulf Job Works home"><img src="/brand-source.png" alt="Gulf Job Works — Your Talent. Global Opportunities." /></Link>;
}

export function StatusBadge({ status }: { status: string }) {
  const kind = /APPROVED|PUBLISHED|VERIFIED|UNLOCKED|ACTIVE|RESOLVED/.test(status) ? 'success' : /REJECTED|SUSPENDED|CANCELLED|EXPIRED/.test(status) ? 'danger' : /PENDING|REVIEW|RESUBMISSION|REQUEST/.test(status) ? 'warning' : 'neutral';
  return <span className={`status ${kind}`}>{status.replaceAll('_', ' ')}</span>;
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <div className="loading" role="status"><span className="spinner" />{label}…</div>;
}

export function EmptyState({ icon = <Search />, title, text, action }: { icon?: ReactNode; title: string; text: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{text}</p>{action}</div>;
}

export function Alert({ type = 'info', children }: { type?: 'info' | 'success' | 'warning' | 'error'; children: ReactNode }) {
  return <div className={`alert ${type}`}>{children}</div>;
}

function TopNav() {
  const { user, profile, logout } = useAuth();
  const [open, setOpen] = useState(false);
  return <header className="topbar">
    <div className="container nav-inner">
      <BrandLogo />
      <button className="icon-button mobile-menu" onClick={() => setOpen(!open)} aria-label="Toggle menu">{open ? <X /> : <Menu />}</button>
      <nav className={open ? 'public-nav open' : 'public-nav'}>
        <NavLink to="/jobs">Find Jobs</NavLink>
        <NavLink to="/ai-career">AI Career Tools</NavLink>
        <NavLink to="/cv-builder">CV Builder</NavLink>
        <NavLink to="/support">Support</NavLink>
      </nav>
      <div className="nav-actions">
        {user ? <>
          <Link className="icon-button" to="/notifications" aria-label="Notifications"><Bell /></Link>
          <Link className="profile-link" to="/app"><CircleUserRound /><span>{profile?.fullName || user.email}</span><ChevronDown size={15} /></Link>
          <button className="icon-button" onClick={logout} aria-label="Log out"><LogOut /></button>
        </> : <><Link className="button ghost" to="/auth">Log in</Link><Link className="button primary" to="/auth?mode=register">Create account</Link></>}
      </div>
    </div>
  </header>;
}

export function PublicLayout() { return <><TopNav /><main><Outlet /></main><footer><div className="container footer-grid"><BrandLogo compact /><div><strong>Gulf Job Works</strong><p>Verified Gulf employment opportunities and professional career support.</p></div><div><Link to="/legal/terms">Terms</Link><Link to="/legal/privacy">Privacy</Link><Link to="/legal/refund">Refund Policy</Link><Link to="/legal/disclaimer">Disclaimer</Link></div></div><div className="container copyright">© {new Date().getFullYear()} Gulf Job Works. Paying an access fee does not guarantee employment or visa issuance.</div></footer></> }

const allStaff: Role[] = ['SUPER_ADMIN','ADMIN','TEAM_MANAGER','JOB_VERIFICATION_OFFICER','EMPLOYER_VERIFICATION_OFFICER','RECRUITMENT_OFFICER','CUSTOMER_SUPPORT','FINANCE_OFFICER','CONTENT_MANAGER'];

const links = [
  { to: '/app', label: 'Overview', icon: LayoutDashboard, roles: [] as Role[] },
  { to: '/app/payments', label: 'My Payments', icon: CreditCard, roles: ['JOB_SEEKER'] as Role[] },
  { to: '/app/access', label: 'My Job Access', icon: ShieldCheck, roles: ['JOB_SEEKER'] as Role[] },
  { to: '/app/saved', label: 'Saved Jobs', icon: BriefcaseBusiness, roles: ['JOB_SEEKER'] as Role[] },
  { to: '/employer', label: 'Employer Portal', icon: BriefcaseBusiness, roles: ['EMPLOYER'] as Role[] },
  { to: '/admin', label: 'Administration', icon: LayoutDashboard, roles: allStaff },
  { to: '/admin/jobs', label: 'Job Verification', icon: ShieldCheck, roles: ['SUPER_ADMIN','ADMIN','TEAM_MANAGER','JOB_VERIFICATION_OFFICER'] as Role[] },
  { to: '/admin/payments', label: 'Payment Verification', icon: CreditCard, roles: ['SUPER_ADMIN','ADMIN','FINANCE_OFFICER'] as Role[] },
  { to: '/admin/banks', label: 'Bank Accounts', icon: FileText, roles: ['SUPER_ADMIN','ADMIN'] as Role[] },
  { to: '/admin/cms', label: 'CMS & Legal', icon: FileText, roles: ['SUPER_ADMIN','ADMIN','CONTENT_MANAGER'] as Role[] },
  { to: '/ai-career', label: 'AI Career Assistant', icon: Sparkles, roles: [] as Role[] },
];

export function DashboardLayout() {
  const { profile, roles, logout } = useAuth();
  const visible = links.filter((item) => !item.roles.length || item.roles.some((r) => roles.includes(r)));
  return <div className="dashboard-shell"><aside className="sidebar"><BrandLogo /><div className="sidebar-user"><CircleUserRound /><div><strong>{profile?.fullName}</strong><small>{roles[0]?.replaceAll('_', ' ')}</small></div></div><nav>{visible.map(({ to, label, icon: Icon }) => <NavLink end={to === '/app'} key={to} to={to}><Icon />{label}</NavLink>)}</nav><button className="sidebar-logout" onClick={logout}><LogOut />Log out</button></aside><div className="dashboard-main"><div className="mobile-dashboard-bar"><BrandLogo compact /><Link to="/app">Dashboard</Link></div><Outlet /></div></div>;
}

export function ProtectedRoute({ roles }: { roles?: Role[] }) {
  const { user, profile, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner label="Checking access" />;
  if (!user) return <Navigate to={`/auth?returnTo=${encodeURIComponent(location.pathname)}`} replace />;
  if (!user.emailVerified && user.providerData.some((p) => p.providerId === 'password')) return <Navigate to="/verify-email" replace />;
  if (!profile) return <Navigate to="/onboarding" replace />;
  if (profile.status === 'SUSPENDED') return <Navigate to="/account-suspended" replace />;
  if (roles?.length && !roles.some((r) => profile.roles.includes(r))) return <Navigate to="/unauthorized" replace />;
  return <Outlet />;
}

export const paymentStatusHelp: Record<PaymentStatus, string> = {
  PENDING_VERIFICATION: 'Your proof is waiting for finance review.',
  UNDER_REVIEW: 'A reviewer is checking your payment.',
  APPROVED: 'Payment verified and job access unlocked.',
  REJECTED: 'Payment was rejected. Open the record to see the reason.',
  RESUBMISSION_REQUIRED: 'Correct the requested issue and submit again.',
  CANCELLED: 'This payment request was cancelled.',
};
