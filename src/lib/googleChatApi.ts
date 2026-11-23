import { formatINR } from '../i18n/translations';
import type { AppSettings, DashboardSummary, FundSummary, NumeralSystem } from '../types';

const CHAT_API_BASE = 'https://chat.googleapis.com/v1';

export interface ChatSpace {
  name: string; // e.g., "spaces/AAAA..."
  type?: string;
  spaceType?: 'SPACE' | 'GROUP_CHAT' | 'DIRECT_MESSAGE' | string;
  displayName?: string;
  singleUserBotDm?: boolean;
  spaceThreadingState?: string;
  spaceDetails?: {
    description?: string;
    guidelines?: string;
  };
  externalUserAllowed?: boolean;
  membershipCount?: {
    joinedDirectHumanUserCount?: number;
    joinedGroupCount?: number;
  };
  createTime?: string;
  lastActiveTime?: string;
  spaceUri?: string;
}

export interface ChatEmoji {
  unicode?: string;
  customEmoji?: {
    uid?: string;
    name?: string;
    emojiName?: string;
    temporaryImageUri?: string;
  };
}

export interface ChatEmojiReactionSummary {
  emoji?: ChatEmoji;
  reactionCount?: number;
}

export interface ChatMessage {
  name: string; // e.g., "spaces/AAAA/messages/BBBB"
  sender?: {
    name?: string;
    displayName?: string;
    type?: 'HUMAN' | 'BOT' | string;
  };
  createTime?: string;
  lastUpdateTime?: string;
  text?: string;
  formattedText?: string;
  thread?: {
    name?: string;
  };
  emojiReactionSummaries?: ChatEmojiReactionSummary[];
}

export interface ChatMembership {
  name: string; // e.g., "spaces/AAAA/members/BBBB"
  state?: 'JOINED' | 'INVITED' | 'NOT_A_MEMBER' | string;
  role?: 'ROLE_MEMBER' | 'ROLE_MANAGER' | string;
  createTime?: string;
  member?: {
    name?: string;
    displayName?: string;
    type?: 'HUMAN' | 'BOT' | string;
  };
}

export interface ChatReaction {
  name: string;
  user?: {
    name?: string;
    displayName?: string;
  };
  emoji?: ChatEmoji;
}

export class GoogleChatApiError extends Error {
  status: number;
  apiStatus?: string;
  isAuthExpired: boolean;
  isChatAppNotConfigured: boolean;
  isWorkspaceAccountRequired: boolean;

  constructor(
    message: string,
    status: number,
    apiStatus?: string
  ) {
    super(message);
    this.name = 'GoogleChatApiError';
    this.status = status;
    this.apiStatus = apiStatus;
    const lower = message.toLowerCase();
    this.isAuthExpired = status === 401;
    this.isChatAppNotConfigured =
      status === 404 ||
      lower.includes('google chat app not found') ||
      lower.includes('configure the app in the google cloud console');
    this.isWorkspaceAccountRequired =
      status === 403 &&
      (lower.includes('workspace') ||
        lower.includes('consumer') ||
        lower.includes('not supported') ||
        lower.includes('permission') ||
        lower.includes('access'));
  }
}

