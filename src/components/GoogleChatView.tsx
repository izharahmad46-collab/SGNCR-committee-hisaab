import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileSpreadsheet,
  Hash,
  Loader2,
  LogOut,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  SmilePlus,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import type { User as FirebaseUser } from 'firebase/auth';
import {
  clearGoogleChatAccessToken,
  FIREBASE_PROJECT_ID,
  getGoogleChatAccessToken,
  GOOGLE_CHAT_CONSOLE_URL,
  initGoogleChatAuth,
  signInWithGoogleChat,
} from '../firebase';
import {
  addSpaceMember,
  buildCommitteeDigestText,
  createChatSpace,
  createMessageReaction,
  deleteChatMessage,
  deleteChatSpace,
  GoogleChatApiError,
  listChatMessages,
  listChatSpaces,
  listSpaceMemberships,
  removeSpaceMember,
  sendChatMessage,
  updateChatMessage,
  type ChatMembership,
  type ChatMessage,
  type ChatSpace,
} from '../lib/googleChatApi';
import type { AppSettings, AuthUser, DashboardSummary, FundSummary, Language, NumeralSystem } from '../types';

interface GoogleChatViewProps {
  user: AuthUser;
  lang: Language;
  numerals: NumeralSystem;
  summary: DashboardSummary | null;
  funds: FundSummary[];
  settings: AppSettings | null;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

type PendingConfirmation =
  | {
      kind: 'send_message';
      title: string;
      description: string;
      preview: string;
      confirmLabel: string;
      destructive?: false;
      payload: { spaceName: string; text: string };
    }
  | {
      kind: 'update_message';
      title: string;
      description: string;
      preview: string;
      confirmLabel: string;
      destructive?: false;
      payload: { messageName: string; text: string };
    }
  | {
      kind: 'delete_message';
      title: string;
      description: string;
      preview: string;
      confirmLabel: string;
      destructive: true;
      payload: { messageName: string };
    }
  | {
      kind: 'create_space';
      title: string;
      description: string;
      preview: string;
      confirmLabel: string;
      destructive?: false;
      payload: { displayName: string; description: string };
    }
  | {
      kind: 'delete_space';
      title: string;
      description: string;
      preview: string;
      confirmLabel: string;
      destructive: true;
      payload: { spaceName: string; displayName: string };
    }
  | {
      kind: 'add_member';
      title: string;
      description: string;
      preview: string;
      confirmLabel: string;
      destructive?: false;
      payload: { spaceName: string; memberEmail: string };
    }
  | {
      kind: 'remove_member';
      title: string;
      description: string;
      preview: string;
      confirmLabel: string;
      destructive: true;
      payload: { membershipName: string; memberLabel: string };
    }
  | {
      kind: 'add_reaction';
      title: string;
      description: string;
      preview: string;
      confirmLabel: string;
      destructive?: false;
      payload: { messageName: string; emoji: string };
    };

const QUICK_REACTIONS = ['👍', '✅', '🤲', '❤️'];

function getSpaceDisplayTitle(space: ChatSpace): string {
  if (space.displayName && space.displayName.trim()) return space.displayName;
  if (space.spaceType === 'DIRECT_MESSAGE') return 'Direct Message';
  if (space.spaceType === 'GROUP_CHAT') return 'Group Conversation';
  return space.name;
}

function getSpaceTypeLabel(space: ChatSpace): string {
  if (space.spaceType === 'DIRECT_MESSAGE') return 'DM';
  if (space.spaceType === 'GROUP_CHAT') return 'Group';
  return 'Space';
}

function formatChatTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function GoogleSignInButton({
  onClick,
  loading,
  label = 'Sign in with Google',
}: {
  onClick: () => void;
  loading: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="gsi-material-button inline-flex items-center justify-center gap-3 px-5 py-2.5 min-h-[44px] rounded-xl bg-white hover:bg-slate-50 active:bg-slate-100 text-[#1F1F1F] border border-[#747775]/40 shadow-xs transition-all font-medium text-sm disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
    >
      <span className="gsi-material-button-icon w-5 h-5 shrink-0 flex items-center justify-center">
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin text-[#4285F4]" />
        ) : (
          <svg
            version="1.1"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 48 48"
            className="w-5 h-5 block"
          >
            <path
              fill="#EA4335"
              d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
            />
            <path
              fill="#4285F4"
              d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
            />
            <path
              fill="#FBBC05"
              d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
            />
            <path
              fill="#34A853"
              d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
            />
            <path fill="none" d="M0 0h48v48H0z" />
          </svg>
        )}
      </span>
      <span className="gsi-material-button-contents font-semibold tracking-[0.01em]">
        {loading ? 'Connecting to Google...' : label}
      </span>
    </button>
  );
}

