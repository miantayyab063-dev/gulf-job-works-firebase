import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { DashboardLayout, ProtectedRoute, PublicLayout } from './components';
import { AdminJobsPage, CMSPage, EmployerJobFormPage, JobAlertsPage, SavedJobsPage, TeamRegistrationPage } from './extended-pages';
import { AuthProvider } from './lib/auth';
import {
  AICareerPage, AdminDashboardPage, AuthPage, BankAccountsPage, CVBuilderPage,
  DashboardHome, EmployerPage, ForgotPasswordPage, HomePage, JobDetailPage,
  JobsPage, LegalPage, MyAccessPage, MyPaymentsPage, NotFoundPage, NotificationsPage,
  OnboardingPage, PaymentPage, PaymentQueuePage, PaymentReviewPage, StaticMessagePage,
  SupportPage, VerifyEmailPage, financeRoles
} from './pages';
import './styles.css';

const staffRoles = ['SUPER_ADMIN','ADMIN','TEAM_MANAGER','JOB_VERIFICATION_OFFICER','EMPLOYER_VERIFICATION_OFFICER','RECRUITMENT_OFFICER','CUSTOMER_SUPPORT','FINANCE_OFFICER','CONTENT_MANAGER'] as const;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route index element={<HomePage />} />
            <Route path="jobs" element={<JobsPage />} />
            <Route path="jobs/:id" element={<JobDetailPage />} />
            <Route path="ai-career" element={<AICareerPage />} />
            <Route path="cv-builder" element={<CVBuilderPage />} />
            <Route path="support" element={<SupportPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="legal/:slug" element={<LegalPage />} />
          </Route>
          <Route path="auth" element={<AuthPage />} />
          <Route path="verify-email" element={<VerifyEmailPage />} />
          <Route path="forgot-password" element={<ForgotPasswordPage />} />
          <Route path="onboarding" element={<OnboardingPage />} />
          <Route path="account-suspended" element={<StaticMessagePage title="Account suspended" text="This account is currently suspended. Contact Gulf Job Works support for review." />} />
          <Route path="unauthorized" element={<StaticMessagePage title="Access denied" text="Your account role does not have permission to open this page." />} />

          <Route element={<ProtectedRoute />}>
            <Route path="jobs/:id/payment" element={<PaymentPage />} />
            <Route element={<DashboardLayout />}>
              <Route path="app" element={<DashboardHome />} />
              <Route path="app/payments" element={<MyPaymentsPage />} />
              <Route path="app/access" element={<MyAccessPage />} />
              <Route path="app/saved" element={<SavedJobsPage />} />
              <Route path="app/alerts" element={<JobAlertsPage />} />
              <Route path="team/register" element={<TeamRegistrationPage />} />
            </Route>
          </Route>

          <Route element={<ProtectedRoute roles={['EMPLOYER']} />}>
            <Route element={<DashboardLayout />}>
              <Route path="employer" element={<EmployerPage />} />
              <Route path="employer/jobs/new" element={<EmployerJobFormPage />} />
            </Route>
          </Route>

          <Route element={<ProtectedRoute roles={[...staffRoles]} />}>
            <Route element={<DashboardLayout />}>
              <Route path="admin" element={<AdminDashboardPage />} />
              <Route path="admin/jobs" element={<AdminJobsPage />} />
              <Route path="admin/cms" element={<CMSPage />} />
            </Route>
          </Route>
          <Route element={<ProtectedRoute roles={financeRoles} />}>
            <Route element={<DashboardLayout />}>
              <Route path="admin/payments" element={<PaymentQueuePage />} />
              <Route path="admin/payments/:paymentId" element={<PaymentReviewPage />} />
            </Route>
          </Route>
          <Route element={<ProtectedRoute roles={['SUPER_ADMIN','ADMIN']} />}>
            <Route element={<DashboardLayout />}>
              <Route path="admin/banks" element={<BankAccountsPage />} />
            </Route>
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