async function chatFetch<T>(
  accessToken: string,
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = path.startsWith('http') ? path : `${CHAT_API_BASE}/${path.replace(/^\/+/, '')}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });

  const rawText = await res.text();
  let parsed: any = null;
  if (rawText) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = null;
    }
  }

  if (!res.ok) {
    const apiMessage =
      parsed?.error?.message ||
      rawText ||
      `Google Chat API request failed with HTTP ${res.status}`;
    const apiStatus = parsed?.error?.status;
    throw new GoogleChatApiError(apiMessage, res.status, apiStatus);
  }

  return (parsed ?? {}) as T;
}

export async function listChatSpaces(accessToken: string): Promise<ChatSpace[]> {
  const data = await chatFetch<{ spaces?: ChatSpace[] }>(
    accessToken,
    'spaces?pageSize=100'
  );
  return data.spaces || [];
}

export async function createChatSpace(
  accessToken: string,
  params: { displayName: string; description?: string }
): Promise<ChatSpace> {
  const body: Record<string, any> = {
    spaceType: 'SPACE',
    displayName: params.displayName.trim(),
  };
  if (params.description?.trim()) {
    body.spaceDetails = {
      description: params.description.trim(),
    };
  }
  return chatFetch<ChatSpace>(accessToken, 'spaces', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function deleteChatSpace(
  accessToken: string,
  spaceName: string
): Promise<void> {
  await chatFetch<Record<string, never>>(accessToken, spaceName, {
    method: 'DELETE',
  });
}

export async function listChatMessages(
  accessToken: string,
  spaceName: string
): Promise<ChatMessage[]> {
  const data = await chatFetch<{ messages?: ChatMessage[] }>(
    accessToken,
    `${spaceName}/messages?pageSize=50&orderBy=createTime%20desc`
  );
  // Reverse so chronological oldest->newest displays naturally in conversation pane
  return (data.messages || []).slice().reverse();
}

export async function sendChatMessage(
  accessToken: string,
  spaceName: string,
  text: string
): Promise<ChatMessage> {
  return chatFetch<ChatMessage>(accessToken, `${spaceName}/messages`, {
    method: 'POST',
    body: JSON.stringify({ text: text.trim() }),
  });
}

export async function updateChatMessage(
  accessToken: string,
  messageName: string,
  text: string
): Promise<ChatMessage> {
  return chatFetch<ChatMessage>(
    accessToken,
    `${messageName}?updateMask=text`,
    {
      method: 'PATCH',
      body: JSON.stringify({ text: text.trim() }),
    }
  );
}

export async function deleteChatMessage(
  accessToken: string,
  messageName: string
): Promise<void> {
  await chatFetch<Record<string, never>>(accessToken, messageName, {
    method: 'DELETE',
  });
}

export async function listSpaceMemberships(
  accessToken: string,
  spaceName: string
): Promise<ChatMembership[]> {
  const data = await chatFetch<{ memberships?: ChatMembership[] }>(
    accessToken,
    `${spaceName}/members?pageSize=100`
  );
  return data.memberships || [];
}

export async function addSpaceMember(
  accessToken: string,
  spaceName: string,
  memberEmailOrId: string
): Promise<ChatMembership> {
  const clean = memberEmailOrId.trim();
  const userName = clean.startsWith('users/') ? clean : `users/${clean}`;
  return chatFetch<ChatMembership>(accessToken, `${spaceName}/members`, {
    method: 'POST',
    body: JSON.stringify({
      member: {
        name: userName,
        type: 'HUMAN',
      },
    }),
  });
}

export async function removeSpaceMember(
  accessToken: string,
  membershipName: string
): Promise<void> {
  await chatFetch<Record<string, never>>(accessToken, membershipName, {
    method: 'DELETE',
  });
}

export async function listMessageReactions(
  accessToken: string,
  messageName: string
): Promise<ChatReaction[]> {
  const data = await chatFetch<{ reactions?: ChatReaction[] }>(
    accessToken,
    `${messageName}/reactions?pageSize=50`
  );
  return data.reactions || [];
}

export async function createMessageReaction(
  accessToken: string,
  messageName: string,
  unicodeEmoji: string
): Promise<ChatReaction> {
  return chatFetch<ChatReaction>(accessToken, `${messageName}/reactions`, {
    method: 'POST',
    body: JSON.stringify({
      emoji: { unicode: unicodeEmoji },
    }),
  });
}

export async function deleteMessageReaction(
  accessToken: string,
  reactionName: string
): Promise<void> {
  await chatFetch<Record<string, never>>(accessToken, reactionName, {
    method: 'DELETE',
  });
}

export function buildCommitteeDigestText(params: {
  settings: AppSettings | null;
  summary: DashboardSummary | null;
  funds: FundSummary[];
  numerals: NumeralSystem;
  senderName: string;
}): string {
  const { settings, summary, funds, numerals, senderName } = params;
  const committeeName =
    settings?.committeeName || 'S.G.N Committee Noori Jama Masjid & Madarsa Anwarool Uloom';
  const dateStr = new Date().toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  if (!summary) {
    return `*${committeeName}*\nFinancial Update (${dateStr})\nShared by: ${senderName}`;
  }

  const topFunds = funds
    .slice(0, 6)
    .map((f) => `• ${f.nameEn}: ${formatINR(f.currentBalance, numerals)}`)
    .join('\n');

  return [
    `*${committeeName}*`,
    `Official Financial Snapshot (${dateStr})`,
    '',
    `• Total Committee Balance: *${formatINR(summary.totalBalance, numerals)}*`,
    `• Bank Balance: ${formatINR(summary.totalBankBalance, numerals)} | Cash in Hand: ${formatINR(summary.totalCashBalance, numerals)}`,
    `• Monthly Income: ${formatINR(summary.monthlyIncome, numerals)} | Monthly Expenses: ${formatINR(summary.monthlyExpense, numerals)}`,
    `• Contributions Received: ${formatINR(summary.totalContributionsReceived, numerals)} | Outstanding: ${formatINR(summary.totalOutstandingContributions, numerals)}`,
    `• Pending Approvals: ${summary.pendingApprovalsCount} | Pending UPI Verifications: ${summary.pendingVerificationsCount}`,
    topFunds ? `\n*Key Fund Balances:*\n${topFunds}` : '',
    '',
    `Shared from S.G.N Committee Hisaab by ${senderName}`,
  ]
    .filter((line) => line !== undefined)
    .join('\n')
    .trim();
}
