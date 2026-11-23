import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithPopup,
  signOut,
  type User as FirebaseUser,
} from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const DEFAULT_FIRESTORE_DATABASE_ID =
  'ai-studio-sgncommitteehisa-4450e72e-1580-4194-88a0-bed4a688229b';
const configuredFirestoreDatabaseId =
  (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId ||
  DEFAULT_FIRESTORE_DATABASE_ID;

export const db = getFirestore(app, configuredFirestoreDatabaseId);
export const auth = getAuth(app);
export const functions = getFunctions(app, 'us-central1');
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

// Configured Google Chat Workspace OAuth scopes (user-delegated scopes registered on the OAuth brand)
export const GOOGLE_CHAT_SCOPES: string[] = [
  'https://www.googleapis.com/auth/chat.admin.delete',
  'https://www.googleapis.com/auth/chat.admin.memberships',
  'https://www.googleapis.com/auth/chat.admin.memberships.readonly',
  'https://www.googleapis.com/auth/chat.admin.spaces',
  'https://www.googleapis.com/auth/chat.admin.spaces.readonly',
  'https://www.googleapis.com/auth/chat.customemojis',
  'https://www.googleapis.com/auth/chat.customemojis.readonly',
  'https://www.googleapis.com/auth/chat.delete',
  'https://www.googleapis.com/auth/chat.memberships',
  'https://www.googleapis.com/auth/chat.memberships.app',
  'https://www.googleapis.com/auth/chat.memberships.readonly',
  'https://www.googleapis.com/auth/chat.messages',
  'https://www.googleapis.com/auth/chat.messages.create',
  'https://www.googleapis.com/auth/chat.messages.reactions',
  'https://www.googleapis.com/auth/chat.messages.reactions.create',
  'https://www.googleapis.com/auth/chat.messages.reactions.readonly',
  'https://www.googleapis.com/auth/chat.messages.readonly',
  'https://www.googleapis.com/auth/chat.spaces',
  'https://www.googleapis.com/auth/chat.spaces.create',
  'https://www.googleapis.com/auth/chat.spaces.readonly',
  'https://www.googleapis.com/auth/chat.users.readstate',
  'https://www.googleapis.com/auth/chat.users.readstate.readonly',
  'https://www.googleapis.com/auth/chat.users.sections',
  'https://www.googleapis.com/auth/chat.users.sections.readonly',
  'https://www.googleapis.com/auth/chat.users.spacesettings',
];

export const googleChatProvider = new GoogleAuthProvider();
GOOGLE_CHAT_SCOPES.forEach((scope) => googleChatProvider.addScope(scope));
googleChatProvider.setCustomParameters({ prompt: 'select_account' });

// Strict in-memory caching for Google Chat OAuth access token (never stored in localStorage/sessionStorage)
let isSigningInGoogleChat = false;
let cachedGoogleChatAccessToken: string | null = null;

// Automatically clear in-memory access token whenever Firebase Auth signs out
onAuthStateChanged(auth, (fbUser) => {
  if (!fbUser) {
    cachedGoogleChatAccessToken = null;
  }
});

export async function uploadImageToFirebaseStorage(
  file: File,
  folder: 'upi_qr' | 'payment_receipts'
): Promise<string | null> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return null;
  if (file.size > 3 * 1024 * 1024) return null;
  if (!/^image\/(png|jpeg|jpg|webp)$/.test(file.type)) return null;

  const safeExt = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const path =
    folder === 'upi_qr'
      ? `upi_qr/official_qr_${Date.now()}.${safeExt}`
      : `payment_receipts/${user.uid}/receipt_${Date.now()}.${safeExt}`;

  try {
    const fileRef = storageRef(storage, path);
    const uploadPromise = uploadBytes(fileRef, file, { contentType: file.type }).then(() =>
      getDownloadURL(fileRef)
    );
    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000));
    return await Promise.race([uploadPromise, timeoutPromise]);
  } catch {
    // Gracefully fall back to secure backend upload if Storage bucket is not activated on project
    return null;
  }
}

