import React, { useCallback, useEffect, useState } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import {
  Crown,
  ShieldCheck,
  Users,
  Lock,
  Landmark,
  KeyRound,
  Activity,
  Plus,
  Edit3,
  Trash2,
  CheckCircle2,
  XCircle,
  Ban,
  Upload,
  RefreshCw,
  Cloud,
  Search,
  AlertTriangle,
  QrCode,
  Sliders,
  X,
  Eye,
  EyeOff,
  Download,
  Mail,
  Send,
} from 'lucide-react';
import { apiRequest, downloadAppSourceZip } from '../lib/api';
import { signInWithGoogle, triggerFirebasePasswordResetEmail } from '../firebase';
import { syncSettingsToFirestore, syncBankUpiToFirestore } from '../lib/firestoreSync';
import type {
  AdminPermissions,
  AccountStatus,
  AppSettings,
  AuthUser,
  BankAccountRecord,
  FundSummary,
  Language,
  NumeralSystem,
  OwnerManagedAccount,
  OwnerOverviewData,
  UserRole,
} from '../types';
import { APP_MAIN_NAME, COMMITTEE_LOGO_URL, formatINR } from '../i18n/translations';

interface OwnerControlPanelViewProps {
  user: AuthUser;
  firebaseUser: FirebaseUser | null;
  lang: Language;
  numerals: NumeralSystem;
  settings: AppSettings | null;
  bankAccounts: BankAccountRecord[];
  funds: FundSummary[];
  onRefresh: () => Promise<void> | void;
  onUserUpdated: (updated: AuthUser) => void;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
  onConnectFirebase: () => Promise<FirebaseUser>;
  onSyncFirestore: () => Promise<{ syncedCollections: number; syncedDocuments: number }>;
  onNavigate: (tab: string, ctx?: string) => void;
}

type OwnerSubTab = 'overview' | 'accounts' | 'branding' | 'banks' | 'security' | 'activity';

const DEFAULT_PERMS: AdminPermissions = {
  canManageMembers: true,
  canManageAccounting: true,
  canManageSalaries: true,
  canManageBankQr: true,
  canManageSettings: true,
  canApproveTransactions: true,
  canExportReports: true,
};

const PERM_LABELS: Array<{ key: keyof AdminPermissions; label: string }> = [
  { key: 'canManageMembers', label: 'Manage Members & Access' },
  { key: 'canManageAccounting', label: 'Income, Expenses & Funds' },
  { key: 'canManageSalaries', label: 'Imam & Staff Salaries' },
  { key: 'canManageBankQr', label: 'Bank, UPI & QR Updates' },
  { key: 'canManageSettings', label: 'General Committee Settings' },
  { key: 'canApproveTransactions', label: 'Approve >₹5,000 Expenses' },
  { key: 'canExportReports', label: 'Reports & Data Exports' },
];

function roleLabel(role: UserRole): string {
  switch (role) {
    case 'owner':
      return 'Owner / Super Admin';
    case 'admin_main':
      return 'Primary Admin';
    case 'admin_secondary':
      return 'Secondary Admin';
    case 'committee_admin':
      return 'Committee Admin';
    default:
      return 'Member (Read-Only)';
  }
}

async function uploadImageFile(file: File, category: 'logo' | 'qr'): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose a valid PNG, JPG, or WebP image file.');
  }
  if (file.size > 4 * 1024 * 1024) {
    throw new Error('Image size must be under 4 MB.');
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });
  const res = await apiRequest<{ url: string }>('/api/uploads/image', {
    method: 'POST',
    body: { dataUrl, category },
  });
  return res.url;
}

