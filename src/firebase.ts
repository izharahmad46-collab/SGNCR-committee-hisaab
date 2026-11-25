import { deleteApp, initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  inMemoryPersistence,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithPopup,
  signOut,
  updateProfile,
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

export interface ProvisionFirebaseAdminParams {
  fullName: string;
  email: string;
  phone: string;
  role: 'admin_main' | 'admin_secondary' | 'committee_admin';
  initialPassword?: string;
  sendResetEmail?: boolean;
}

export interface ProvisionFirebaseAdminResult {
  uid: string;
  email: string;
  role: 'admin_main' | 'admin_secondary' | 'committee_admin';
  authUserCreated: boolean;
  firestoreAssignedByFunction: boolean;
  resetEmailSent: boolean;
  dispatchedVia: 'cloud_function' | 'secondary_auth_app';
}

function generateStrongTemporaryPassword(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*';
  let out = 'Sgn#9';
  for (let i = 0; i < bytes.length; i += 1) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

/**
 * Creates a Firebase Authentication user for a newly appointed Admin without
 * interrupting the currently signed-in Owner's Firebase session.
 *
 * 1) Tries the deployed Callable Cloud Function `createAdminAccount` first.
 * 2) Falls back to an isolated ephemeral secondary Firebase App instance using
 *    in-memory persistence so the Owner stays signed in on the primary app.
 */
export async function provisionFirebaseAuthAdminUser(
  params: ProvisionFirebaseAdminParams
): Promise<ProvisionFirebaseAdminResult> {
  const cleanName = String(params.fullName || '').trim().slice(0, 120);
  const cleanEmail = String(params.email || '').trim().toLowerCase().slice(0, 254);
  const cleanPhone = String(params.phone || '').trim().slice(0, 24);
  const cleanRole = params.role;

  if (!cleanName || cleanName.length < 2) {
    throw new Error('Admin Name is required.');
  }
  if (!cleanEmail || !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(cleanEmail)) {
    throw new Error('Please enter a valid Admin Email address.');
  }
  if (cleanEmail === PRIMARY_ADMIN_EMAIL.toLowerCase()) {
    throw new Error('The Primary Owner email cannot be created as a secondary Admin.');
  }
  if (!auth.currentUser || !auth.currentUser.emailVerified) {
    throw new Error('Please connect your verified Owner Firebase account before creating a Firebase Admin.');
  }

  // 1) Prefer Callable Cloud Function when deployed
  try {
    const createAdminFn = httpsCallable<
      ProvisionFirebaseAdminParams,
      {
        ok: boolean;
        uid: string;
        email: string;
        role: 'admin_main' | 'admin_secondary' | 'committee_admin';
        authUserCreated: boolean;
        resetEmailSent: boolean;
      }
    >(functions, 'createAdminAccount');

    const res = await createAdminFn({
      fullName: cleanName,
      email: cleanEmail,
      phone: cleanPhone,
      role: cleanRole,
      initialPassword: params.initialPassword || undefined,
      sendResetEmail: params.sendResetEmail !== false,
    });

    if (res.data?.ok && res.data?.uid) {
      return {
        uid: res.data.uid,
        email: res.data.email || cleanEmail,
        role: res.data.role || cleanRole,
        authUserCreated: Boolean(res.data.authUserCreated),
        firestoreAssignedByFunction: true,
        resetEmailSent: Boolean(res.data.resetEmailSent),
        dispatchedVia: 'cloud_function',
      };
    }
  } catch (err: any) {
    const code = String(err?.code || '');
    if (
      code === 'functions/permission-denied' ||
      code === 'functions/invalid-argument' ||
      code === 'functions/unauthenticated'
    ) {
      throw new Error(err?.message || 'Cloud Function rejected Admin creation.');
    }
    // Otherwise fall through to isolated secondary Firebase App client provisioning
  }

  // 2) Secondary isolated Firebase App with inMemoryPersistence (keeps Owner session untouched)
  const passwordToUse =
    params.initialPassword && params.initialPassword.length >= 8
      ? params.initialPassword
      : generateStrongTemporaryPassword();

  const tempAppName = `admin-provisioner-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const secondaryApp = initializeApp(firebaseConfig, tempAppName);
  const secondaryAuth = getAuth(secondaryApp);

  let createdUid = '';
  try {
    await setPersistence(secondaryAuth, inMemoryPersistence);
    const cred = await createUserWithEmailAndPassword(secondaryAuth, cleanEmail, passwordToUse);
    createdUid = cred.user.uid;
    try {
      await updateProfile(cred.user, { displayName: cleanName });
    } catch {
      // Non-fatal: Firestore profile stores authoritative fullName
    }
    await signOut(secondaryAuth);
  } catch (err: any) {
    const code = String(err?.code || '');
    if (code === 'auth/email-already-in-use') {
      throw new Error(
        `A Firebase Auth account already exists for "${cleanEmail}". If this user already has a Firebase account, link their email via Edit Account or send them a Password Reset Email.`
      );
    }
    if (code === 'auth/operation-not-allowed') {
      throw new Error(
        'Email/Password authentication is not enabled yet in Firebase Console. Enable it at Firebase Console → Authentication → Sign-in method → Email/Password, then try again.'
      );
    }
    if (code === 'auth/weak-password') {
      throw new Error('Password is too weak. Please enter a stronger password (at least 8 characters).');
    }
    if (code === 'auth/invalid-email') {
      throw new Error('The Admin email address format is invalid.');
    }
    throw new Error(err?.message || 'Failed to create Firebase Auth account for the new Admin.');
  } finally {
    try {
      await deleteApp(secondaryApp);
    } catch {
      // Ignore cleanup error
    }
  }

  let resetEmailSent = false;
  if (params.sendResetEmail !== false) {
    try {
      await sendPasswordResetEmail(auth, cleanEmail);
      resetEmailSent = true;
    } catch {
      resetEmailSent = false;
    }
  }

  return {
    uid: createdUid,
    email: cleanEmail,
    role: cleanRole,
    authUserCreated: true,
    firestoreAssignedByFunction: false,
    resetEmailSent,
    dispatchedVia: 'secondary_auth_app',
  };
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