export const FIREBASE_PROJECT_ID = firebaseConfig.projectId;
export const FIRESTORE_DATABASE_ID = configuredFirestoreDatabaseId;
export const PRIMARY_ADMIN_EMAIL = 'izharahmad46@gmail.com';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData.map((provider) => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function signInWithGoogle(): Promise<FirebaseUser> {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export const GOOGLE_CHAT_CONSOLE_URL = `https://console.cloud.google.com/apis/api/chat.googleapis.com/hangouts-chat?project=${FIREBASE_PROJECT_ID}`;

export function initGoogleChatAuth(
  onAuthSuccess?: (user: FirebaseUser, token: string) => void,
  onAuthFailure?: () => void
) {
  return onAuthStateChanged(auth, (user: FirebaseUser | null) => {
    if (user) {
      if (cachedGoogleChatAccessToken) {
        onAuthSuccess?.(user, cachedGoogleChatAccessToken);
      } else if (!isSigningInGoogleChat) {
        cachedGoogleChatAccessToken = null;
        onAuthFailure?.();
      }
    } else {
      cachedGoogleChatAccessToken = null;
      onAuthFailure?.();
    }
  });
}

export async function signInWithGoogleChat(): Promise<{ user: FirebaseUser; accessToken: string }> {
  try {
    isSigningInGoogleChat = true;
    const result = await signInWithPopup(auth, googleChatProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to obtain Google Chat OAuth access token from Google Sign-In.');
    }
    cachedGoogleChatAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedGoogleChatAccessToken };
  } finally {
    isSigningInGoogleChat = false;
  }
}

export async function getGoogleChatAccessToken(): Promise<string | null> {
  return cachedGoogleChatAccessToken;
}

export function clearGoogleChatAccessToken(): void {
  cachedGoogleChatAccessToken = null;
}

export async function signOutFirebase(): Promise<void> {
  cachedGoogleChatAccessToken = null;
  if (auth.currentUser) {
    await signOut(auth);
  }
}

export async function triggerFirebasePasswordResetEmail(email: string): Promise<{ email: string }> {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanEmail || cleanEmail.length > 160 || !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(cleanEmail)) {
    throw new Error('Please enter a valid registered email address.');
  }

  try {
    await sendPasswordResetEmail(auth, cleanEmail);
    return { email: cleanEmail };
  } catch (err: any) {
    const code = String(err?.code || '');
    if (code === 'auth/user-not-found') {
      throw new Error(
        `No Firebase Auth account exists for "${cleanEmail}". Ask the user to sign in once with Firebase or register this email in Firebase Authentication first.`
      );
    }
    if (code === 'auth/invalid-email') {
      throw new Error('The email address format is invalid.');
    }
    if (code === 'auth/too-many-requests') {
      throw new Error('Too many password reset requests for this email. Please wait a few minutes and try again.');
    }
    if (code === 'auth/operation-not-allowed') {
      throw new Error(
        'Email/Password sign-in is not yet enabled in Firebase Console. Enable it under Firebase Console → Authentication → Sign-in method → Email/Password.'
      );
    }
    if (code === 'auth/network-request-failed') {
      throw new Error('Network error while contacting Firebase Authentication. Please check your internet connection.');
    }
    throw new Error(err?.message || 'Failed to send Firebase password reset email.');
  }
}

export async function invokePasswordResetCloudFunction(params: {
  email: string;
  targetUserId: string;
  targetUsername: string;
  reason?: string;
}): Promise<{ email: string; dispatchedVia: 'cloud_function' | 'firebase_auth_sdk' }> {
  const cleanEmail = String(params.email || '').trim().toLowerCase();
  if (!cleanEmail || cleanEmail.length > 160 || !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(cleanEmail)) {
    throw new Error('Please enter a valid registered email address.');
  }

  // Prefer the deployed Firebase Callable Cloud Function when signed in via Firebase Auth
  if (auth.currentUser) {
    try {
      const triggerResetFn = httpsCallable<
        { email: string; targetUserId: string; targetUsername: string; reason?: string },
        { ok: boolean; email: string; dispatchedVia: 'cloud_function' }
      >(functions, 'triggerUserPasswordReset');

      const result = await triggerResetFn({
        email: cleanEmail,
        targetUserId: params.targetUserId,
        targetUsername: params.targetUsername,
        reason: params.reason,
      });

      if (result.data?.ok) {
        return { email: result.data.email || cleanEmail, dispatchedVia: 'cloud_function' };
      }
    } catch (err: any) {
      const code = String(err?.code || '');
      // Surface explicit authorization/validation errors directly from the Cloud Function
      if (
        code === 'functions/permission-denied' ||
        code === 'functions/invalid-argument' ||
        code === 'functions/resource-exhausted'
      ) {
        throw new Error(err?.message || 'Cloud Function rejected the password reset request.');
      }
      // If the Cloud Function is not yet deployed on this Firebase project (e.g. Starter Tier preview),
      // seamlessly fall back to calling sendPasswordResetEmail directly via the Firebase Auth SDK.
    }
  }

  const fallback = await triggerFirebasePasswordResetEmail(cleanEmail);
  return { email: fallback.email, dispatchedVia: 'firebase_auth_sdk' };
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration. Firestore client is offline.');
    }
    // Permission errors on test/connection are expected due to default-deny security rules.
  }
}

void testConnection();
