import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp as initializeClientApp, getApps as getClientApps } from 'firebase/app';
import { getAuth as getClientAuth, sendPasswordResetEmail } from 'firebase/auth';

if (!admin.apps.length) {
  admin.initializeApp();
}

const PRIMARY_OWNER_EMAIL = 'izharahmad46@gmail.com';
const FIRESTORE_DB_ID =
  process.env.FIRESTORE_DATABASE_ID || 'ai-studio-sgncommitteehisa-4450e72e-1580-4194-88a0-bed4a688229b';
const FIREBASE_WEB_API_KEY = defineSecret('FIREBASE_WEB_API_KEY');

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

function getAdminDb() {
  return FIRESTORE_DB_ID && FIRESTORE_DB_ID !== '(default)'
    ? getFirestore(admin.app(), FIRESTORE_DB_ID)
    : getFirestore(admin.app());
}

function getFirebaseClientAuth(webApiKey: string) {
  const projectId = process.env.GCLOUD_PROJECT || 'gen-lang-client-0559787771';
  const existing = getClientApps().find((a) => a.name === 'password-reset-client');
  const clientApp =
    existing ||
    initializeClientApp(
      {
        apiKey: webApiKey,
        authDomain: `${projectId}.firebaseapp.com`,
        projectId,
      },
      'password-reset-client'
    );
  return getClientAuth(clientApp);
}

/**
 * Callable Cloud Function: triggerUserPasswordReset
 *
 * Strictly restricted to the verified App Owner / Super Admin.
 * Verifies the caller's identity and Owner role, validates the target email,
 * triggers `sendPasswordResetEmail` via the Firebase Auth SDK, and writes an
 * immutable audit record to Firestore.
 */