export const OwnerControlPanelView: React.FC<OwnerControlPanelViewProps> = ({
  user,
  firebaseUser,
  numerals,
  settings,
  bankAccounts,
  funds,
  onRefresh,
  onUserUpdated,
  onNotify,
  onConnectFirebase,
  onSyncFirestore,
  onNavigate,
}) => {
  const [subTab, setSubTab] = useState<OwnerSubTab>('overview');
  const [overview, setOverview] = useState<OwnerOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Account filter & Create form
  const [acctSearch, setAcctSearch] = useState('');
  const [acctRoleFilter, setAcctRoleFilter] = useState<string>('all');
  const [showCreateAcct, setShowCreateAcct] = useState(false);
  const [newAcct, setNewAcct] = useState({
    username: '',
    fullName: '',
    password: '',
    role: 'committee_admin' as Exclude<UserRole, 'owner'>,
    phone: '',
    firebaseEmail: '',
    accountStatus: 'active' as AccountStatus,
    createMemberProfile: false,
    village: 'Ragdih, Chalkusha',
    monthlyAmount: 500,
    permissions: { ...DEFAULT_PERMS },
  });

  // Edit Account Modal
  const [editingAcct, setEditingAcct] = useState<OwnerManagedAccount | null>(null);
  const [editForm, setEditForm] = useState({
    username: '',
    fullName: '',
    role: 'member' as Exclude<UserRole, 'owner'>,
    newPassword: '',
    phone: '',
    firebaseEmail: '',
    accountStatus: 'active' as AccountStatus,
    permissions: { ...DEFAULT_PERMS },
    reason: '',
  });
  const [confirmDeleteAcctId, setConfirmDeleteAcctId] = useState<string | null>(null);

  // Firebase Password Reset Email Modal
  const [resetEmailAcct, setResetEmailAcct] = useState<OwnerManagedAccount | null>(null);
  const [resetEmailTarget, setResetEmailTarget] = useState('');
  const [resetEmailReason, setResetEmailReason] = useState('');
  const [resetEmailSaveToProfile, setResetEmailSaveToProfile] = useState(true);
  const [sendingResetEmail, setSendingResetEmail] = useState(false);

  // Committee Settings & Branding Form
  const [committeeForm, setCommitteeForm] = useState({
    committeeName: settings?.committeeName || '',
    committeeAddress: settings?.committeeAddress || '',
    appLogoUrl: settings?.appLogoUrl || '',
    defaultLanguage: settings?.defaultLanguage || 'en',
    memberLoginEnabled: settings?.memberLoginEnabled !== false,
    autoBackupEnabled: settings?.autoBackupEnabled !== false,
    dualApprovalEnabled: settings?.dualApprovalEnabled !== false,
    dualApprovalLimit: settings?.dualApprovalLimit || 5000,
    reminderDayOfMonth: settings?.reminderDayOfMonth || 5,
    reminderFrequency: settings?.reminderFrequency || 'monthly',
    defaultMonthlyContribution: settings?.defaultMonthlyContribution || 500,
    hideMemberPhonesForMembers: Boolean(settings?.hideMemberPhonesForMembers),
  });

  // Protected App Main Name Special Verification
  const [showUnlockBrand, setShowUnlockBrand] = useState(false);
  const [brandNewName, setBrandNewName] = useState(settings?.appMainName || APP_MAIN_NAME);
  const [brandPhrase, setBrandPhrase] = useState('');
  const [brandReason, setBrandReason] = useState('');
  const [brandAuthMode, setBrandAuthMode] = useState<'password' | 'pin' | 'firebase'>('password');
  const [brandSecret, setBrandSecret] = useState('');

  // Bank Management State
  const [showAddBank, setShowAddBank] = useState(false);
  const [newBank, setNewBank] = useState({
    bankName: '',
    accountName: '',
    accountNumber: '',
    ifsc: '',
    branch: '',
    upiId: '',
    qrCodeUrl: '',
    fundScope: 'Committee General Bank Account',
    openingBalance: 0,
    instructions: '',
  });
  const [editingBank, setEditingBank] = useState<BankAccountRecord | null>(null);
  const [editBankForm, setEditBankForm] = useState({
    bankName: '',
    accountName: '',
    accountNumber: '',
    ifsc: '',
    branch: '',
    upiId: '',
    qrCodeUrl: '',
    fundScope: '',
    openingBalance: 0,
    instructions: '',
    isActive: true,
  });
  const [confirmDeleteBankId, setConfirmDeleteBankId] = useState<string | null>(null);

  // Owner Security & Credentials Form
  const [ownerCredForm, setOwnerCredForm] = useState({
    username: user.username || '',
    fullName: user.fullName || '',
    phone: user.phone || '',
    currentPassword: '',
    newPassword: '',
    confirmNewPassword: '',
    verificationPin: '',
    twoFactorEnabled: user.twoFactorEnabled,
  });
  const [showOwnerPass, setShowOwnerPass] = useState(false);

  // Activity sub-view
  const [activityMode, setActivityMode] = useState<'logins' | 'audits'>('logins');

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ overview: OwnerOverviewData }>('/api/owner/overview');
      setOverview(res.overview);
    } catch (err: any) {
      onNotify(err?.message || 'Failed to load Owner Control Panel data.', 'error');
    } finally {
      setLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  useEffect(() => {
    if (!settings) return;
    setCommitteeForm({
      committeeName: settings.committeeName || '',
      committeeAddress: settings.committeeAddress || '',
      appLogoUrl: settings.appLogoUrl || '',
      defaultLanguage: settings.defaultLanguage || 'en',
      memberLoginEnabled: settings.memberLoginEnabled !== false,
      autoBackupEnabled: settings.autoBackupEnabled !== false,
      dualApprovalEnabled: settings.dualApprovalEnabled !== false,
      dualApprovalLimit: settings.dualApprovalLimit || 5000,
      reminderDayOfMonth: settings.reminderDayOfMonth || 5,
      reminderFrequency: settings.reminderFrequency || 'monthly',
      defaultMonthlyContribution: settings.defaultMonthlyContribution || 500,
      hideMemberPhonesForMembers: Boolean(settings.hideMemberPhonesForMembers),
    });
    setBrandNewName(settings.appMainName || APP_MAIN_NAME);
  }, [settings]);

  useEffect(() => {
    setOwnerCredForm((prev) => ({
      ...prev,
      username: user.username || '',
      fullName: user.fullName || '',
      phone: user.phone || '',
      twoFactorEnabled: user.twoFactorEnabled,
    }));
  }, [user.username, user.fullName, user.phone, user.twoFactorEnabled]);

  const totalFundsBalance = funds.reduce((s, f) => s + Number(f.currentBalance || 0), 0);

  async function handleCreateAccount(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiRequest('/api/owner/accounts', {
        method: 'POST',
        body: newAcct,
      });
      onNotify(`Account "${newAcct.username}" created successfully.`, 'success');
      setShowCreateAcct(false);
      setNewAcct({
        username: '',
        fullName: '',
        password: '',
        role: 'committee_admin',
        phone: '',
        firebaseEmail: '',
        accountStatus: 'active',
        createMemberProfile: false,
        village: 'Ragdih, Chalkusha',
        monthlyAmount: settings?.defaultMonthlyContribution || 500,
        permissions: { ...DEFAULT_PERMS },
      });
      await Promise.all([fetchOverview(), onRefresh()]);
    } catch (err: any) {
      onNotify(err?.message || 'Could not create account.', 'error');
    } finally {
      setBusy(false);
    }
  }

  function openEditAccount(acct: OwnerManagedAccount) {
    if (acct.role === 'owner') return;
    setEditingAcct(acct);
    setEditForm({
      username: acct.username,
      fullName: acct.fullName,
      role: acct.role as Exclude<UserRole, 'owner'>,
      newPassword: '',
      phone: acct.phone || '',
      firebaseEmail: acct.firebaseEmail || '',
      accountStatus: acct.accountStatus,
      permissions: { ...DEFAULT_PERMS, ...(acct.permissions || {}) },
      reason: '',
    });
  }

  async function handleSaveAccountEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingAcct) return;
    setBusy(true);
    try {
      await apiRequest(`/api/owner/accounts/${editingAcct.id}`, {
        method: 'PUT',
        body: {
          username: editForm.username,
          fullName: editForm.fullName,
          role: editForm.role,
          newPassword: editForm.newPassword || undefined,
          phone: editForm.phone,
          firebaseEmail: editForm.firebaseEmail,
          accountStatus: editForm.accountStatus,
          permissions: editForm.permissions,
          reason: editForm.reason || 'Updated by App Owner',
        },
      });
      onNotify(`Account "${editForm.username}" updated successfully.`, 'success');
      setEditingAcct(null);
      await Promise.all([fetchOverview(), onRefresh()]);
    } catch (err: any) {
      onNotify(err?.message || 'Could not update account.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleQuickStatusChange(acct: OwnerManagedAccount, status: AccountStatus) {
    if (acct.role === 'owner') return;
    setBusy(true);
    try {
      await apiRequest(`/api/owner/accounts/${acct.id}/status`, {
        method: 'PATCH',
        body: { accountStatus: status, reason: `Owner changed status to ${status}` },
      });
      onNotify(`${acct.username} status changed to ${status.toUpperCase()}.`, 'success');
      await Promise.all([fetchOverview(), onRefresh()]);
    } catch (err: any) {
      onNotify(err?.message || 'Could not update account status.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteAccount(acct: OwnerManagedAccount) {
    if (acct.role === 'owner') return;
    setBusy(true);
    try {
      await apiRequest(`/api/owner/accounts/${acct.id}`, { method: 'DELETE' });
      onNotify(`Account "${acct.username}" deleted.`, 'success');
      setConfirmDeleteAcctId(null);
      await Promise.all([fetchOverview(), onRefresh()]);
    } catch (err: any) {
      onNotify(err?.message || 'Could not delete account.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveCommitteeSettings(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiRequest<{ settings: AppSettings }>('/api/settings', {
        method: 'PUT',
        body: committeeForm,
      });
      if (firebaseUser && firebaseUser.emailVerified) {
        void syncSettingsToFirestore(res.settings).catch(() => {});
      }
      onNotify('Committee settings & branding updated.', 'success');
      await Promise.all([fetchOverview(), onRefresh()]);
    } catch (err: any) {
      onNotify(err?.message || 'Failed to update settings.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleLogoUpload(file: File | null) {
    if (!file) return;
    setBusy(true);
    try {
      const url = await uploadImageFile(file, 'logo');
      setCommitteeForm((p) => ({ ...p, appLogoUrl: url }));
      onNotify('Logo uploaded. Click "Save Committee Settings" to apply.', 'success');
    } catch (err: any) {
      onNotify(err?.message || 'Logo upload failed.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleProtectedAppNameSubmit(resetToDefault = false) {
    setBusy(true);
    try {
      let firebaseIdToken: string | undefined;
      if (brandAuthMode === 'firebase') {
        const fbUser = await signInWithGoogle();
        firebaseIdToken = await fbUser.getIdToken(true);
      }
      const res = await apiRequest<{ settings: AppSettings }>('/api/owner/branding/app-name', {
        method: 'POST',
        body: {
          newAppMainName: resetToDefault ? APP_MAIN_NAME : brandNewName,
          resetToDefault,
          confirmationPhrase: brandPhrase,
          reason: brandReason,
          ownerPassword: brandAuthMode === 'password' ? brandSecret : undefined,
          ownerPin: brandAuthMode === 'pin' ? brandSecret : undefined,
          firebaseIdToken,
        },
      });
      if (firebaseUser && firebaseUser.emailVerified) {
        void syncSettingsToFirestore(res.settings).catch(() => {});
      }
      onNotify(`Protected Main App Name updated to "${res.settings.appMainName}".`, 'success');
      setShowUnlockBrand(false);
      setBrandPhrase('');
      setBrandReason('');
      setBrandSecret('');
      await Promise.all([fetchOverview(), onRefresh()]);
    } catch (err: any) {
      onNotify(err?.message || 'Special Owner Verification failed.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleAddBank(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiRequest('/api/owner/banks', {
        method: 'POST',
        body: newBank,
      });
      onNotify(`Bank account "${newBank.bankName}" added successfully.`, 'success');
      setShowAddBank(false);
      setNewBank({
        bankName: '',
        accountName: '',
        accountNumber: '',
        ifsc: '',
        branch: '',
        upiId: '',
        qrCodeUrl: '',
        fundScope: 'Committee General Bank Account',
        openingBalance: 0,
        instructions: '',
      });
      await Promise.all([fetchOverview(), onRefresh()]);
    } catch (err: any) {
      onNotify(err?.message || 'Could not add bank account.', 'error');
    } finally {
      setBusy(false);
    }
  }

  function openEditBank(bank: BankAccountRecord) {
    setEditingBank(bank);
    setEditBankForm({
      bankName: bank.bankName,
      accountName: bank.accountName,
      accountNumber: bank.accountNumber,
      ifsc: bank.ifsc,
      branch: bank.branch || '',
      upiId: bank.upiId || '',
      qrCodeUrl: bank.qrCodeUrl || '',
      fundScope: bank.fundScope || '',
      openingBalance: Number(bank.openingBalance || 0),
      instructions: bank.instructions || '',
      isActive: bank.isActive,
    });
  }

  async function handleSaveBankEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingBank) return;
    setBusy(true);
    try {
      await apiRequest(`/api/owner/banks/${editingBank.id}`, {
        method: 'PUT',
        body: editBankForm,
      });
      if (firebaseUser && firebaseUser.emailVerified) {
        void syncBankUpiToFirestore({ ...editingBank, ...editBankForm }).catch(() => {});
      }
      onNotify(`Bank account "${editBankForm.bankName}" updated.`, 'success');
      setEditingBank(null);
      await Promise.all([fetchOverview(), onRefresh()]);
    } catch (err: any) {
      onNotify(err?.message || 'Could not update bank account.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteBank(bank: BankAccountRecord) {
    setBusy(true);
    try {
      const res = await apiRequest<{ ok: boolean; mode: string }>(`/api/owner/banks/${bank.id}`, {
        method: 'DELETE',
      });
      onNotify(
        res.mode === 'deactivated_history_preserved'
          ? `Bank "${bank.bankName}" deactivated (historical transactions safely preserved).`
          : `Bank "${bank.bankName}" permanently deleted.`,
        'success'
      );
      setConfirmDeleteBankId(null);
      await Promise.all([fetchOverview(), onRefresh()]);
    } catch (err: any) {
      onNotify(err?.message || 'Could not delete bank account.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveOwnerCredentials(useFirebaseReset = false) {
    if (ownerCredForm.newPassword && ownerCredForm.newPassword !== ownerCredForm.confirmNewPassword) {
      onNotify('New password and confirm password do not match.', 'error');
      return;
    }
    setBusy(true);
    try {
      let firebaseIdToken: string | undefined;
      if (useFirebaseReset) {
        const fbUser = await signInWithGoogle();
        firebaseIdToken = await fbUser.getIdToken(true);
      }
      const res = await apiRequest<{ ok: boolean; user: AuthUser }>('/api/owner/credentials', {
        method: 'PUT',
        body: {
          username: ownerCredForm.username,
          fullName: ownerCredForm.fullName,
          phone: ownerCredForm.phone,
          currentPassword: ownerCredForm.currentPassword || undefined,
          newPassword: ownerCredForm.newPassword || undefined,
          verificationPin: ownerCredForm.verificationPin || undefined,
          twoFactorEnabled: ownerCredForm.twoFactorEnabled,
          firebaseIdToken,
        },
      });
      onUserUpdated(res.user);
      setOwnerCredForm((p) => ({
        ...p,
        currentPassword: '',
        newPassword: '',
        confirmNewPassword: '',
        verificationPin: '',
      }));
      onNotify('Owner security credentials updated and logged.', 'success');
      await fetchOverview();
    } catch (err: any) {
      onNotify(err?.message || 'Could not update Owner credentials.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleCloudSync() {
    setBusy(true);
    try {
      if (!firebaseUser) {
        await onConnectFirebase();
      }
      const res = await onSyncFirestore();
      onNotify(`Synced ${res.syncedDocuments} documents across ${res.syncedCollections} collections to Firebase Cloud.`, 'success');
    } catch (err: any) {
      onNotify(err?.message || 'Firebase sync failed.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleDownloadSourceZip() {
    setBusy(true);
    try {
      const res = await downloadAppSourceZip();
      onNotify(`Downloaded ${res.filename} (${res.fileCount} files, clean & secret-free).`, 'success');
    } catch (err: any) {
      onNotify(err?.message || 'Failed to download source ZIP.', 'error');
    } finally {
      setBusy(false);
    }
  }

  function openResetEmailModal(acct: OwnerManagedAccount) {
    setResetEmailAcct(acct);
    setResetEmailTarget(acct.firebaseEmail || '');
    setResetEmailReason('');
    setResetEmailSaveToProfile(!acct.firebaseEmail && acct.role !== 'owner');
  }

  async function handleSendPasswordResetEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!resetEmailAcct) return;
    const cleanEmail = resetEmailTarget.trim().toLowerCase();
    if (!cleanEmail) {
      onNotify('Please enter the registered Firebase email address for this user.', 'error');
      return;
    }

    setSendingResetEmail(true);
    try {
      // 1) Server-side Owner verification, email validation & cooldown check
      const prep = await apiRequest<{ ok: boolean; email: string; emailSaved: boolean }>(
        `/api/owner/accounts/${resetEmailAcct.id}/password-reset-prepare`,
        {
          method: 'POST',
          body: {
            email: cleanEmail,
            saveEmailToAccount: resetEmailSaveToProfile && resetEmailAcct.role !== 'owner',
          },
        }
      );

      // 2) Dispatch secure one-time password reset email via Firebase Auth SDK
      await triggerFirebasePasswordResetEmail(prep.email);

      // 3) Record immutable Owner audit entry
      await apiRequest(`/api/owner/accounts/${resetEmailAcct.id}/password-reset-audit`, {
        method: 'POST',
        body: {
          email: prep.email,
          reason:
            resetEmailReason.trim() ||
            `Super Admin triggered Firebase password reset email for ${resetEmailAcct.username}`,
        },
      });

      onNotify(
        `Secure Firebase password reset email sent to ${prep.email} for ${resetEmailAcct.fullName} (${resetEmailAcct.username}).`,
        'success'
      );
      setResetEmailAcct(null);
      await fetchOverview();
    } catch (err: any) {
      onNotify(err?.message || 'Failed to trigger Firebase password reset email.', 'error');
    } finally {
      setSendingResetEmail(false);
    }
  }

  const filteredAccounts = (overview?.accounts || []).filter((a) => {
    const matchRole = acctRoleFilter === 'all' || a.role === acctRoleFilter;
    const q = acctSearch.trim().toLowerCase();
    const matchQ =
      !q ||
      a.username.toLowerCase().includes(q) ||
      a.fullName.toLowerCase().includes(q) ||
      (a.firebaseEmail || '').toLowerCase().includes(q);
    return matchRole && matchQ;
  });

  const tabs: Array<{ key: OwnerSubTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { key: 'overview', label: 'Overview', icon: Crown },
    { key: 'accounts', label: 'Accounts & Roles', icon: Users },
    { key: 'branding', label: 'Branding & Settings', icon: Sliders },
    { key: 'banks', label: 'Banks, UPI & QR', icon: Landmark },
    { key: 'security', label: 'Owner Security', icon: KeyRound },
    { key: 'activity', label: 'Activity & Audit', icon: Activity },
  ];

  return (
    <div className="space-y-5">
      {/* Owner Authority Header */}
      <div className="rounded-2xl bg-[#0B4F32] text-white p-5 sm:p-6 shadow-sm flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-200">
            <Crown className="w-4 h-4" />
            <span>Single Protected Owner / Super Admin Control System</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
            {settings?.appMainName || APP_MAIN_NAME} — Owner Control Panel
          </h1>
          <p className="text-xs sm:text-sm text-emerald-100/90">
            Owner: <strong>{user.fullName}</strong> ({user.username}) · Verified Email:{' '}
            <span className="font-data">{overview?.protectedBranding.primaryOwnerEmail || user.firebaseEmail}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => fetchOverview()}
            className="min-h-[42px] px-3.5 rounded-xl bg-white/15 hover:bg-white/25 text-white text-xs font-semibold inline-flex items-center gap-2 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleDownloadSourceZip}
            className="min-h-[42px] px-3.5 rounded-xl bg-white/15 hover:bg-white/25 text-white text-xs font-semibold inline-flex items-center gap-2 transition-colors"
          >
            <Download className="w-4 h-4" />
            <span>Download App (ZIP)</span>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleCloudSync}
            className="min-h-[42px] px-4 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-bold inline-flex items-center gap-2 transition-colors"
          >
            <Cloud className="w-4 h-4" />
            <span>{firebaseUser ? 'Sync to Firebase Cloud' : 'Connect & Sync Firebase'}</span>
          </button>
        </div>
      </div>

      {/* Sub-navigation Tabs */}
      <div className="flex flex-wrap gap-1.5 p-1.5 rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800">
        {tabs.map((tb) => {
          const Icon = tb.icon;
          const active = subTab === tb.key;
          return (
            <button
              key={tb.key}
              type="button"
              onClick={() => setSubTab(tb.key)}
              className={`min-h-[42px] px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold inline-flex items-center gap-2 transition-colors ${
                active
                  ? 'bg-[#0B4F32] text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span>{tb.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: OVERVIEW */}
      {subTab === 'overview' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-4">
              <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">Protected Owner</div>
              <div className="mt-1 text-2xl font-bold font-data text-[#0B4F32] dark:text-emerald-400">
                {overview?.stats.ownerCount ?? 1} / 1
              </div>
              <div className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-300 font-medium">
                DB & Rules Locked (Immutable)
              </div>
            </div>
            <div className="rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-4">
              <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">Admins & Committee Admins</div>
              <div className="mt-1 text-2xl font-bold font-data text-slate-900 dark:text-slate-100">
                {overview?.stats.adminCount ?? 0}
              </div>
              <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Controlled by Owner Permissions
              </div>
            </div>
            <div className="rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-4">
              <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">Member Accounts</div>
              <div className="mt-1 text-2xl font-bold font-data text-slate-900 dark:text-slate-100">
                {overview?.stats.memberCount ?? 0}
              </div>
              <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Active: {overview?.stats.activeCount ?? 0} · Suspended: {overview?.stats.suspendedCount ?? 0}
              </div>
            </div>
            <div className="rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-4">
              <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">Total Committee Funds</div>
              <div className="mt-1 text-2xl font-bold font-data text-slate-900 dark:text-slate-100">
                {formatINR(totalFundsBalance, numerals)}
              </div>
              <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                {funds.length} Virtual Ledgers · {bankAccounts.filter((b) => b.isActive).length} Active Bank(s)
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Lock className="w-4 h-4 text-[#0B4F32] dark:text-emerald-400" />
                  <span>Protected Main App Branding</span>
                </h2>
                <span className="px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-[#0B4F32] dark:text-emerald-300 text-xs font-bold">
                  LOCKED
                </span>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800">
                <div className="text-xs text-slate-500 dark:text-slate-400">Main App Name</div>
                <div className="text-lg font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                  {settings?.appMainName || APP_MAIN_NAME}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
                  Protected by backend API, SQLite settings lock, and Firestore Security Rules. No member or admin can change this name.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSubTab('branding')}
                className="min-h-[42px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Manage Branding & Committee Settings
              </button>
            </div>

            <div className="rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-5 space-y-3">
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#0B4F32] dark:text-emerald-400" />
                <span>Owner Security Checklist</span>
              </h2>
              <ul className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
                <li className="flex items-center justify-between gap-2 py-1.5 border-b border-slate-100 dark:border-slate-800">
                  <span>Custom Owner Login ID & Password</span>
                  <span className={`font-bold ${user.credentialsClaimed ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                    {user.credentialsClaimed ? `Active (${user.username})` : 'Not Set Yet'}
                  </span>
                </li>
                <li className="flex items-center justify-between gap-2 py-1.5 border-b border-slate-100 dark:border-slate-800">
                  <span>Owner Special Verification PIN</span>
                  <span className={`font-bold ${user.hasOwnerPin ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'}`}>
                    {user.hasOwnerPin ? 'Configured' : 'Optional (Not Set)'}
                  </span>
                </li>
                <li className="flex items-center justify-between gap-2 py-1.5">
                  <span>Firebase Cloud Auth Session</span>
                  <span className={`font-bold ${firebaseUser?.emailVerified ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                    {firebaseUser?.emailVerified ? firebaseUser.email : 'Not Connected'}
                  </span>
                </li>
              </ul>
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setSubTab('security')}
                  className="min-h-[40px] px-3.5 rounded-xl bg-[#0B4F32] text-white text-xs font-semibold hover:bg-[#093F28]"
                >
                  Configure Owner ID / Password / PIN
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('accounts')}
                  className="min-h-[40px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200"
                >
                  Open Funds & Accounting
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: ACCOUNTS & PERMISSIONS */}
      {subTab === 'accounts' && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex flex-1 flex-wrap items-center gap-2.5">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={acctSearch}
                  onChange={(e) => setAcctSearch(e.target.value)}
                  placeholder="Search Login ID, name, or email..."
                  className="w-full min-h-[42px] pl-9 pr-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
              </div>
              <select
                value={acctRoleFilter}
                onChange={(e) => setAcctRoleFilter(e.target.value)}
                className="min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              >
                <option value="all">All Roles</option>
                <option value="owner">Owner</option>
                <option value="admin_main">Primary Admin</option>
                <option value="admin_secondary">Secondary Admin</option>
                <option value="committee_admin">Committee Admin</option>
                <option value="member">Member</option>
              </select>
            </div>
            <button
              type="button"
              onClick={() => setShowCreateAcct(!showCreateAcct)}
              className="min-h-[42px] px-4 rounded-xl bg-[#0B4F32] hover:bg-[#093F28] text-white text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              <span>Create New Account</span>
            </button>
          </div>

          {showCreateAcct && (
            <form
              onSubmit={handleCreateAccount}
              className="rounded-2xl bg-white dark:bg-[#121D18] border-2 border-[#0B4F32]/40 p-5 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Create New Admin / Committee Admin / Member Account
                </h3>
                <button type="button" onClick={() => setShowCreateAcct(false)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Login ID *</label>
                  <input
                    type="text"
                    required
                    value={newAcct.username}
                    onChange={(e) => setNewAcct({ ...newAcct, username: e.target.value })}
                    placeholder="e.g. CADMIN-01 or M025"
                    className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-data"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Full Name *</label>
                  <input
                    type="text"
                    required
                    value={newAcct.fullName}
                    onChange={(e) => setNewAcct({ ...newAcct, fullName: e.target.value })}
                    placeholder="Full Name"
                    className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Password * (min 6 chars)</label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={newAcct.password}
                    onChange={(e) => setNewAcct({ ...newAcct, password: e.target.value })}
                    placeholder="Set strong password"
                    className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Role *</label>
                  <select
                    value={newAcct.role}
                    onChange={(e) => setNewAcct({ ...newAcct, role: e.target.value as Exclude<UserRole, 'owner'> })}
                    className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  >
                    <option value="committee_admin">Committee Admin</option>
                    <option value="admin_main">Primary Admin</option>
                    <option value="admin_secondary">Secondary Admin</option>
                    <option value="member">Member (Read-Only)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Phone</label>
                  <input
                    type="text"
                    value={newAcct.phone}
                    onChange={(e) => setNewAcct({ ...newAcct, phone: e.target.value })}
                    placeholder="+91 ..."
                    className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-data"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Linked Google Email (Optional)</label>
                  <input
                    type="email"
                    value={newAcct.firebaseEmail}
                    onChange={(e) => setNewAcct({ ...newAcct, firebaseEmail: e.target.value })}
                    placeholder="user@gmail.com"
                    className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  />
                </div>
              </div>

              {newAcct.role === 'member' && (
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-3">
                  <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                    <input
                      type="checkbox"
                      checked={newAcct.createMemberProfile}
                      onChange={(e) => setNewAcct({ ...newAcct, createMemberProfile: e.target.checked })}
                      className="rounded"
                    />
                    <span>Also create a monthly contribution Member Ledger profile</span>
                  </label>
                  {newAcct.createMemberProfile && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <input
                        type="text"
                        value={newAcct.village}
                        onChange={(e) => setNewAcct({ ...newAcct, village: e.target.value })}
                        placeholder="Village / Address"
                        className="min-h-[40px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                      />
                      <input
                        type="number"
                        min={10}
                        value={newAcct.monthlyAmount}
                        onChange={(e) => setNewAcct({ ...newAcct, monthlyAmount: Number(e.target.value) })}
                        placeholder="Monthly Chanda (₹)"
                        className="min-h-[40px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-data"
                      />
                    </div>
                  )}
                </div>
              )}

              {newAcct.role !== 'member' && (
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-2">
                  <div className="text-xs font-bold text-slate-700 dark:text-slate-200">Admin Permissions (Owner Controlled)</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {PERM_LABELS.map((p) => (
                      <label key={p.key} className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                        <input
                          type="checkbox"
                          checked={newAcct.permissions[p.key]}
                          onChange={(e) =>
                            setNewAcct({
                              ...newAcct,
                              permissions: { ...newAcct.permissions, [p.key]: e.target.checked },
                            })
                          }
                        />
                        <span>{p.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateAcct(false)}
                  className="min-h-[42px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-[42px] px-5 rounded-xl bg-[#0B4F32] hover:bg-[#093F28] text-white text-xs font-bold"
                >
                  {busy ? 'Creating...' : 'Create Account'}
                </button>
              </div>
            </form>
          )}

          {/* Accounts Table */}
          <div className="rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="py-3 px-4">Login ID & Name</th>
                    <th className="py-3 px-4">Role</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Last Login / Sessions</th>
                    <th className="py-3 px-4 text-right">Owner Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                  {filteredAccounts.map((acct) => {
                    const isOwnerRow = acct.role === 'owner';
                    return (
                      <tr key={acct.id} className={isOwnerRow ? 'bg-emerald-50/40 dark:bg-emerald-950/20' : ''}>
                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                            {isOwnerRow && <Crown className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                            <span>{acct.fullName}</span>
                          </div>
                          <div className="text-xs font-data text-slate-500 dark:text-slate-400">
                            ID: {acct.username}
                            {acct.firebaseEmail ? ` · ${acct.firebaseEmail}` : ''}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex px-2.5 py-1 rounded-lg text-xs font-semibold ${
                              isOwnerRow
                                ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-900 dark:text-amber-200'
                                : acct.role === 'member'
                                ? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                                : 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-900 dark:text-emerald-200'
                            }`}
                          >
                            {roleLabel(acct.role)}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold ${
                              acct.accountStatus === 'active'
                                ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                                : acct.accountStatus === 'suspended'
                                ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300'
                                : 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300'
                            }`}
                          >
                            {acct.accountStatus === 'active' && <CheckCircle2 className="w-3 h-3" />}
                            {acct.accountStatus === 'suspended' && <Ban className="w-3 h-3" />}
                            {acct.accountStatus === 'inactive' && <XCircle className="w-3 h-3" />}
                            <span className="capitalize">{acct.accountStatus}</span>
                          </span>
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-500 dark:text-slate-400">
                          <div>{acct.lastLoginAt ? new Date(acct.lastLoginAt).toLocaleString() : 'Never logged in'}</div>
                          <div className="font-data text-[11px]">Active sessions: {acct.activeSessions}</div>
                        </td>
                        <td className="py-3 px-4 text-right">
                          {isOwnerRow ? (
                            <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                              <button
                                type="button"
                                disabled={busy || sendingResetEmail}
                                onClick={() => openResetEmailModal(acct)}
                                className="px-2.5 py-1.5 rounded-lg border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-xs font-semibold inline-flex items-center gap-1"
                                title="Send Firebase Auth Password Reset Email"
                              >
                                <Mail className="w-3.5 h-3.5" />
                                <span>Reset Email</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setSubTab('security')}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-200 text-xs font-bold"
                              >
                                <Lock className="w-3.5 h-3.5" />
                                <span>Protected Owner</span>
                              </button>
                            </div>
                          ) : (
                            <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                              {acct.accountStatus !== 'active' && (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => handleQuickStatusChange(acct, 'active')}
                                  className="px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700"
                                >
                                  Activate
                                </button>
                              )}
                              {acct.accountStatus === 'active' && (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => handleQuickStatusChange(acct, 'inactive')}
                                  className="px-2.5 py-1.5 rounded-lg border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs font-semibold"
                                >
                                  Deactivate
                                </button>
                              )}
                              {acct.accountStatus !== 'suspended' && (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => handleQuickStatusChange(acct, 'suspended')}
                                  className="px-2.5 py-1.5 rounded-lg border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-semibold"
                                >
                                  Suspend
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={busy || sendingResetEmail}
                                onClick={() => openResetEmailModal(acct)}
                                className="px-2.5 py-1.5 rounded-lg border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-xs font-semibold inline-flex items-center gap-1"
                                title="Send Firebase Auth Password Reset Email"
                              >
                                <Mail className="w-3.5 h-3.5" />
                                <span>Reset Email</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => openEditAccount(acct)}
                                className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold inline-flex items-center gap-1"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                                <span>Edit</span>
                              </button>
                              {confirmDeleteAcctId === acct.id ? (
                                <span className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => handleDeleteAccount(acct)}
                                    className="px-2.5 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-bold"
                                  >
                                    Confirm Delete
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteAcctId(null)}
                                    className="px-2 py-1.5 rounded-lg border border-slate-300 text-xs"
                                  >
                                    Cancel
                                  </button>
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteAcctId(acct.id)}
                                  className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                                  title="Delete Account"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Send Firebase Password Reset Email Modal */}
          {resetEmailAcct && (
            <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
              <form
                onSubmit={handleSendPasswordResetEmail}
                className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-4 shadow-xl"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#0B4F32] dark:text-emerald-400">
                      <Mail className="w-4 h-4" />
                      <span>Firebase Auth Password Reset</span>
                    </div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                      Send Secure Reset Email
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setResetEmailAcct(null)}
                    className="text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 p-3.5 text-xs space-y-1">
                  <div className="font-bold text-slate-900 dark:text-slate-100">
                    {resetEmailAcct.fullName}
                  </div>
                  <div className="text-slate-500 dark:text-slate-400 font-data">
                    Login ID: {resetEmailAcct.username} · Role: {roleLabel(resetEmailAcct.role)}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Registered Firebase Email Address *
                  </label>
                  <input
                    type="email"
                    required
                    readOnly={resetEmailAcct.role === 'owner' && Boolean(resetEmailAcct.firebaseEmail)}
                    value={resetEmailTarget}
                    onChange={(e) => setResetEmailTarget(e.target.value)}
                    placeholder="user@example.com"
                    className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-data read-only:opacity-75 read-only:bg-slate-100 dark:read-only:bg-slate-800"
                  />
                  {resetEmailAcct.role === 'owner' ? (
                    <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
                      Locked to the verified Owner Firebase email for account security.
                    </p>
                  ) : (
                    <label className="mt-2 inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={resetEmailSaveToProfile}
                        onChange={(e) => setResetEmailSaveToProfile(e.target.checked)}
                        className="rounded border-slate-300 text-[#0B4F32] focus:ring-[#0B4F32]"
                      />
                      <span>Save this email address to the user&apos;s profile</span>
                    </label>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Audit Reason (Optional)
                  </label>
                  <input
                    type="text"
                    maxLength={300}
                    value={resetEmailReason}
                    onChange={(e) => setResetEmailReason(e.target.value)}
                    placeholder="e.g., User requested password recovery"
                    className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  />
                </div>

                <div className="rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 p-3 text-[11px] text-emerald-900 dark:text-emerald-200 leading-relaxed">
                  Firebase Authentication will email a secure, single-use password reset link directly to the address above. This action is logged in the immutable Owner Audit Trail.
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    disabled={sendingResetEmail}
                    onClick={() => setResetEmailAcct(null)}
                    className="min-h-[42px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={sendingResetEmail}
                    className="min-h-[42px] px-5 rounded-xl bg-[#0B4F32] hover:bg-[#093F28] text-white text-xs font-bold inline-flex items-center gap-2 disabled:opacity-60"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{sendingResetEmail ? 'Sending Reset Email...' : 'Send Reset Email'}</span>
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Edit Account Modal */}
          {editingAcct && (
            <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
              <form
                onSubmit={handleSaveAccountEdit}
                className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-4 shadow-xl"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    Edit Account: {editingAcct.username}
                  </h3>
                  <button type="button" onClick={() => setEditingAcct(null)} className="text-slate-400">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Login ID</label>
                    <input
                      type="text"
                      required
                      value={editForm.username}
                      onChange={(e) => setEditForm({ ...editForm, username: e.target.value })}
                      className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-data"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Full Name</label>
                    <input
                      type="text"
                      required
                      value={editForm.fullName}
                      onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })}
                      className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Role</label>
                    <select
                      value={editForm.role}
                      onChange={(e) => setEditForm({ ...editForm, role: e.target.value as Exclude<UserRole, 'owner'> })}
                      className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                    >
                      <option value="admin_main">Primary Admin</option>
                      <option value="admin_secondary">Secondary Admin</option>
                      <option value="committee_admin">Committee Admin</option>
                      <option value="member">Member (Read-Only)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Account Status</label>
                    <select
                      value={editForm.accountStatus}
                      onChange={(e) => setEditForm({ ...editForm, accountStatus: e.target.value as AccountStatus })}
                      className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                      <option value="suspended">Suspended</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      Reset Password (leave empty to keep current)
                    </label>
                    <input
                      type="password"
                      minLength={6}
                      value={editForm.newPassword}
                      onChange={(e) => setEditForm({ ...editForm, newPassword: e.target.value })}
                      placeholder="New password (min 6 chars)"
                      className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Phone</label>
                    <input
                      type="text"
                      value={editForm.phone}
                      onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                      className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-data"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Linked Firebase Google Email</label>
                    <input
                      type="email"
                      value={editForm.firebaseEmail}
                      onChange={(e) => setEditForm({ ...editForm, firebaseEmail: e.target.value })}
                      placeholder="Optional Google email for SSO login"
                      className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                    />
                  </div>
                </div>

                {editForm.role !== 'member' && (
                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-2">
                    <div className="text-xs font-bold text-slate-700 dark:text-slate-200">Admin Permissions</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {PERM_LABELS.map((p) => (
                        <label key={p.key} className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                          <input
                            type="checkbox"
                            checked={editForm.permissions[p.key]}
                            onChange={(e) =>
                              setEditForm({
                                ...editForm,
                                permissions: { ...editForm.permissions, [p.key]: e.target.checked },
                              })
                            }
                          />
                          <span>{p.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Audit Note / Reason</label>
                  <input
                    type="text"
                    value={editForm.reason}
                    onChange={(e) => setEditForm({ ...editForm, reason: e.target.value })}
                    placeholder="Reason for this account update"
                    className="w-full min-h-[40px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setEditingAcct(null)}
                    className="min-h-[42px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="min-h-[42px] px-5 rounded-xl bg-[#0B4F32] text-white text-xs font-bold"
                  >
                    {busy ? 'Saving...' : 'Save Account Changes'}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: BRANDING & COMMITTEE SETTINGS */}
      {subTab === 'branding' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Protected Main App Name Vault */}
          <div className="lg:col-span-5 rounded-2xl bg-white dark:bg-[#121D18] border-2 border-amber-400/70 dark:border-amber-700/60 p-5 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-700 dark:text-amber-300 uppercase tracking-wider">
                  <Lock className="w-3.5 h-3.5" />
                  <span>Protected System Branding</span>
                </div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 mt-1">
                  {settings?.appMainName || APP_MAIN_NAME}
                </h2>
              </div>
              <span className="px-2.5 py-1 rounded-lg bg-amber-100 dark:bg-amber-900/50 text-amber-900 dark:text-amber-200 text-[11px] font-bold">
                LOCKED
              </span>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              The main application name is locked to <strong>{APP_MAIN_NAME}</strong> by default. General Settings, Admins, and Members are strictly blocked from changing it. Only the verified <strong>Owner</strong> can modify it after completing Special Owner Verification.
            </p>

            {!showUnlockBrand ? (
              <button
                type="button"
                onClick={() => setShowUnlockBrand(true)}
                className="w-full min-h-[44px] px-4 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold inline-flex items-center justify-center gap-2"
              >
                <KeyRound className="w-4 h-4" />
                <span>Unlock Main App Name (Special Owner Verification)</span>
              </button>
            ) : (
              <div className="p-4 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-amber-900 dark:text-amber-200">Special Owner Verification</span>
                  <button type="button" onClick={() => setShowUnlockBrand(false)} className="text-slate-500">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">New Main App Name</label>
                  <input
                    type="text"
                    value={brandNewName}
                    onChange={(e) => setBrandNewName(e.target.value)}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-semibold"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Type Confirmation Phrase: <span className="font-data text-rose-700 dark:text-rose-300">UNLOCK SGN COMMITTEE HISAAB</span>
                  </label>
                  <input
                    type="text"
                    value={brandPhrase}
                    onChange={(e) => setBrandPhrase(e.target.value)}
                    placeholder="UNLOCK SGN COMMITTEE HISAAB"
                    className="w-full min-h-[40px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-data"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">Audit Reason (min 8 chars)</label>
                  <input
                    type="text"
                    value={brandReason}
                    onChange={(e) => setBrandReason(e.target.value)}
                    placeholder="Reason for modifying protected branding"
                    className="w-full min-h-[40px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">Verification Method</label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(
                      [
                        { k: 'password', l: 'Password' },
                        { k: 'pin', l: 'Owner PIN' },
                        { k: 'firebase', l: 'Google Auth' },
                      ] as const
                    ).map((m) => (
                      <button
                        key={m.k}
                        type="button"
                        onClick={() => {
                          setBrandAuthMode(m.k);
                          setBrandSecret('');
                        }}
                        className={`py-2 px-2 rounded-lg text-[11px] font-bold border ${
                          brandAuthMode === m.k
                            ? 'bg-[#0B4F32] text-white border-[#0B4F32]'
                            : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {m.l}
                      </button>
                    ))}
                  </div>
                </div>

                {brandAuthMode !== 'firebase' && (
                  <input
                    type="password"
                    value={brandSecret}
                    onChange={(e) => setBrandSecret(e.target.value)}
                    placeholder={brandAuthMode === 'pin' ? 'Enter Owner Verification PIN' : 'Enter Owner Password'}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  />
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleProtectedAppNameSubmit(false)}
                    className="flex-1 min-h-[40px] px-3 rounded-xl bg-[#0B4F32] text-white text-xs font-bold"
                  >
                    {busy ? 'Verifying...' : 'Verify & Update Name'}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleProtectedAppNameSubmit(true)}
                    className="min-h-[40px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold"
                  >
                    Reset Default
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Committee Name, Address, Logo & All General App Settings */}
          <form
            onSubmit={handleSaveCommitteeSettings}
            className="lg:col-span-7 rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-5 space-y-4"
          >
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Committee Identity, Logo & Global App Settings
            </h2>

            <div className="flex items-center gap-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800">
              <img
                src={committeeForm.appLogoUrl || COMMITTEE_LOGO_URL}
                alt="Committee Logo"
                referrerPolicy="no-referrer"
                className="w-16 h-16 rounded-full object-contain bg-white p-1 border border-slate-200 shrink-0"
              />
              <div className="flex-1 space-y-2">
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">Committee Official Logo</div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="min-h-[38px] px-3 rounded-xl bg-[#0B4F32] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer">
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload New Logo</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handleLogoUpload(e.target.files?.[0] || null)}
                    />
                  </label>
                  {committeeForm.appLogoUrl && (
                    <button
                      type="button"
                      onClick={() => setCommitteeForm({ ...committeeForm, appLogoUrl: '' })}
                      className="min-h-[38px] px-3 rounded-xl border border-rose-300 text-rose-700 dark:text-rose-300 text-xs font-semibold"
                    >
                      Reset Default Logo
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Committee Name</label>
                <input
                  type="text"
                  required
                  value={committeeForm.committeeName}
                  onChange={(e) => setCommitteeForm({ ...committeeForm, committeeName: e.target.value })}
                  className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Committee Address</label>
                <input
                  type="text"
                  required
                  value={committeeForm.committeeAddress}
                  onChange={(e) => setCommitteeForm({ ...committeeForm, committeeAddress: e.target.value })}
                  className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Default Language</label>
                <select
                  value={committeeForm.defaultLanguage}
                  onChange={(e) => setCommitteeForm({ ...committeeForm, defaultLanguage: e.target.value as Language })}
                  className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                >
                  <option value="en">English</option>
                  <option value="hi">हिन्दी</option>
                  <option value="ur">اردو</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Dual-Approval Limit (₹)</label>
                <input
                  type="number"
                  min={500}
                  value={committeeForm.dualApprovalLimit}
                  onChange={(e) => setCommitteeForm({ ...committeeForm, dualApprovalLimit: Number(e.target.value) })}
                  className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-data"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Monthly Reminder Day (1–28)</label>
                <input
                  type="number"
                  min={1}
                  max={28}
                  value={committeeForm.reminderDayOfMonth}
                  onChange={(e) => setCommitteeForm({ ...committeeForm, reminderDayOfMonth: Number(e.target.value) })}
                  className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-data"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Default Monthly Chanda (₹)</label>
                <input
                  type="number"
                  min={50}
                  value={committeeForm.defaultMonthlyContribution}
                  onChange={(e) => setCommitteeForm({ ...committeeForm, defaultMonthlyContribution: Number(e.target.value) })}
                  className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-data"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
              {(
                [
                  { key: 'memberLoginEnabled', label: 'Enable Member Portal Login' },
                  { key: 'dualApprovalEnabled', label: 'Enable Dual-Admin Expense Approval' },
                  { key: 'autoBackupEnabled', label: 'Enable Automatic Database Backups' },
                  { key: 'hideMemberPhonesForMembers', label: 'Mask Member Phones for Read-Only Users' },
                ] as const
              ).map((item) => (
                <label
                  key={item.key}
                  className="flex items-center gap-2.5 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(committeeForm[item.key])}
                    onChange={(e) => setCommitteeForm({ ...committeeForm, [item.key]: e.target.checked })}
                  />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={busy}
                className="min-h-[44px] px-6 rounded-xl bg-[#0B4F32] hover:bg-[#093F28] text-white text-sm font-bold"
              >
                {busy ? 'Saving...' : 'Save Committee Settings'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TAB 4: BANKS, UPI IDs & QR SCANNER */}
      {subTab === 'banks' && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Bank Accounts, UPI IDs & UPI QR Scanner Management
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Add or delete bank accounts, add/change/remove UPI IDs, and upload/replace/remove UPI QR scanner images.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAddBank(!showAddBank)}
              className="min-h-[42px] px-4 rounded-xl bg-[#0B4F32] hover:bg-[#093F28] text-white text-xs sm:text-sm font-semibold inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              <span>Add Bank Account</span>
            </button>
          </div>

          {showAddBank && (
            <form
              onSubmit={handleAddBank}
              className="rounded-2xl bg-white dark:bg-[#121D18] border-2 border-[#0B4F32]/40 p-5 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Add New Bank Account & UPI / QR</h3>
                <button type="button" onClick={() => setShowAddBank(false)} className="text-slate-400">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                <input
                  type="text"
                  required
                  value={newBank.bankName}
                  onChange={(e) => setNewBank({ ...newBank, bankName: e.target.value })}
                  placeholder="Bank Name (e.g. Bank of India) *"
                  className="min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
                <input
                  type="text"
                  required
                  value={newBank.accountName}
                  onChange={(e) => setNewBank({ ...newBank, accountName: e.target.value })}
                  placeholder="Account Holder Name *"
                  className="min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
                <input
                  type="text"
                  required
                  value={newBank.accountNumber}
                  onChange={(e) => setNewBank({ ...newBank, accountNumber: e.target.value })}
                  placeholder="Account Number *"
                  className="min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-data"
                />
                <input
                  type="text"
                  required
                  value={newBank.ifsc}
                  onChange={(e) => setNewBank({ ...newBank, ifsc: e.target.value.toUpperCase() })}
                  placeholder="IFSC Code *"
                  className="min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-data"
                />
                <input
                  type="text"
                  value={newBank.branch}
                  onChange={(e) => setNewBank({ ...newBank, branch: e.target.value })}
                  placeholder="Branch Name"
                  className="min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
                <input
                  type="text"
                  value={newBank.upiId}
                  onChange={(e) => setNewBank({ ...newBank, upiId: e.target.value })}
                  placeholder="UPI ID (e.g. committee@boi)"
                  className="min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-data"
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="min-h-[40px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold inline-flex items-center gap-2 cursor-pointer">
                  <QrCode className="w-4 h-4 text-[#0B4F32]" />
                  <span>{newBank.qrCodeUrl ? 'QR Scanner Uploaded (Replace)' : 'Upload UPI QR Scanner Image'}</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      try {
                        setBusy(true);
                        const url = await uploadImageFile(f, 'qr');
                        setNewBank((p) => ({ ...p, qrCodeUrl: url }));
                        onNotify('QR Scanner image uploaded.', 'success');
                      } catch (err: any) {
                        onNotify(err?.message || 'QR upload failed.', 'error');
                      } finally {
                        setBusy(false);
                      }
                    }}
                  />
                </label>
                {newBank.qrCodeUrl && (
                  <button
                    type="button"
                    onClick={() => setNewBank({ ...newBank, qrCodeUrl: '' })}
                    className="text-xs text-rose-600 font-semibold"
                  >
                    Remove QR
                  </button>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddBank(false)}
                  className="min-h-[42px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-[42px] px-5 rounded-xl bg-[#0B4F32] text-white text-xs font-bold"
                >
                  {busy ? 'Adding...' : 'Add Bank Account'}
                </button>
              </div>
            </form>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {bankAccounts.map((bank) => (
              <div
                key={bank.id}
                className="rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-5 flex flex-col justify-between gap-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">{bank.bankName}</h3>
                      <span
                        className={`px-2 py-0.5 rounded-md text-[11px] font-bold ${
                          bank.isActive
                            ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200'
                            : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {bank.isActive ? 'ACTIVE' : 'INACTIVE'}
                      </span>
                    </div>
                    <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">{bank.accountName}</div>
                    <div className="text-xs font-data text-slate-500 dark:text-slate-400">
                      A/C: {bank.accountNumber} · IFSC: {bank.ifsc}
                    </div>
                    <div className="text-xs font-data text-[#0B4F32] dark:text-emerald-400 font-semibold pt-1">
                      UPI ID: {bank.upiId || 'Not configured'}
                    </div>
                    <div className="text-xs font-data text-slate-600 dark:text-slate-300">
                      Current Balance: <strong>{formatINR(bank.currentBalance, numerals)}</strong>
                    </div>
                  </div>
                  {bank.qrCodeUrl ? (
                    <img
                      src={bank.qrCodeUrl}
                      alt={`${bank.bankName} UPI QR`}
                      referrerPolicy="no-referrer"
                      className="w-20 h-20 rounded-xl object-contain bg-white p-1 border border-slate-200 shrink-0"
                    />
                  ) : (
                    <div className="w-20 h-20 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 flex flex-col items-center justify-center text-[10px] text-slate-400 shrink-0">
                      <QrCode className="w-5 h-5 mb-1" />
                      <span>No QR</span>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => openEditBank(bank)}
                    className="min-h-[38px] px-3.5 rounded-xl bg-[#0B4F32] text-white text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Edit Bank / UPI / QR</span>
                  </button>
                  {confirmDeleteBankId === bank.id ? (
                    <span className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleDeleteBank(bank)}
                        className="min-h-[38px] px-3 rounded-xl bg-rose-600 text-white text-xs font-bold"
                      >
                        Confirm Remove
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteBankId(null)}
                        className="min-h-[38px] px-3 rounded-xl border border-slate-300 text-xs"
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteBankId(bank.id)}
                      className="min-h-[38px] px-3 rounded-xl border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-semibold inline-flex items-center gap-1.5"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Remove</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Edit Bank Modal */}
          {editingBank && (
            <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
              <form
                onSubmit={handleSaveBankEdit}
                className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-4 shadow-xl"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    Edit Bank Account, UPI ID & QR Scanner
                  </h3>
                  <button type="button" onClick={() => setEditingBank(null)} className="text-slate-400">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Bank Name</label>
                    <input
                      type="text"
                      required
                      value={editBankForm.bankName}
                      onChange={(e) => setEditBankForm({ ...editBankForm, bankName: e.target.value })}
                      className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Account Holder Name</label>
                    <input
                      type="text"
                      required
                      value={editBankForm.accountName}
                      onChange={(e) => setEditBankForm({ ...editBankForm, accountName: e.target.value })}
                      className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Account Number</label>
                    <input
                      type="text"
                      required
                      value={editBankForm.accountNumber}
                      onChange={(e) => setEditBankForm({ ...editBankForm, accountNumber: e.target.value })}
                      className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-data"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">IFSC Code</label>
                    <input
                      type="text"
                      required
                      value={editBankForm.ifsc}
                      onChange={(e) => setEditBankForm({ ...editBankForm, ifsc: e.target.value.toUpperCase() })}
                      className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-data"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">UPI ID</label>
                      {editBankForm.upiId && (
                        <button
                          type="button"
                          onClick={() => setEditBankForm({ ...editBankForm, upiId: '' })}
                          className="text-[11px] font-semibold text-rose-600 hover:underline"
                        >
                          Remove UPI ID
                        </button>
                      )}
                    </div>
                    <input
                      type="text"
                      value={editBankForm.upiId}
                      onChange={(e) => setEditBankForm({ ...editBankForm, upiId: e.target.value })}
                      placeholder="Enter UPI ID (or leave empty to remove)"
                      className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-data"
                    />
                  </div>
                </div>

                {/* QR Scanner Upload / Replace / Remove */}
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-center gap-4">
                  {editBankForm.qrCodeUrl ? (
                    <img
                      src={editBankForm.qrCodeUrl}
                      alt="UPI QR Preview"
                      referrerPolicy="no-referrer"
                      className="w-24 h-24 rounded-xl object-contain bg-white p-1 border border-slate-200 shrink-0"
                    />
                  ) : (
                    <div className="w-24 h-24 rounded-xl border border-dashed border-slate-300 flex items-center justify-center text-xs text-slate-400 shrink-0">
                      No QR Image
                    </div>
                  )}
                  <div className="space-y-2 flex-1">
                    <div className="text-xs font-bold text-slate-700 dark:text-slate-200">UPI QR Scanner Image</div>
                    <div className="flex flex-wrap gap-2">
                      <label className="min-h-[38px] px-3.5 rounded-xl bg-[#0B4F32] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer">
                        <Upload className="w-3.5 h-3.5" />
                        <span>{editBankForm.qrCodeUrl ? 'Replace QR Scanner' : 'Upload QR Scanner'}</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={async (e) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            try {
                              setBusy(true);
                              const url = await uploadImageFile(f, 'qr');
                              setEditBankForm((p) => ({ ...p, qrCodeUrl: url }));
                              onNotify('QR Scanner image uploaded. Click Save to apply.', 'success');
                            } catch (err: any) {
                              onNotify(err?.message || 'QR upload failed.', 'error');
                            } finally {
                              setBusy(false);
                            }
                          }}
                        />
                      </label>
                      {editBankForm.qrCodeUrl && (
                        <button
                          type="button"
                          onClick={() => setEditBankForm({ ...editBankForm, qrCodeUrl: '' })}
                          className="min-h-[38px] px-3.5 rounded-xl border border-rose-300 text-rose-700 dark:text-rose-300 text-xs font-semibold"
                        >
                          Remove QR Scanner
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={editBankForm.isActive}
                    onChange={(e) => setEditBankForm({ ...editBankForm, isActive: e.target.checked })}
                  />
                  <span>Bank Account Active (Visible for Donations & Chanda)</span>
                </label>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setEditingBank(null)}
                    className="min-h-[42px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="min-h-[42px] px-5 rounded-xl bg-[#0B4F32] text-white text-xs font-bold"
                  >
                    {busy ? 'Saving...' : 'Save Bank & UPI Changes'}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}

      {/* TAB 5: OWNER SECURITY & CREDENTIALS */}
      {subTab === 'security' && (
        <div className="max-w-2xl rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-5">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-[#0B4F32] dark:text-emerald-400" />
              <span>Owner Login ID, Password & Verification PIN</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Set or change your custom Owner Login ID and encrypted password (bcrypt hashed). You can also reset your Owner password anytime via verified Firebase Google Auth.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Custom Owner Login ID</label>
              <input
                type="text"
                value={ownerCredForm.username}
                onChange={(e) => setOwnerCredForm({ ...ownerCredForm, username: e.target.value })}
                placeholder="e.g. OWNER-IZHAR"
                className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-data"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Owner Display Name</label>
              <input
                type="text"
                value={ownerCredForm.fullName}
                onChange={(e) => setOwnerCredForm({ ...ownerCredForm, fullName: e.target.value })}
                className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Phone</label>
              <input
                type="text"
                value={ownerCredForm.phone}
                onChange={(e) => setOwnerCredForm({ ...ownerCredForm, phone: e.target.value })}
                className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-data"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                Owner Verification PIN (4–8 digits, optional)
              </label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={8}
                value={ownerCredForm.verificationPin}
                onChange={(e) => setOwnerCredForm({ ...ownerCredForm, verificationPin: e.target.value.replace(/\D/g, '') })}
                placeholder={user.hasOwnerPin ? 'Leave empty to keep existing PIN' : 'Set 4–8 digit PIN'}
                className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-data"
              />
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold text-slate-700 dark:text-slate-200">
                {user.credentialsClaimed ? 'Change / Reset Owner Password' : 'Set Your First Custom Owner Password'}
              </div>
              <button
                type="button"
                onClick={() => setShowOwnerPass(!showOwnerPass)}
                className="text-xs text-slate-500 inline-flex items-center gap-1"
              >
                {showOwnerPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                <span>{showOwnerPass ? 'Hide' : 'Show'}</span>
              </button>
            </div>

            {user.credentialsClaimed && (
              <input
                type={showOwnerPass ? 'text' : 'password'}
                value={ownerCredForm.currentPassword}
                onChange={(e) => setOwnerCredForm({ ...ownerCredForm, currentPassword: e.target.value })}
                placeholder="Current Owner Password (or use Firebase Google Reset button below)"
                className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type={showOwnerPass ? 'text' : 'password'}
                value={ownerCredForm.newPassword}
                onChange={(e) => setOwnerCredForm({ ...ownerCredForm, newPassword: e.target.value })}
                placeholder="New Owner Password (min 8 chars)"
                className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
              <input
                type={showOwnerPass ? 'text' : 'password'}
                value={ownerCredForm.confirmNewPassword}
                onChange={(e) => setOwnerCredForm({ ...ownerCredForm, confirmNewPassword: e.target.value })}
                placeholder="Confirm New Password"
                className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>
          </div>

          <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={ownerCredForm.twoFactorEnabled}
              onChange={(e) => setOwnerCredForm({ ...ownerCredForm, twoFactorEnabled: e.target.checked })}
            />
            <span>Require 2FA Verification Code on Owner Password Login</span>
          </label>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => handleSaveOwnerCredentials(false)}
              className="min-h-[44px] px-5 rounded-xl bg-[#0B4F32] hover:bg-[#093F28] text-white text-xs sm:text-sm font-bold"
            >
              {busy ? 'Saving...' : 'Save Owner Credentials'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => handleSaveOwnerCredentials(true)}
              className="min-h-[44px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold inline-flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <Cloud className="w-4 h-4 text-[#0B4F32]" />
              <span>Reset Password via Firebase Google Verification</span>
            </button>
          </div>
        </div>
      )}

      {/* TAB 6: ACTIVITY & AUDIT LOGS */}
      {subTab === 'activity' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActivityMode('logins')}
              className={`min-h-[40px] px-4 rounded-xl text-xs font-bold ${
                activityMode === 'logins'
                  ? 'bg-[#0B4F32] text-white'
                  : 'bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
              }`}
            >
              All Login Activity ({overview?.loginActivity.length || 0})
            </button>
            <button
              type="button"
              onClick={() => setActivityMode('audits')}
              className={`min-h-[40px] px-4 rounded-xl text-xs font-bold ${
                activityMode === 'audits'
                  ? 'bg-[#0B4F32] text-white'
                  : 'bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
              }`}
            >
              Immutable Audit Trail ({overview?.ownerAuditLogs.length || 0})
            </button>
          </div>

          {activityMode === 'logins' ? (
            <div className="rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 text-[11px] uppercase text-slate-500">
                      <th className="py-3 px-4">Timestamp</th>
                      <th className="py-3 px-4">User / ID</th>
                      <th className="py-3 px-4">Role</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Device / IP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {(overview?.loginActivity || []).map((l) => (
                      <tr key={l.id}>
                        <td className="py-2.5 px-4 font-data whitespace-nowrap">{new Date(l.timestamp).toLocaleString()}</td>
                        <td className="py-2.5 px-4">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">{l.fullName}</div>
                          <div className="font-data text-[11px] text-slate-500">{l.username}</div>
                        </td>
                        <td className="py-2.5 px-4">{roleLabel(l.role as UserRole)}</td>
                        <td className="py-2.5 px-4">
                          <span
                            className={`px-2 py-0.5 rounded-md font-bold uppercase text-[10px] ${
                              l.status === 'success'
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200'
                                : l.status === 'failed'
                                ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200'
                                : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                            }`}
                          >
                            {l.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-slate-500 max-w-xs truncate" title={l.userAgent}>
                          {l.ip} · {l.userAgent}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl bg-white dark:bg-[#121D18] border border-slate-200 dark:border-slate-800 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 text-[11px] uppercase text-slate-500">
                      <th className="py-3 px-4">Timestamp</th>
                      <th className="py-3 px-4">Actor</th>
                      <th className="py-3 px-4">Action</th>
                      <th className="py-3 px-4">Entity</th>
                      <th className="py-3 px-4">Reason / Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {(overview?.ownerAuditLogs || []).map((log) => (
                      <tr key={log.id}>
                        <td className="py-2.5 px-4 font-data whitespace-nowrap">{new Date(log.timestamp).toLocaleString()}</td>
                        <td className="py-2.5 px-4 font-semibold text-slate-900 dark:text-slate-100">{log.adminName}</td>
                        <td className="py-2.5 px-4 font-data text-[#0B4F32] dark:text-emerald-400 font-semibold">{log.action}</td>
                        <td className="py-2.5 px-4 font-data text-slate-500">
                          {log.entityType} / {log.entityId}
                        </td>
                        <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300">{log.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Security Guarantee Footer */}
      <div className="rounded-2xl bg-slate-100/80 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 p-4 flex items-start gap-3 text-xs text-slate-600 dark:text-slate-300">
        <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div>
          <strong>Single-Owner & Data Safety Guarantee:</strong> All existing committee funds, ledgers, transactions, member dues, salaries, and Firebase settings remain intact. Every Owner action is permanently recorded in the immutable audit log.
        </div>
      </div>
    </div>
  );
};
