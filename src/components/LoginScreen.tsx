import React, { useState } from 'react';
import {
  ShieldCheck,
  Users,
  Lock,
  Eye,
  EyeOff,
  Sun,
  Moon,
  AlertCircle,
  KeyRound,
  Cloud,
  Crown,
  CheckCircle2,
} from 'lucide-react';
import { apiRequest, setAuthToken } from '../lib/api';
import { signInWithGoogle, triggerFirebasePasswordResetEmail } from '../firebase';
import { ensureFirebaseUserProfile } from '../lib/firestoreSync';
import type { AuthUser, Language } from '../types';
import { APP_MAIN_NAME, COMMITTEE_TITLE, COMMITTEE_ADDRESS, COMMITTEE_LOGO_URL, t } from '../i18n/translations';
import { PWAInstallButton } from './PWAInstallButton';

interface LoginScreenProps {
  lang: Language;
  setLang: (l: Language) => void;
  dark: boolean;
  setDark: (d: boolean) => void;
  isDemoDataActive: boolean;
  appMainName?: string;
  committeeName?: string;
  committeeAddress?: string;
  appLogoUrl?: string;
  ownerCredentialsClaimed?: boolean;
  onLoginSuccess: (user: AuthUser) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  lang,
  setLang,
  dark,
  setDark,
  isDemoDataActive,
  appMainName,
  committeeName,
  committeeAddress,
  appLogoUrl,
  ownerCredentialsClaimed,
  onLoginSuccess,
}) => {
  const [loginType, setLoginType] = useState<'owner' | 'admin' | 'member'>('admin');
  const [username, setUsername] = useState('ADMIN-01');
  const [password, setPassword] = useState('Admin@123');
  const [otpCode, setOtpCode] = useState('');
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');
  const [infoMsg, setInfoMsg] = useState('');
  const [logoError, setLogoError] = useState(false);

  // Owner First-Time Setup / Firebase-Verified Password Reset panel
  const [showOwnerSetup, setShowOwnerSetup] = useState(false);
  const [setupUsername, setSetupUsername] = useState('izharahmad46@gmail.com');
  const [setupFullName, setSetupFullName] = useState('');
  const [setupPassword, setSetupPassword] = useState('');
  const [setupConfirmPassword, setSetupConfirmPassword] = useState('');
  const [setupPin, setSetupPin] = useState('');

  // Forgot Password (Firebase Auth Email Reset) for Admin & Member
  const [showForgotEmail, setShowForgotEmail] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [sendingReset, setSendingReset] = useState(false);

  const effectiveAppMainName = appMainName || APP_MAIN_NAME;
  const effectiveCommitteeTitle = committeeName || COMMITTEE_TITLE;
  const effectiveCommitteeAddress = committeeAddress || COMMITTEE_ADDRESS;
  const effectiveLogoUrl = appLogoUrl || COMMITTEE_LOGO_URL;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setInfoMsg('');
    setLoading(true);
    try {
      const res = await apiRequest<{
        token?: string;
        user?: AuthUser;
        requiresTwoFactor?: boolean;
        message?: string;
      }>('/api/auth/login', {
        method: 'POST',
        skipAuth: true,
        body: { username, password, loginType, otpCode: requiresTwoFactor ? otpCode : undefined },
      });

      if (res.requiresTwoFactor) {
        setRequiresTwoFactor(true);
        setLoading(false);
        return;
      }

      if (res.token && res.user) {
        setAuthToken(res.token);
        onLoginSuccess(res.user);
      }
    } catch (err: any) {
      setError(err?.message || 'Sign in failed.');
    } finally {
      setLoading(false);
    }
  }

  function applyDemoAccount(type: 'admin' | 'member', user: string, pass: string) {
    setLoginType(type);
    setUsername(user);
    setPassword(pass);
    setRequiresTwoFactor(false);
    setShowOwnerSetup(false);
    setOtpCode('');
    setError('');
    setInfoMsg('');
  }

  async function handleGoogleSignIn() {
    setError('');
    setInfoMsg('');
    setGoogleLoading(true);
    try {
      const fbUser = await signInWithGoogle();
      await ensureFirebaseUserProfile(fbUser);
      const idToken = await fbUser.getIdToken();
      const res = await apiRequest<{ token?: string; user?: AuthUser }>('/api/auth/firebase-login', {
        method: 'POST',
        skipAuth: true,
        body: { idToken },
      });
      if (res.token && res.user) {
        setAuthToken(res.token);
        onLoginSuccess(res.user);
      }
    } catch (err: any) {
      const msg = err?.message || 'Google sign-in failed.';
      if (!msg.toLowerCase().includes('popup-closed-by-user')) {
        setError(msg);
      }
    } finally {
      setGoogleLoading(false);
    }
  }

  async function handleOwnerClaimOrReset(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setInfoMsg('');
    if (setupPassword.length < 8) {
      setError('Owner password must be at least 8 characters.');
      return;
    }
    if (setupPassword !== setupConfirmPassword) {
      setError('Password and Confirm Password do not match.');
      return;
    }
    setGoogleLoading(true);
    try {
      const fbUser = await signInWithGoogle();
      await ensureFirebaseUserProfile(fbUser);
      const idToken = await fbUser.getIdToken(true);
      const res = await apiRequest<{ ok: boolean; token: string; user: AuthUser }>('/api/owner/claim-or-reset-password', {
        method: 'POST',
        skipAuth: true,
        body: {
          idToken,
          username: setupUsername.trim(),
          fullName: setupFullName.trim() || undefined,
          newPassword: setupPassword,
          verificationPin: setupPin.trim() || undefined,
        },
      });
      if (res.token && res.user) {
        setAuthToken(res.token);
        onLoginSuccess(res.user);
      }
    } catch (err: any) {
      const msg = err?.message || 'Owner verification failed.';
      if (!msg.toLowerCase().includes('popup-closed-by-user')) {
        setError(msg);
      }
    } finally {
      setGoogleLoading(false);
    }
  }

  async function handleForgotPasswordEmail(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setInfoMsg('');
    setSendingReset(true);
    try {
      const res = await triggerFirebasePasswordResetEmail(forgotEmail);
      setInfoMsg(
        `A secure Firebase password reset link has been sent to ${res.email}. Please check your inbox/spam folder. If your account uses a local Committee ID password, contact the App Owner or Committee Admin to reset it.`
      );
      setShowForgotEmail(false);
      setForgotEmail('');
    } catch (err: any) {
      setError(err?.message || 'Unable to send password reset email.');
    } finally {
      setSendingReset(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F6F8F7] dark:bg-[#0B120F] flex flex-col">
      {/* Top utility bar */}
      <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-200/70 dark:bg-slate-800/80">
          {(['en', 'hi', 'ur'] as Language[]).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap min-h-[36px] ${
                lang === l
                  ? 'bg-[#0B4F32] text-white'
                  : 'text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white'
              }`}
            >
              {l === 'en' ? 'English' : l === 'hi' ? 'हिन्दी' : 'اردو'}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <PWAInstallButton lang={lang} variant="login" />
          <button
            type="button"
            onClick={() => setDark(!dark)}
            aria-label="Toggle color theme"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#121D18] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            {dark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Main split container */}
      <div className="flex-1 flex items-center justify-center px-4 sm:px-6 pb-10">
        <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#121D18] shadow-sm">
          {/* Left Institutional Identity Panel */}
          <div className="lg:col-span-6 bg-[#0B4F32] text-white p-8 sm:p-10 flex flex-col justify-between relative overflow-hidden">
            {/* Subtle geometric Islamic arch motif */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-24 -top-24 w-72 h-72 rounded-full border border-white/10"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -left-20 -bottom-24 w-64 h-64 rounded-full border border-amber-300/15"
            />

            <div className="relative z-10">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-white p-1.5 shadow-md flex items-center justify-center shrink-0">
                  {!logoError ? (
                    <img
                      src={effectiveLogoUrl}
                      alt={effectiveCommitteeTitle}
                      referrerPolicy="no-referrer"
                      onError={() => setLogoError(true)}
                      className="w-full h-full object-contain rounded-full"
                    />
                  ) : (
                    <ShieldCheck className="w-12 h-12 text-[#0B4F32]" />
                  )}
                </div>
                <div>
                  <div className="text-xs font-bold uppercase tracking-widest text-amber-200">
                    {effectiveAppMainName}
                  </div>
                  <div className="text-[11px] text-emerald-100/80 mt-0.5">
                    Protected Committee Accounting System
                  </div>
                </div>
              </div>

              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight leading-snug text-white">
                {effectiveCommitteeTitle}
              </h1>
              <p className="mt-3 text-sm text-emerald-100/90 leading-relaxed">
                {effectiveCommitteeAddress}
              </p>

              <div className="mt-6 pt-6 border-t border-white/15 space-y-2.5 text-sm text-emerald-50/90">
                <p className="font-medium text-amber-200">{t(lang, 'tagline')}</p>
                <p>1 Physical Bank Account · 10 Separate Virtual Fund Ledgers</p>
                <p>Single Protected Owner Control · Role-Based Admin Permissions</p>
                <p>Dual-Admin Approval Above ₹5,000 · Immutable Audit Trail</p>
                <p>Auto Reminders on 5th of Every Month · Read-Only Member Transparency</p>
              </div>
            </div>

            {isDemoDataActive && (
              <div className="relative z-10 mt-8 pt-4 border-t border-white/15 text-xs text-amber-200 leading-relaxed">
                <strong className="font-semibold">DEMO MODE ACTIVE:</strong> Sample committee balances and records are loaded for demonstration. Owner / Primary Admin can switch to Clean Live Books inside Settings.
              </div>
            )}
          </div>

          {/* Right Sign-In Form Panel */}
          <div className="lg:col-span-6 p-6 sm:p-10 flex flex-col justify-center">
            <div className="mb-5">
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                {loginType === 'owner'
                  ? t(lang, 'ownerLogin')
                  : loginType === 'admin'
                  ? t(lang, 'adminLogin')
                  : t(lang, 'memberLogin')}
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                {loginType === 'owner'
                  ? 'Single protected App Owner / Super Admin with full control over accounts, branding, banks, UPI & QR.'
                  : loginType === 'admin'
                  ? 'Authorized Primary, Secondary, or Committee Administrators.'
                  : 'Sign in with your unique Member ID & Password for read-only transparency.'}
              </p>
            </div>

            {/* 3-Role Tab Switcher: Owner | Admin | Member */}
            <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-900 mb-5">
              <button
                type="button"
                onClick={() => {
                  setLoginType('owner');
                  setRequiresTwoFactor(false);
                  setShowOwnerSetup(false);
                  setShowForgotEmail(false);
                  setUsername('');
                  setPassword('');
                  setError('');
                  setInfoMsg('');
                }}
                className={`min-h-[42px] px-2.5 py-2 rounded-lg text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap ${
                  loginType === 'owner'
                    ? 'bg-white dark:bg-[#192822] text-amber-700 dark:text-amber-300 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <Crown className="w-4 h-4 shrink-0" />
                <span>Owner</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setLoginType('admin');
                  setRequiresTwoFactor(false);
                  setShowOwnerSetup(false);
                  setError('');
                  setInfoMsg('');
                }}
                className={`min-h-[42px] px-2.5 py-2 rounded-lg text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap ${
                  loginType === 'admin'
                    ? 'bg-white dark:bg-[#192822] text-[#0B4F32] dark:text-emerald-300 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>Admin</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setLoginType('member');
                  setRequiresTwoFactor(false);
                  setShowOwnerSetup(false);
                  setError('');
                  setInfoMsg('');
                }}
                className={`min-h-[42px] px-2.5 py-2 rounded-lg text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap ${
                  loginType === 'member'
                    ? 'bg-white dark:bg-[#192822] text-[#0B4F32] dark:text-emerald-300 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <Users className="w-4 h-4 shrink-0" />
                <span>Member</span>
              </button>
            </div>

            {error && (
              <div className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-red-700 dark:text-red-300 text-sm flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {infoMsg && (
              <div className="mb-4 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 text-emerald-800 dark:text-emerald-200 text-sm flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{infoMsg}</span>
              </div>
            )}

            {loginType === 'owner' && showOwnerSetup ? (
              <form onSubmit={handleOwnerClaimOrReset} className="space-y-3.5 p-4 rounded-xl bg-amber-50/60 dark:bg-amber-950/20 border border-amber-300/70 dark:border-amber-800/60">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-amber-900 dark:text-amber-200">
                    Setup Custom Owner ID / Reset Owner Password
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowOwnerSetup(false)}
                    className="text-xs font-semibold text-slate-600 dark:text-slate-400 underline"
                  >
                    Back to Login
                  </button>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  Requires live verification with your Primary Owner Google account via Firebase Authentication.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Custom Owner Login ID *
                    </label>
                    <input
                      type="text"
                      required
                      value={setupUsername}
                      onChange={(e) => setSetupUsername(e.target.value)}
                      placeholder="e.g. OWNER-01"
                      className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-data"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Owner Display Name
                    </label>
                    <input
                      type="text"
                      value={setupFullName}
                      onChange={(e) => setSetupFullName(e.target.value)}
                      placeholder="Optional"
                      className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      New Password * (min 8 chars)
                    </label>
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={setupPassword}
                      onChange={(e) => setSetupPassword(e.target.value)}
                      placeholder="Strong password"
                      className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Confirm Password *
                    </label>
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={setupConfirmPassword}
                      onChange={(e) => setSetupConfirmPassword(e.target.value)}
                      placeholder="Re-enter password"
                      className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Optional Verification PIN (4–8 digits, for branding unlock)
                  </label>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={8}
                    value={setupPin}
                    onChange={(e) => setSetupPin(e.target.value.replace(/\D/g, ''))}
                    placeholder="Optional 4–8 digit PIN"
                    className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-data"
                  />
                </div>
                <button
                  type="submit"
                  disabled={googleLoading}
                  className="w-full min-h-[46px] px-4 rounded-xl bg-[#0B4F32] hover:bg-[#093F28] disabled:opacity-60 text-white font-bold text-xs sm:text-sm inline-flex items-center justify-center gap-2"
                >
                  <Cloud className="w-4 h-4" />
                  <span>{googleLoading ? 'Verifying Owner Google Account...' : 'Verify with Owner Google Account & Save'}</span>
                </button>
              </form>
            ) : (
              <>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                      {t(lang, 'usernameLabel')}
                    </label>
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder={
                        loginType === 'owner'
                          ? 'izharahmad46@gmail.com or OWNER-01'
                          : loginType === 'admin'
                          ? 'Admin Email or Login ID (e.g. ADMIN-01)'
                          : 'Member ID or Email (e.g. M001)'
                      }
                      required
                      className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-sm font-data focus:outline-none focus:ring-2 focus:ring-[#0B4F32]"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                      {t(lang, 'passwordLabel')}
                    </label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        className="w-full min-h-[44px] px-3.5 py-2.5 pr-11 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-[#0B4F32]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-1 top-1/2 -translate-y-1/2 min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-500 hover:text-slate-700 dark:text-slate-400"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {requiresTwoFactor && (
                    <div>
                      <label className="block text-sm font-medium text-amber-800 dark:text-amber-300 mb-1.5 flex items-center gap-1.5">
                        <KeyRound className="w-4 h-4" />
                        <span>{t(lang, 'otpLabel')}</span>
                      </label>
                      <input
                        type="text"
                        value={otpCode}
                        onChange={(e) => setOtpCode(e.target.value)}
                        placeholder="123456"
                        maxLength={6}
                        required
                        className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl border border-amber-400 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/30 text-slate-900 dark:text-slate-100 font-data text-base tracking-widest focus:outline-none focus:ring-2 focus:ring-[#0B4F32]"
                      />
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading || googleLoading}
                    className="w-full min-h-[48px] px-4 py-2.5 rounded-xl bg-[#0B4F32] hover:bg-[#093F28] disabled:opacity-60 text-white font-semibold text-sm inline-flex items-center justify-center gap-2 transition-colors"
                  >
                    <Lock className="w-4 h-4" />
                    <span>{loading ? 'Signing in...' : t(lang, 'signIn')}</span>
                  </button>
                </form>

                {loginType === 'owner' ? (
                  <div className="mt-3 text-center">
                    <button
                      type="button"
                      onClick={() => {
                        setShowOwnerSetup(true);
                        setError('');
                      }}
                      className="text-xs font-semibold text-[#0B4F32] dark:text-emerald-400 hover:underline"
                    >
                      {ownerCredentialsClaimed
                        ? 'Forgot Owner Password? Reset via Firebase Google Verification'
                        : 'First time? Setup Custom Owner Login ID & Password'}
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 space-y-2.5">
                    <div className="text-center">
                      <button
                        type="button"
                        onClick={() => {
                          setShowForgotEmail(!showForgotEmail);
                          setError('');
                          setInfoMsg('');
                        }}
                        className="text-xs font-semibold text-[#0B4F32] dark:text-emerald-400 hover:underline"
                      >
                        {showForgotEmail ? 'Hide Forgot Password' : 'Forgot Password? Send Reset Email (Firebase Auth)'}
                      </button>
                    </div>
                    {showForgotEmail && (
                      <form
                        onSubmit={handleForgotPasswordEmail}
                        className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 space-y-2.5"
                      >
                        <p className="text-[11px] text-slate-600 dark:text-slate-400">
                          Enter your registered Firebase email to receive a secure password reset link, or ask the App Owner / Committee Admin to reset your Login ID password.
                        </p>
                        <div className="flex gap-2">
                          <input
                            type="email"
                            required
                            value={forgotEmail}
                            onChange={(e) => setForgotEmail(e.target.value)}
                            placeholder="registered-email@gmail.com"
                            className="flex-1 min-h-[38px] px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                          />
                          <button
                            type="submit"
                            disabled={sendingReset}
                            className="min-h-[38px] px-3.5 rounded-lg bg-[#0B4F32] hover:bg-[#093F28] text-white text-xs font-semibold disabled:opacity-60 whitespace-nowrap"
                          >
                            {sendingReset ? 'Sending...' : 'Send Link'}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                )}

                <div className="my-4 flex items-center gap-3">
                  <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
                  <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">or</span>
                  <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
                </div>

                <button
                  type="button"
                  disabled={loading || googleLoading}
                  onClick={handleGoogleSignIn}
                  className="w-full min-h-[46px] px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60 text-slate-800 dark:text-slate-100 font-semibold text-sm inline-flex items-center justify-center gap-2.5 transition-colors"
                >
                  <Cloud className="w-4 h-4 text-[#0B4F32] dark:text-emerald-400" />
                  <span>
                    {googleLoading
                      ? 'Connecting Firebase Account...'
                      : loginType === 'owner'
                      ? 'Sign In as Owner with Google (Firebase Auth)'
                      : 'Continue with Google (Firebase Cloud)'}
                  </span>
                </button>
              </>
            )}

            {/* Quick Demo Account Selector (Preserved unchanged for existing Admin/Member Demo Mode) */}
            {isDemoDataActive && loginType !== 'owner' && (
              <div className="mt-6 pt-5 border-t border-slate-200 dark:border-slate-800">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2.5">
                  Demo Credentials (Click to fill — DEMO Mode)
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => applyDemoAccount('admin', 'ADMIN-01', 'Admin@123')}
                    className="text-left px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-[#0B4F32] dark:hover:border-emerald-500 transition-colors"
                  >
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">Primary Admin (Sadar)</div>
                    <div className="text-xs font-data text-slate-500 dark:text-slate-400">ADMIN-01 / Admin@123</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => applyDemoAccount('admin', 'ADMIN-02', 'Admin@123')}
                    className="text-left px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-[#0B4F32] dark:hover:border-emerald-500 transition-colors"
                  >
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">Secondary Admin (Sec.)</div>
                    <div className="text-xs font-data text-slate-500 dark:text-slate-400">ADMIN-02 / Admin@123</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => applyDemoAccount('member', 'M001', 'Member@123')}
                    className="text-left px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-[#0B4F32] dark:hover:border-emerald-500 transition-colors"
                  >
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">Member (Read-Only)</div>
                    <div className="text-xs font-data text-slate-500 dark:text-slate-400">M001 / Member@123</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => applyDemoAccount('member', 'M004', 'Member@123')}
                    className="text-left px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-[#0B4F32] dark:hover:border-emerald-500 transition-colors"
                  >
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">Member M004 (Partial Due)</div>
                    <div className="text-xs font-data text-slate-500 dark:text-slate-400">M004 / Member@123</div>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
