import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signInWithPopup,
  signOut,
  type User as FirebaseUser,
} from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

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
export const FIRESTORE_DATABASE_ID = firebaseConfig.firestoreDatabaseId;
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

export async function signOutFirebase(): Promise<void> {
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