export function GoogleChatView({
  user,
  numerals,
  summary,
  funds,
  settings,
  onNotify,
}: GoogleChatViewProps) {
  const [needsAuth, setNeedsAuth] = useState(true);
  const [googleUser, setGoogleUser] = useState<FirebaseUser | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // API Data State
  const [spaces, setSpaces] = useState<ChatSpace[]>([]);
  const [selectedSpaceName, setSelectedSpaceName] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [memberships, setMemberships] = useState<ChatMembership[]>([]);

  // UI & Loading State
  const [spaceSearch, setSpaceSearch] = useState('');
  const [loadingSpaces, setLoadingSpaces] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<'messages' | 'members'>('messages');
  const [apiError, setApiError] = useState<{
    message: string;
    isChatAppNotConfigured?: boolean;
    isWorkspaceAccountRequired?: boolean;
    status?: number;
  } | null>(null);

  // Compose & Edit State
  const [draftText, setDraftText] = useState('');
  const [editingMessageName, setEditingMessageName] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [reactionPickerFor, setReactionPickerFor] = useState<string | null>(null);

  // Create Space Modal State
  const [showCreateSpaceModal, setShowCreateSpaceModal] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState('');
  const [newSpaceDesc, setNewSpaceDesc] = useState('');

  // Add Member Input State
  const [newMemberEmail, setNewMemberEmail] = useState('');

  // Mandatory Confirmation Dialog for ALL mutating/destructive Workspace API actions
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const [executingAction, setExecutingAction] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const selectedSpace = useMemo(
    () => spaces.find((s) => s.name === selectedSpaceName) || null,
    [spaces, selectedSpaceName]
  );

  const filteredSpaces = useMemo(() => {
    const q = spaceSearch.trim().toLowerCase();
    if (!q) return spaces;
    return spaces.filter((s) => {
      const title = getSpaceDisplayTitle(s).toLowerCase();
      const desc = (s.spaceDetails?.description || '').toLowerCase();
      return title.includes(q) || desc.includes(q) || s.name.toLowerCase().includes(q);
    });
  }, [spaces, spaceSearch]);

  const handleChatApiError = useCallback(
    (err: unknown) => {
      if (err instanceof GoogleChatApiError) {
        if (err.isAuthExpired) {
          clearGoogleChatAccessToken();
          setNeedsAuth(true);
          setApiError({
            message: 'Your Google Chat session token expired. Please sign in with Google again.',
            status: 401,
          });
          return;
        }
        setApiError({
          message: err.message,
          isChatAppNotConfigured: err.isChatAppNotConfigured,
          isWorkspaceAccountRequired: err.isWorkspaceAccountRequired,
          status: err.status,
        });
        return;
      }
      const msg = err instanceof Error ? err.message : 'Unexpected Google Chat API error.';
      setApiError({ message: msg });
    },
    []
  );

  const fetchSpaces = useCallback(
    async (explicitToken?: string) => {
      const token = explicitToken || (await getGoogleChatAccessToken());
      if (!token) {
        setNeedsAuth(true);
        return;
      }
      setLoadingSpaces(true);
      setApiError(null);
      try {
        const list = await listChatSpaces(token);
        setSpaces(list);
        setSelectedSpaceName((prev) => {
          if (prev && list.some((s) => s.name === prev)) return prev;
          return list[0]?.name || null;
        });
      } catch (err) {
        handleChatApiError(err);
      } finally {
        setLoadingSpaces(false);
      }
    },
    [handleChatApiError]
  );

  const fetchMessages = useCallback(
    async (spaceName: string) => {
      const token = await getGoogleChatAccessToken();
      if (!token) {
        setNeedsAuth(true);
        return;
      }
      setLoadingMessages(true);
      setApiError(null);
      try {
        const list = await listChatMessages(token, spaceName);
        setMessages(list);
      } catch (err) {
        handleChatApiError(err);
      } finally {
        setLoadingMessages(false);
      }
    },
    [handleChatApiError]
  );

  const fetchMemberships = useCallback(
    async (spaceName: string) => {
      const token = await getGoogleChatAccessToken();
      if (!token) {
        setNeedsAuth(true);
        return;
      }
      setLoadingMembers(true);
      try {
        const list = await listSpaceMemberships(token, spaceName);
        setMemberships(list);
      } catch (err) {
        handleChatApiError(err);
      } finally {
        setLoadingMembers(false);
      }
    },
    [handleChatApiError]
  );

  // Observe Firebase Auth + in-memory Google Chat OAuth token on mount
  useEffect(() => {
    const unsub = initGoogleChatAuth(
      (fbUser, token) => {
        setGoogleUser(fbUser);
        setNeedsAuth(false);
        void fetchSpaces(token);
      },
      () => {
        setNeedsAuth(true);
      }
    );
    return () => unsub();
  }, [fetchSpaces]);

  // Load messages & memberships when active space changes
  useEffect(() => {
    if (needsAuth || !selectedSpaceName) {
      setMessages([]);
      setMemberships([]);
      return;
    }
    void fetchMessages(selectedSpaceName);
    void fetchMemberships(selectedSpaceName);
  }, [needsAuth, selectedSpaceName, fetchMessages, fetchMemberships]);

  // Auto-scroll to latest message
  useEffect(() => {
    if (rightPanelTab === 'messages') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, rightPanelTab]);

  const handleGoogleChatLogin = async () => {
    setIsLoggingIn(true);
    setApiError(null);
    try {
      const result = await signInWithGoogleChat();
      setGoogleUser(result.user);
      setNeedsAuth(false);
      onNotify(`Connected Google Chat as ${result.user.email || result.user.displayName}`, 'success');
      await fetchSpaces(result.accessToken);
    } catch (err: any) {
      const msg =
        err?.code === 'auth/popup-closed-by-user'
          ? 'Google sign-in popup was closed before completion.'
          : err?.message || 'Failed to sign in with Google Chat.';
      setApiError({ message: msg });
      onNotify(msg, 'error');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleDisconnectChat = () => {
    clearGoogleChatAccessToken();
    setNeedsAuth(true);
    setSpaces([]);
    setSelectedSpaceName(null);
    setMessages([]);
    setMemberships([]);
    setApiError(null);
    onNotify('Disconnected Google Chat session (in-memory token cleared).', 'success');
  };

  const handleInsertCommitteeDigest = () => {
    const digest = buildCommitteeDigestText({
      settings,
      summary,
      funds,
      numerals,
      senderName: user.fullName || user.username,
    });
    setDraftText((prev) => (prev.trim() ? `${prev.trim()}\n\n${digest}` : digest));
  };

  // --- Confirmation Triggers (NO mutation executes without user clicking Confirm) ---
  const requestSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSpace || !draftText.trim()) return;
    setPendingConfirmation({
      kind: 'send_message',
      title: `Send message to "${getSpaceDisplayTitle(selectedSpace)}"?`,
      description:
        'This will post a real message to Google Chat on behalf of your signed-in Google Workspace account.',
      preview: draftText.trim(),
      confirmLabel: 'Confirm & Send Message',
      payload: {
        spaceName: selectedSpace.name,
        text: draftText.trim(),
      },
    });
  };

  const requestUpdateMessage = (msg: ChatMessage) => {
    if (!editingText.trim()) return;
    setPendingConfirmation({
      kind: 'update_message',
      title: 'Update Google Chat message?',
      description: 'This will overwrite the existing message text in Google Chat.',
      preview: editingText.trim(),
      confirmLabel: 'Confirm & Update',
      payload: {
        messageName: msg.name,
        text: editingText.trim(),
      },
    });
  };

  const requestDeleteMessage = (msg: ChatMessage) => {
    setPendingConfirmation({
      kind: 'delete_message',
      title: 'Permanently delete this message?',
      description:
        'This action cannot be undone. The message will be permanently deleted from Google Chat.',
      preview: msg.text || '(Empty or attachment message)',
      confirmLabel: 'Delete Message',
      destructive: true,
      payload: {
        messageName: msg.name,
      },
    });
  };

  const requestCreateSpace = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSpaceName.trim()) return;
    setPendingConfirmation({
      kind: 'create_space',
      title: `Create new Google Chat space "${newSpaceName.trim()}"?`,
      description:
        'A new Google Chat Space will be created in your Google Workspace organization.',
      preview: newSpaceDesc.trim()
        ? `Space Name: ${newSpaceName.trim()}\nDescription: ${newSpaceDesc.trim()}`
        : `Space Name: ${newSpaceName.trim()}`,
      confirmLabel: 'Create Space',
      payload: {
        displayName: newSpaceName.trim(),
        description: newSpaceDesc.trim(),
      },
    });
  };

  const requestDeleteSpace = () => {
    if (!selectedSpace) return;
    const title = getSpaceDisplayTitle(selectedSpace);
    setPendingConfirmation({
      kind: 'delete_space',
      title: `Delete Google Chat space "${title}"?`,
      description:
        'This permanently deletes the entire Google Chat space, its messages, and memberships. This cannot be undone.',
      preview: `${title} (${selectedSpace.name})`,
      confirmLabel: 'Permanently Delete Space',
      destructive: true,
      payload: {
        spaceName: selectedSpace.name,
        displayName: title,
      },
    });
  };

  const requestAddMember = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSpace || !newMemberEmail.trim()) return;
    const cleanEmail = newMemberEmail.trim();
    setPendingConfirmation({
      kind: 'add_member',
      title: `Add member to "${getSpaceDisplayTitle(selectedSpace)}"?`,
      description:
        'The specified Google Workspace user will be added as a member of this Google Chat space.',
      preview: `User: ${cleanEmail}\nTarget Space: ${getSpaceDisplayTitle(selectedSpace)}`,
      confirmLabel: 'Add Member',
      payload: {
        spaceName: selectedSpace.name,
        memberEmail: cleanEmail,
      },
    });
  };

  const requestRemoveMember = (membership: ChatMembership) => {
    if (!selectedSpace) return;
    const label = membership.member?.displayName || membership.member?.name || membership.name;
    setPendingConfirmation({
      kind: 'remove_member',
      title: `Remove "${label}" from "${getSpaceDisplayTitle(selectedSpace)}"?`,
      description: 'This user will lose access to this Google Chat space until re-added.',
      preview: `Member: ${label}\nSpace: ${getSpaceDisplayTitle(selectedSpace)}`,
      confirmLabel: 'Remove Member',
      destructive: true,
      payload: {
        membershipName: membership.name,
        memberLabel: label,
      },
    });
  };

  const requestAddReaction = (msg: ChatMessage, emoji: string) => {
    setReactionPickerFor(null);
    setPendingConfirmation({
      kind: 'add_reaction',
      title: `Add reaction ${emoji} to message?`,
      description: 'This will add an emoji reaction to this message in Google Chat.',
      preview: `${emoji} on: "${(msg.text || 'Message').slice(0, 140)}"`,
      confirmLabel: `Confirm ${emoji} Reaction`,
      payload: {
        messageName: msg.name,
        emoji,
      },
    });
  };

  // --- Execute Confirmed Action ---
  const handleConfirmAction = async () => {
    if (!pendingConfirmation) return;
    const token = await getGoogleChatAccessToken();
    if (!token) {
      setPendingConfirmation(null);
      setNeedsAuth(true);
      onNotify('Please sign in with Google to continue.', 'error');
      return;
    }

    setExecutingAction(true);
    setApiError(null);
    try {
      switch (pendingConfirmation.kind) {
        case 'send_message': {
          await sendChatMessage(
            token,
            pendingConfirmation.payload.spaceName,
            pendingConfirmation.payload.text
          );
          setDraftText('');
          onNotify('Message sent to Google Chat.', 'success');
          await fetchMessages(pendingConfirmation.payload.spaceName);
          break;
        }
        case 'update_message': {
          await updateChatMessage(
            token,
            pendingConfirmation.payload.messageName,
            pendingConfirmation.payload.text
          );
          setEditingMessageName(null);
          setEditingText('');
          onNotify('Message updated in Google Chat.', 'success');
          if (selectedSpaceName) await fetchMessages(selectedSpaceName);
          break;
        }
        case 'delete_message': {
          await deleteChatMessage(token, pendingConfirmation.payload.messageName);
          onNotify('Message deleted from Google Chat.', 'success');
          if (selectedSpaceName) await fetchMessages(selectedSpaceName);
          break;
        }
        case 'create_space': {
          const created = await createChatSpace(token, pendingConfirmation.payload);
          setShowCreateSpaceModal(false);
          setNewSpaceName('');
          setNewSpaceDesc('');
          onNotify(`Created space "${created.displayName || pendingConfirmation.payload.displayName}".`, 'success');
          await fetchSpaces(token);
          if (created.name) setSelectedSpaceName(created.name);
          break;
        }
        case 'delete_space': {
          await deleteChatSpace(token, pendingConfirmation.payload.spaceName);
          onNotify(`Deleted space "${pendingConfirmation.payload.displayName}".`, 'success');
          setSelectedSpaceName(null);
          await fetchSpaces(token);
          break;
        }
        case 'add_member': {
          await addSpaceMember(
            token,
            pendingConfirmation.payload.spaceName,
            pendingConfirmation.payload.memberEmail
          );
          setNewMemberEmail('');
          onNotify(`Added ${pendingConfirmation.payload.memberEmail} to space.`, 'success');
          await fetchMemberships(pendingConfirmation.payload.spaceName);
          break;
        }
        case 'remove_member': {
          await removeSpaceMember(token, pendingConfirmation.payload.membershipName);
          onNotify(`Removed ${pendingConfirmation.payload.memberLabel} from space.`, 'success');
          if (selectedSpaceName) await fetchMemberships(selectedSpaceName);
          break;
        }
        case 'add_reaction': {
          await createMessageReaction(
            token,
            pendingConfirmation.payload.messageName,
            pendingConfirmation.payload.emoji
          );
          onNotify(`Added reaction ${pendingConfirmation.payload.emoji}.`, 'success');
          if (selectedSpaceName) await fetchMessages(selectedSpaceName);
          break;
        }
      }
      setPendingConfirmation(null);
    } catch (err) {
      setPendingConfirmation(null);
      handleChatApiError(err);
      onNotify(err instanceof Error ? err.message : 'Google Chat action failed.', 'error');
    } finally {
      setExecutingAction(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header Bar */}
      <div className="bg-white dark:bg-[#111B16] rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-[#0B4F32]/10 dark:bg-emerald-950/60 border border-[#0B4F32]/20 dark:border-emerald-800/60 flex items-center justify-center text-[#0B4F32] dark:text-emerald-400 shrink-0">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              Google Chat Workspace
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Connect Google Chat spaces to coordinate committee discussions and share live S.G.N Committee financial snapshots.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!needsAuth && googleUser ? (
            <>
              <div className="px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800/60 text-xs text-emerald-900 dark:text-emerald-200 flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span className="font-semibold truncate max-w-[200px]">
                  {googleUser.email || googleUser.displayName}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void fetchSpaces()}
                disabled={loadingSpaces}
                className="min-h-[38px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingSpaces ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
              <button
                type="button"
                onClick={handleDisconnectChat}
                className="min-h-[38px] px-3 rounded-xl border border-rose-200 dark:border-rose-900/60 text-xs font-semibold text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 inline-flex items-center gap-1.5"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Disconnect</span>
              </button>
            </>
          ) : (
            <GoogleSignInButton onClick={handleGoogleChatLogin} loading={isLoggingIn} />
          )}
        </div>
      </div>

      {/* API Error Alert (Explicitly handles 404 Chat App Not Configured & 403 Workspace prerequisites) */}
      {apiError && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 rounded-2xl p-4 space-y-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1.5 min-w-0 flex-1">
              <div className="text-sm font-bold text-amber-950 dark:text-amber-200">
                {apiError.isChatAppNotConfigured
                  ? 'Google Chat App Not Configured in Google Cloud Console (HTTP 404)'
                  : apiError.isWorkspaceAccountRequired
                  ? 'Google Workspace Business / Enterprise Account Required'
                  : `Google Chat API Notice${apiError.status ? ` (HTTP ${apiError.status})` : ''}`}
              </div>
              <p className="text-xs text-amber-900 dark:text-amber-200/90 break-words font-mono bg-amber-100/70 dark:bg-amber-950/80 px-3 py-2 rounded-lg border border-amber-200/80 dark:border-amber-900">
                {apiError.message}
              </p>
              <div className="text-xs text-amber-900/90 dark:text-amber-200/80 space-y-1 pt-1">
                {apiError.isChatAppNotConfigured && (
                  <p>
                    Complete the one-time setup in Google Cloud Console under{' '}
                    <strong>Google Chat API &rarr; Configuration</strong> (set App name, Avatar URL, and Description) for project{' '}
                    <code className="font-mono font-semibold">{FIREBASE_PROJECT_ID}</code>, then click Refresh.
                  </p>
                )}
                {apiError.isWorkspaceAccountRequired && (
                  <p>
                    Google Chat API requires a <strong>Business or Enterprise Google Workspace account</strong> with Google Chat enabled. Standard personal <code>@gmail.com</code> accounts are not supported by Google Chat API.
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <a
                  href={GOOGLE_CHAT_CONSOLE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#0B4F32] hover:bg-[#093E27] text-white text-xs font-semibold transition-colors"
                >
                  <span>Open Google Chat API Configuration</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
                <button
                  type="button"
                  onClick={() => void fetchSpaces()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-amber-400/70 dark:border-amber-700 text-amber-950 dark:text-amber-200 text-xs font-semibold hover:bg-amber-100/60 dark:hover:bg-amber-900/40"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Retry Connection</span>
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setApiError(null)}
              className="text-amber-700 dark:text-amber-400 hover:text-amber-950 p-1"
              aria-label="Dismiss error"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Unauthenticated Gate + Prerequisites Info */}
      {needsAuth ? (
        <div className="bg-white dark:bg-[#111B16] rounded-2xl border border-slate-200 dark:border-slate-800 p-6 sm:p-8 max-w-3xl mx-auto space-y-6">
          <div className="text-center space-y-3">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-[#0B4F32]/10 dark:bg-emerald-950/60 border border-[#0B4F32]/20 dark:border-emerald-800/60 flex items-center justify-center text-[#0B4F32] dark:text-emerald-400">
              <MessageSquare className="w-7 h-7" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              Connect Your Google Workspace Chat Account
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 max-w-lg mx-auto">
              Sign in with Google to view spaces, read committee messages, manage members, and share S.G.N Committee financial updates directly into Google Chat.
            </p>
            <div className="pt-2 flex justify-center">
              <GoogleSignInButton onClick={handleGoogleChatLogin} loading={isLoggingIn} />
            </div>
          </div>

          {/* Prerequisites Notice (Per Google Chat API Requirements) */}
          <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300">
              <ShieldAlert className="w-4 h-4 text-[#0B4F32] dark:text-emerald-400" />
              <span>Google Chat API Prerequisites</span>
            </div>
            <ol className="list-decimal list-inside space-y-2 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              <li>
                <strong>Google Workspace Account Required:</strong> You must sign in with a{' '}
                <strong>Business or Enterprise Google Workspace account</strong> that has Google Chat enabled. Personal consumer{' '}
                <code className="font-mono text-[11px] px-1 py-0.5 rounded bg-slate-200/70 dark:bg-slate-800">@gmail.com</code> accounts are not supported by Google Chat API.
              </li>
              <li>
                <strong>One-Time Chat App Configuration:</strong> Before spaces and messages load, configure the Chat app profile (App name, Avatar URL, and Description) in Google Cloud Console for project{' '}
                <code className="font-mono text-[11px] px-1 py-0.5 rounded bg-slate-200/70 dark:bg-slate-800">{FIREBASE_PROJECT_ID}</code>:
                <div className="mt-2">
                  <a
                    href={GOOGLE_CHAT_CONSOLE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-[#0B4F32] dark:text-emerald-400 font-semibold hover:underline"
                  >
                    <span>Configure Google Chat App in Google Cloud Console</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </li>
              <li>
                <strong>Confirmation Safeguard:</strong> Every action that sends, edits, or deletes messages, manages members, or creates/deletes spaces will always show an explicit confirmation dialog before executing.
              </li>
            </ol>
          </div>
        </div>
      ) : (
        /* Main Authenticated 2-Pane Google Chat Workspace */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-[580px]">
          {/* Left Column: Spaces List */}
          <div className="lg:col-span-4 bg-white dark:bg-[#111B16] rounded-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden">
            <div className="p-3.5 border-b border-slate-200 dark:border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Spaces ({spaces.length})
                </span>
                <button
                  type="button"
                  onClick={() => setShowCreateSpaceModal(true)}
                  className="min-h-[34px] px-2.5 rounded-lg bg-[#0B4F32] hover:bg-[#093E27] text-white text-xs font-semibold inline-flex items-center gap-1 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>New Space</span>
                </button>
              </div>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={spaceSearch}
                  onChange={(e) => setSpaceSearch(e.target.value)}
                  placeholder="Filter spaces..."
                  className="w-full pl-8 pr-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0B4F32]"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/70 max-h-[520px]">
              {loadingSpaces ? (
                <div className="p-8 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin text-[#0B4F32]" />
                  <span>Loading Google Chat spaces...</span>
                </div>
              ) : filteredSpaces.length === 0 ? (
                <div className="p-6 text-center space-y-2">
                  <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    No Google Chat spaces found
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Create a new committee space above or check that your Google Workspace Chat App is configured in Cloud Console.
                  </p>
                </div>
              ) : (
                filteredSpaces.map((space) => {
                  const active = space.name === selectedSpaceName;
                  return (
                    <button
                      key={space.name}
                      type="button"
                      onClick={() => {
                        setSelectedSpaceName(space.name);
                        setRightPanelTab('messages');
                        setEditingMessageName(null);
                      }}
                      className={`w-full text-left px-3.5 py-3 flex items-start gap-2.5 transition-colors ${
                        active
                          ? 'bg-[#0B4F32]/10 dark:bg-emerald-950/50 border-l-4 border-[#0B4F32] dark:border-emerald-400'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                          active
                            ? 'bg-[#0B4F32] text-white'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        <Hash className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                            {getSpaceDisplayTitle(space)}
                          </span>
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 shrink-0">
                            {getSpaceTypeLabel(space)}
                          </span>
                        </div>
                        {space.spaceDetails?.description && (
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                            {space.spaceDetails.description}
                          </p>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Column: Messages & Space Members */}
          <div className="lg:col-span-8 bg-white dark:bg-[#111B16] rounded-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden">
            {!selectedSpace ? (
              <div className="flex-1 flex flex-col items-center justify-center p-10 text-center space-y-2">
                <MessageSquare className="w-8 h-8 text-slate-300 dark:text-slate-700" />
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  Select a Google Chat space
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm">
                  Choose any space from the list to view live messages, manage space members, or share committee financial updates.
                </p>
              </div>
            ) : (
              <>
                {/* Space Top Header */}
                <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                        {getSpaceDisplayTitle(selectedSpace)}
                      </h2>
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/70 text-[#0B4F32] dark:text-emerald-300">
                        {getSpaceTypeLabel(selectedSpace)}
                      </span>
                    </div>
                    {selectedSpace.spaceDetails?.description && (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        {selectedSpace.spaceDetails.description}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <div className="inline-flex p-0.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                      <button
                        type="button"
                        onClick={() => setRightPanelTab('messages')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                          rightPanelTab === 'messages'
                            ? 'bg-[#0B4F32] text-white'
                            : 'text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        Messages
                      </button>
                      <button
                        type="button"
                        onClick={() => setRightPanelTab('members')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1 transition-colors ${
                          rightPanelTab === 'members'
                            ? 'bg-[#0B4F32] text-white'
                            : 'text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        <Users className="w-3.5 h-3.5" />
                        <span>Members ({memberships.length})</span>
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        void fetchMessages(selectedSpace.name);
                        void fetchMemberships(selectedSpace.name);
                      }}
                      title="Refresh conversation"
                      className="min-h-[34px] min-w-[34px] inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${loadingMessages ? 'animate-spin' : ''}`} />
                    </button>

                    {selectedSpace.spaceType === 'SPACE' && (
                      <button
                        type="button"
                        onClick={requestDeleteSpace}
                        title="Delete space"
                        className="min-h-[34px] min-w-[34px] inline-flex items-center justify-center rounded-lg border border-rose-200 dark:border-rose-900/60 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {rightPanelTab === 'messages' ? (
                  <>
                    {/* Messages Feed */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[430px] bg-slate-50/50 dark:bg-[#0D1612]">
                      {loadingMessages ? (
                        <div className="py-12 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
                          <Loader2 className="w-5 h-5 animate-spin text-[#0B4F32]" />
                          <span>Loading messages...</span>
                        </div>
                      ) : messages.length === 0 ? (
                        <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400">
                          No messages in this space yet. Compose a message or insert a Committee Financial Digest below.
                        </div>
                      ) : (
                        messages.map((msg) => {
                          const isEditing = editingMessageName === msg.name;
                          const senderLabel =
                            msg.sender?.displayName || msg.sender?.name || 'Workspace Member';
                          return (
                            <div
                              key={msg.name}
                              className="bg-white dark:bg-[#13201A] rounded-xl border border-slate-200/90 dark:border-slate-800 p-3.5 space-y-2 shadow-2xs"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="text-xs font-bold text-[#0B4F32] dark:text-emerald-400 truncate">
                                    {senderLabel}
                                  </span>
                                  <span className="text-[11px] text-slate-400 whitespace-nowrap">
                                    {formatChatTime(msg.createTime)}
                                    {msg.lastUpdateTime ? ' · edited' : ''}
                                  </span>
                                </div>

                                <div className="flex items-center gap-1 relative">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setReactionPickerFor((prev) =>
                                        prev === msg.name ? null : msg.name
                                      )
                                    }
                                    title="Add reaction"
                                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                                  >
                                    <SmilePlus className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingMessageName(msg.name);
                                      setEditingText(msg.text || '');
                                    }}
                                    title="Edit message"
                                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => requestDeleteMessage(msg)}
                                    title="Delete message"
                                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>

                                  {reactionPickerFor === msg.name && (
                                    <div className="absolute right-0 top-8 z-20 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg px-2 py-1.5 flex items-center gap-1">
                                      {QUICK_REACTIONS.map((emoji) => (
                                        <button
                                          key={emoji}
                                          type="button"
                                          onClick={() => requestAddReaction(msg, emoji)}
                                          className="w-7 h-7 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-sm"
                                        >
                                          {emoji}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>

                              {isEditing ? (
                                <div className="space-y-2 pt-1">
                                  <textarea
                                    value={editingText}
                                    onChange={(e) => setEditingText(e.target.value)}
                                    rows={3}
                                    className="w-full p-2.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0B4F32]"
                                  />
                                  <div className="flex items-center justify-end gap-2">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingMessageName(null);
                                        setEditingText('');
                                      }}
                                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => requestUpdateMessage(msg)}
                                      disabled={!editingText.trim()}
                                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#0B4F32] text-white hover:bg-[#093E27] disabled:opacity-50"
                                    >
                                      Review & Save
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="text-xs sm:text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap break-words leading-relaxed">
                                  {msg.text || '(No text content)'}
                                </div>
                              )}

                              {msg.emojiReactionSummaries && msg.emojiReactionSummaries.length > 0 && (
                                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                                  {msg.emojiReactionSummaries.map((r, idx) => (
                                    <span
                                      key={`${msg.name}-react-${idx}`}
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700"
                                    >
                                      <span>{r.emoji?.unicode || '✨'}</span>
                                      <span className="font-semibold text-[11px]">
                                        {r.reactionCount ?? 1}
                                      </span>
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                      <div ref={messagesEndRef} />
                    </div>

                    {/* Message Composer */}
                    <form
                      onSubmit={requestSendMessage}
                      className="p-3.5 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111B16] space-y-2.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={handleInsertCommitteeDigest}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-[#0B4F32] dark:text-emerald-300 text-xs font-semibold hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition-colors"
                        >
                          <FileSpreadsheet className="w-3.5 h-3.5" />
                          <span>Insert Committee Financial Digest</span>
                        </button>
                        <span className="text-[11px] text-slate-400">
                          Confirmation required before posting
                        </span>
                      </div>

                      <div className="flex items-end gap-2">
                        <textarea
                          value={draftText}
                          onChange={(e) => setDraftText(e.target.value)}
                          rows={2}
                          placeholder={`Write a message to ${getSpaceDisplayTitle(selectedSpace)}...`}
                          className="flex-1 px-3.5 py-2.5 text-sm rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0B4F32] resize-y"
                        />
                        <button
                          type="submit"
                          disabled={!draftText.trim()}
                          className="min-h-[44px] px-4 rounded-xl bg-[#0B4F32] hover:bg-[#093E27] text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
                        >
                          <Send className="w-4 h-4" />
                          <span>Send</span>
                        </button>
                      </div>
                    </form>
                  </>
                ) : (
                  /* Space Members Panel */
                  <div className="flex-1 p-4 space-y-4 overflow-y-auto max-h-[520px]">
                    <form
                      onSubmit={requestAddMember}
                      className="flex flex-col sm:flex-row gap-2 bg-slate-50 dark:bg-slate-900/60 p-3 rounded-xl border border-slate-200 dark:border-slate-800"
                    >
                      <input
                        type="email"
                        value={newMemberEmail}
                        onChange={(e) => setNewMemberEmail(e.target.value)}
                        placeholder="Workspace user email (e.g., secretary@yourdomain.org)"
                        className="flex-1 px-3 py-2 text-xs rounded-lg bg-white dark:bg-[#111B16] border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0B4F32]"
                      />
                      <button
                        type="submit"
                        disabled={!newMemberEmail.trim()}
                        className="min-h-[38px] px-3.5 rounded-lg bg-[#0B4F32] hover:bg-[#093E27] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        <span>Add Member</span>
                      </button>
                    </form>

                    {loadingMembers ? (
                      <div className="py-10 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
                        <Loader2 className="w-5 h-5 animate-spin text-[#0B4F32]" />
                        <span>Loading space members...</span>
                      </div>
                    ) : memberships.length === 0 ? (
                      <p className="text-xs text-slate-500 text-center py-8">
                        No members returned for this space.
                      </p>
                    ) : (
                      <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                        {memberships.map((m) => (
                          <div
                            key={m.name}
                            className="px-3.5 py-3 bg-white dark:bg-[#13201A] flex items-center justify-between gap-3"
                          >
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                                {m.member?.displayName || m.member?.name || 'Member'}
                              </div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                {m.role === 'ROLE_MANAGER' ? 'Space Manager' : 'Member'} · {m.state || 'JOINED'}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => requestRemoveMember(m)}
                              className="min-h-[32px] px-2.5 rounded-lg border border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-400 text-xs font-semibold hover:bg-rose-50 dark:hover:bg-rose-950/30 inline-flex items-center gap-1"
                            >
                              <UserMinus className="w-3.5 h-3.5" />
                              <span>Remove</span>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Create Space Input Modal */}
      {showCreateSpaceModal && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setShowCreateSpaceModal(false)}
        >
          <form
            onSubmit={requestCreateSpace}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-white dark:bg-[#121D18] rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Create Google Chat Space
              </h3>
              <button
                type="button"
                onClick={() => setShowCreateSpaceModal(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Space Display Name
                </label>
                <input
                  type="text"
                  required
                  maxLength={128}
                  value={newSpaceName}
                  onChange={(e) => setNewSpaceName(e.target.value)}
                  placeholder="e.g., S.G.N Committee Finance & Chanda"
                  className="w-full px-3 py-2 text-sm rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0B4F32]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Description (Optional)
                </label>
                <textarea
                  rows={2}
                  maxLength={250}
                  value={newSpaceDesc}
                  onChange={(e) => setNewSpaceDesc(e.target.value)}
                  placeholder="Official coordination space for Noori Jama Masjid & Madarsa Anwarool Uloom committee members."
                  className="w-full px-3 py-2 text-sm rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0B4F32]"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowCreateSpaceModal(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!newSpaceName.trim()}
                className="px-4 py-2 rounded-xl bg-[#0B4F32] hover:bg-[#093E27] text-white text-xs font-semibold disabled:opacity-50"
              >
                Continue to Confirm
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MANDATORY Explicit Confirmation Dialog for All Mutating / Destructive Operations */}
      {pendingConfirmation && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => !executingAction && setPendingConfirmation(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg bg-white dark:bg-[#121D18] rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-start gap-3">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  pendingConfirmation.destructive
                    ? 'bg-rose-100 dark:bg-rose-950/70 text-rose-700 dark:text-rose-400'
                    : 'bg-emerald-100 dark:bg-emerald-950/70 text-[#0B4F32] dark:text-emerald-400'
                }`}
              >
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  {pendingConfirmation.title}
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                  {pendingConfirmation.description}
                </p>
              </div>
            </div>

            <div className="rounded-xl bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-3 max-h-52 overflow-y-auto">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Action Preview
              </div>
              <pre className="text-xs text-slate-800 dark:text-slate-200 whitespace-pre-wrap break-words font-sans leading-relaxed">
                {pendingConfirmation.preview}
              </pre>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={executingAction}
                onClick={() => setPendingConfirmation(null)}
                className="min-h-[40px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={executingAction}
                onClick={() => void handleConfirmAction()}
                className={`min-h-[40px] px-4 rounded-xl text-xs font-semibold text-white inline-flex items-center gap-1.5 disabled:opacity-60 ${
                  pendingConfirmation.destructive
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-[#0B4F32] hover:bg-[#093E27]'
                }`}
              >
                {executingAction && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{pendingConfirmation.confirmLabel}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