export const triggerUserPasswordReset = onCall(
  {
    region: 'us-central1',
    secrets: [FIREBASE_WEB_API_KEY],
    enforceAppCheck: false,
  },
  async (request) => {
    // 1) Require verified Firebase Authentication
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication is required to trigger password reset emails.');
    }

    const callerEmail = String(request.auth.token.email || '').trim().toLowerCase();
    const callerEmailVerified = Boolean(request.auth.token.email_verified);
    const db = getAdminDb();

    // 2) Enforce Owner / Super Admin authorization
    let isAuthorizedOwner = callerEmailVerified && callerEmail === PRIMARY_OWNER_EMAIL;
    if (!isAuthorizedOwner) {
      const userSnap = await db.collection('users').doc(request.auth.uid).get();
      if (userSnap.exists && userSnap.data()?.role === 'owner' && userSnap.data()?.isActive !== false) {
        isAuthorizedOwner = true;
      }
    }

    if (!isAuthorizedOwner) {
      throw new HttpsError(
        'permission-denied',
        'Only the verified App Owner / Super Admin can trigger password reset emails.'
      );
    }

    // 3) Validate input payload
    const data = (request.data || {}) as {
      email?: unknown;
      targetUserId?: unknown;
      targetUsername?: unknown;
      reason?: unknown;
    };

    const cleanEmail = String(data.email || '').trim().toLowerCase();
    if (!cleanEmail || cleanEmail.length > 160 || !EMAIL_RE.test(cleanEmail)) {
      throw new HttpsError('invalid-argument', 'A valid registered email address is required.');
    }

    const targetUserId = String(data.targetUserId || cleanEmail).trim().slice(0, 128);
    const targetUsername = String(data.targetUsername || '').trim().slice(0, 64);
    const reason = String(
      data.reason || `Super Admin triggered Firebase password reset email for ${targetUsername || cleanEmail}`
    )
      .trim()
      .slice(0, 400);

    // 4) Confirm the Firebase Auth account exists before sending
    try {
      await admin.auth().getUserByEmail(cleanEmail);
    } catch (err: any) {
      if (err?.code === 'auth/user-not-found') {
        throw new HttpsError(
          'not-found',
          `No Firebase Auth account exists for "${cleanEmail}". Ask the user to sign in or register in Firebase Authentication first.`
        );
      }
      throw new HttpsError('internal', 'Failed to verify user account in Firebase Authentication.');
    }

    // 5) Dispatch secure one-time password reset email via Firebase Auth SDK
    const apiKey = FIREBASE_WEB_API_KEY.value();
    if (!apiKey) {
      throw new HttpsError(
        'failed-precondition',
        'FIREBASE_WEB_API_KEY secret is not configured for Cloud Functions.'
      );
    }

    try {
      const clientAuth = getFirebaseClientAuth(apiKey);
      await sendPasswordResetEmail(clientAuth, cleanEmail);
    } catch (err: any) {
      const code = String(err?.code || '');
      if (code === 'auth/too-many-requests') {
        throw new HttpsError('resource-exhausted', 'Too many reset requests for this email. Please wait and retry.');
      }
      if (code === 'auth/operation-not-allowed') {
        throw new HttpsError(
          'failed-precondition',
          'Email/Password provider is not enabled in Firebase Console → Authentication → Sign-in method.'
        );
      }
      throw new HttpsError('internal', err?.message || 'Firebase Auth failed to dispatch password reset email.');
    }

    // 6) Record immutable audit log entry in Firestore
    const auditId = `aud_pwreset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const triggeredAt = new Date().toISOString();
    const adminDisplayName = String(request.auth.token.name || callerEmail || 'Super Admin').slice(0, 120);
    await db
      .collection('audit_logs')
      .doc(auditId)
      .set({
        id: auditId,
        timestamp: triggeredAt,
        adminId: request.auth.uid,
        adminName: adminDisplayName,
        action: 'OWNER_PASSWORD_RESET_EMAIL_SENT',
        entityType: 'users',
        entityId: targetUserId,
        reason,
        afterData: JSON.stringify({
          targetEmail: cleanEmail,
          targetUsername,
          triggeredByAdminId: request.auth.uid,
          triggeredByName: adminDisplayName,
          triggeredByEmail: callerEmail,
          triggeredAt,
          provider: 'firebase_cloud_function',
        }),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

    return {
      ok: true,
      email: cleanEmail,
      dispatchedVia: 'cloud_function',
      auditLogId: auditId,
      timestamp: triggeredAt,
    };
  }
);

/**
 * Callable Cloud Function: createAdminAccount
 *
 * Exclusively callable by the verified App Owner / Super Admin.
 * Creates (or links) a Firebase Auth user for the new Administrator, assigns
 * their role atomically in Firestore (`/users/{uid}` and `/admins/{uid}`),
 * optionally dispatches a Firebase password reset email, and writes an
 * immutable record to `/audit_logs`.
 */
export const createAdminAccount = onCall(
  {
    region: 'us-central1',
    secrets: [FIREBASE_WEB_API_KEY],
    enforceAppCheck: false,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication is required to create an Administrator.');
    }

    const callerEmail = String(request.auth.token.email || '').trim().toLowerCase();
    const callerEmailVerified = Boolean(request.auth.token.email_verified);
    const db = getAdminDb();

    let isAuthorizedOwner = callerEmailVerified && callerEmail === PRIMARY_OWNER_EMAIL;
    if (!isAuthorizedOwner) {
      const userSnap = await db.collection('users').doc(request.auth.uid).get();
      if (userSnap.exists && userSnap.data()?.role === 'owner' && userSnap.data()?.isActive !== false) {
        isAuthorizedOwner = true;
      }
    }

    if (!isAuthorizedOwner) {
      throw new HttpsError('permission-denied', 'Only the verified App Owner / Super Admin can create new Admins.');
    }

    const data = (request.data || {}) as {
      fullName?: unknown;
      email?: unknown;
      phone?: unknown;
      role?: unknown;
      initialPassword?: unknown;
      sendResetEmail?: unknown;
    };

    const fullName = String(data.fullName || '').trim().slice(0, 120);
    const cleanEmail = String(data.email || '').trim().toLowerCase();
    const phone = String(data.phone || '').trim().slice(0, 24);
    const rawRole = String(data.role || 'committee_admin').trim();
    const role: 'admin_main' | 'admin_secondary' | 'committee_admin' =
      rawRole === 'admin_main' || rawRole === 'admin_secondary' ? rawRole : 'committee_admin';
    const initialPassword = String(data.initialPassword || '');
    const shouldSendReset = data.sendResetEmail !== false;

    if (!fullName || fullName.length < 2) {
      throw new HttpsError('invalid-argument', 'Admin full name is required.');
    }
    if (!cleanEmail || cleanEmail.length > 254 || !EMAIL_RE.test(cleanEmail)) {
      throw new HttpsError('invalid-argument', 'A valid Admin email address is required.');
    }
    if (cleanEmail === PRIMARY_OWNER_EMAIL) {
      throw new HttpsError('permission-denied', 'The Primary Owner email cannot be reassigned as a sub-admin.');
    }
    if (initialPassword && initialPassword.length < 8) {
      throw new HttpsError('invalid-argument', 'Initial password must be at least 8 characters long.');
    }

    // Generate cryptographically strong temporary password when Owner opts for reset-link onboarding
    const crypto = await import('crypto');
    const passwordToSet =
      initialPassword || `Adm#${crypto.randomBytes(12).toString('base64url')}9!`;

    let fbUserRecord: admin.auth.UserRecord;
    let authUserCreated = false;
    try {
      fbUserRecord = await admin.auth().createUser({
        email: cleanEmail,
        password: passwordToSet,
        displayName: fullName,
        emailVerified: false,
        disabled: false,
      });
      authUserCreated = true;
    } catch (err: any) {
      if (err?.code === 'auth/email-already-exists') {
        fbUserRecord = await admin.auth().getUserByEmail(cleanEmail);
        if (initialPassword) {
          await admin.auth().updateUser(fbUserRecord.uid, {
            displayName: fullName,
            password: initialPassword,
            disabled: false,
          });
        }
      } else {
        throw new HttpsError('internal', err?.message || 'Failed to create Firebase Auth user.');
      }
    }

    // Determine next available admin slot (2..20)
    const adminsSnap = await db.collection('admins').get();
    const usedSlots = new Set<number>();
    adminsSnap.forEach((d) => {
      const s = Number(d.data()?.slot || 0);
      if (s >= 1 && s <= 20) usedSlots.add(s);
    });
    let nextSlot = 2;
    while (usedSlots.has(nextSlot) && nextSlot < 20) nextSlot += 1;

    const triggeredAt = new Date().toISOString();
    const auditId = `aud_admin_create_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const adminDisplayName = String(request.auth.token.name || callerEmail || 'App Owner').slice(0, 120);

    const batch = db.batch();
    const userDoc: Record<string, unknown> = {
      uid: fbUserRecord.uid,
      email: cleanEmail,
      displayName: fullName,
      role,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (phone) userDoc.phone = phone;
    batch.set(db.collection('users').doc(fbUserRecord.uid), userDoc, { merge: true });

    const adminRegistryDoc: Record<string, unknown> = {
      uid: fbUserRecord.uid,
      email: cleanEmail,
      fullName,
      role,
      slot: nextSlot,
      assignedByUid: request.auth.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (phone) adminRegistryDoc.phone = phone;
    batch.set(db.collection('admins').doc(fbUserRecord.uid), adminRegistryDoc);

    batch.set(db.collection('audit_logs').doc(auditId), {
      id: auditId,
      timestamp: triggeredAt,
      adminId: request.auth.uid,
      adminName: adminDisplayName,
      action: 'OWNER_FIREBASE_ADMIN_PROVISIONED',
      entityType: 'admins',
      entityId: fbUserRecord.uid,
      reason: `Owner provisioned new ${role} (${cleanEmail}) via Firebase Auth & Firestore`,
      afterData: JSON.stringify({
        uid: fbUserRecord.uid,
        email: cleanEmail,
        fullName,
        phone,
        role,
        slot: nextSlot,
        authUserCreated,
        assignedByUid: request.auth.uid,
      }),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await batch.commit();

    let resetEmailSent = false;
    if (shouldSendReset) {
      const apiKey = FIREBASE_WEB_API_KEY.value();
      if (apiKey) {
        try {
          const clientAuth = getFirebaseClientAuth(apiKey);
          await sendPasswordResetEmail(clientAuth, cleanEmail);
          resetEmailSent = true;
        } catch {
          resetEmailSent = false;
        }
      }
    }

    return {
      ok: true,
      uid: fbUserRecord.uid,
      email: cleanEmail,
      role,
      slot: nextSlot,
      authUserCreated,
      resetEmailSent,
      dispatchedVia: 'cloud_function',
      auditLogId: auditId,
    };
  }
);

