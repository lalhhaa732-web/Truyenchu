import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, User } from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDocFromServer,
  setDoc,
  getDoc,
  deleteDoc,
  serverTimestamp
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { Novel, Chapter } from './types';
import { UserProfileData } from './components/UserProfileModal';

export const ADMIN_EMAIL = 'lalhhaa732@gmail.com';

export function isAdminUser(user?: User | null): boolean {
  return Boolean(
    user &&
      user.emailVerified &&
      user.email &&
      user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()
  );
}

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write'
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
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
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email
        })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Validate connection on boot as required by guidelines
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'novels', 'connection-check'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

// Sanitize ID to match ^[a-zA-Z0-9_\-]+$ and maxLength 128
export function sanitizeFirestoreId(rawId: string): string {
  const cleaned = rawId.trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 128);
  return cleaned || `doc-${Date.now()}`;
}

export async function signInWithGoogle(forceSelectAccount = false) {
  const provider = new GoogleAuthProvider();
  if (forceSelectAccount) {
    provider.setCustomParameters({ prompt: 'select_account' });
  }
  return signInWithPopup(auth, provider);
}

export async function signOutUser() {
  return signOut(auth);
}

// Provision /admins/{userId} record in Firestore when bootstrapped admin signs in
export async function ensureAdminRecordInFirestore() {
  const currentUser = auth.currentUser;
  if (!isAdminUser(currentUser) || !currentUser) return;

  const adminId = sanitizeFirestoreId(currentUser.uid);
  const adminPath = `admins/${adminId}`;
  try {
    const snap = await getDoc(doc(db, 'admins', adminId));
    if (!snap.exists()) {
      await setDoc(doc(db, 'admins', adminId), {
        userId: adminId,
        email: (currentUser.email || ADMIN_EMAIL).slice(0, 120),
        role: 'admin',
        createdAt: serverTimestamp()
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, adminPath);
  }
}

// Register or sync a user's profile document at /users/{userId}
export async function syncUserProfileToFirestore(
  profile: UserProfileData,
  preferLocalRegistrationFields = false
): Promise<UserProfileData | null> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified) return null;

  if (isAdminUser(currentUser)) {
    ensureAdminRecordInFirestore().catch(() => {});
  }

  const userId = sanitizeFirestoreId(currentUser.uid);
  const userPath = `users/${userId}`;

  try {
    const existingSnap = await getDoc(doc(db, 'users', userId));

    const cleanNickname = (profile.nickname || currentUser.displayName || 'Độc giả').trim().slice(0, 60) || 'Độc giả';
    const cleanTitle = (profile.equippedTitle || 'Tân Thủ Thư Sinh').trim().slice(0, 60) || 'Tân Thủ Thư Sinh';

    const sanitizedPayload = {
      userId,
      nickname: cleanNickname,
      avatarUrl: (profile.avatarUrl || currentUser.photoURL || '').slice(0, 500000),
      bio: (profile.bio || '').slice(0, 300),
      level: Math.max(1, Math.min(100, Math.floor(Number(profile.level) || 1))),
      exp: Math.max(0, Math.min(100000, Math.floor(Number(profile.exp) || 0))),
      equippedTitle: cleanTitle
    };

    if (!existingSnap.exists()) {
      await setDoc(doc(db, 'users', userId), {
        ...sanitizedPayload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      return profile;
    } else {
      const existingData = existingSnap.data();
      if (preferLocalRegistrationFields) {
        await setDoc(doc(db, 'users', userId), {
          userId,
          nickname: sanitizedPayload.nickname,
          avatarUrl: sanitizedPayload.avatarUrl,
          bio: sanitizedPayload.bio,
          level: sanitizedPayload.level,
          exp: sanitizedPayload.exp,
          equippedTitle: sanitizedPayload.equippedTitle,
          createdAt: existingData.createdAt || serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        return profile;
      } else {
        return {
          ...profile,
          nickname: existingData.nickname || sanitizedPayload.nickname,
          avatarUrl: existingData.avatarUrl || sanitizedPayload.avatarUrl,
          bio: existingData.bio ?? sanitizedPayload.bio,
          level: existingData.level || sanitizedPayload.level,
          exp: existingData.exp ?? sanitizedPayload.exp,
          equippedTitle: existingData.equippedTitle || sanitizedPayload.equippedTitle
        };
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }
}

// Save or update a Novel and its latest Chapter in Firestore (when user is signed in & verified)
export async function syncNovelAndChapterToFirestore(novel: Novel, chapter?: Chapter) {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified) return;

  const novelId = sanitizeFirestoreId(novel.id);
  const novelPath = `novels/${novelId}`;

  try {
    const existingSnap = await getDoc(doc(db, 'novels', novelId));
    const basePayload: Record<string, unknown> = {
      id: novelId,
      title: (novel.title || 'Tác phẩm').slice(0, 150),
      author: (novel.author || 'Ẩn Danh').slice(0, 100),
      genre: (novel.genre || 'Tiên Hiệp').slice(0, 60),
      status: novel.status === 'Hoàn thành' ? 'Hoàn thành' : 'Đang ra',
      synopsis: (novel.synopsis || '').slice(0, 2000),
      coverStyle: novel.coverStyle || 'ink-mountain',
      chapterCount: Math.max(1, Math.min(100000, novel.chapters.length || 1)),
      ownerId: currentUser.uid,
      updatedAt: serverTimestamp()
    };

    if (novel.coverImageUrl) {
      basePayload.coverImageUrl = novel.coverImageUrl.slice(0, 500000);
    }

    if (novel.sourceUrl) {
      basePayload.sourceUrl = novel.sourceUrl.slice(0, 500);
      basePayload.autoFetchEnabled = Boolean(novel.autoFetchEnabled);
    }

    if (!existingSnap.exists()) {
      basePayload.createdAt = serverTimestamp();
      await setDoc(doc(db, 'novels', novelId), basePayload);
    } else if (existingSnap.data()?.ownerId === currentUser.uid || isAdminUser(currentUser)) {
      const existingData = existingSnap.data();
      const updatedDoc: Record<string, unknown> = {
        ...existingData,
        title: basePayload.title,
        synopsis: basePayload.synopsis,
        status: basePayload.status,
        coverStyle: basePayload.coverStyle,
        chapterCount: basePayload.chapterCount,
        ...(novel.sourceUrl ? { autoFetchEnabled: Boolean(novel.autoFetchEnabled) } : {}),
        updatedAt: serverTimestamp()
      };
      if (novel.coverImageUrl) {
        updatedDoc.coverImageUrl = novel.coverImageUrl.slice(0, 500000);
      } else {
        delete updatedDoc.coverImageUrl;
      }
      await setDoc(doc(db, 'novels', novelId), updatedDoc);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, novelPath);
  }

  if (chapter) {
    const chapterId = sanitizeFirestoreId(chapter.id);
    const chapterPath = `novels/${novelId}/chapters/${chapterId}`;
    try {
      const chapSnap = await getDoc(doc(db, 'novels', novelId, 'chapters', chapterId));
      if (!chapSnap.exists()) {
        const joinedContent = chapter.content.join('\n\n').slice(0, 25000) || 'Nội dung chương...';
        await setDoc(doc(db, 'novels', novelId, 'chapters', chapterId), {
          id: chapterId,
          novelId,
          number: Math.max(1, Math.min(100000, chapter.number)),
          title: (chapter.title || `Chương ${chapter.number}`).slice(0, 200),
          content: joinedContent,
          wordCount: Math.max(1, Math.min(50000, chapter.wordCount || 100)),
          ownerId: currentUser.uid,
          createdAt: serverTimestamp()
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, chapterPath);
    }
  }
}

export async function deleteNovelFromFirestore(novelIdRaw: string) {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified) return;

  const novelId = sanitizeFirestoreId(novelIdRaw);
  const novelPath = `novels/${novelId}`;
  try {
    const snap = await getDoc(doc(db, 'novels', novelId));
    if (snap.exists() && (snap.data()?.ownerId === currentUser.uid || isAdminUser(currentUser))) {
      await deleteDoc(doc(db, 'novels', novelId));
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, novelPath);
  }
}

// Save per-user reading progress and bookmark state in Firestore
export async function syncUserProgressToFirestore(
  novelIdRaw: string,
  chapterNumber: number,
  isBookmarked: boolean,
  novelObj?: Novel
) {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified) return;

  const userId = sanitizeFirestoreId(currentUser.uid);
  const novelId = sanitizeFirestoreId(novelIdRaw);
  const progressPath = `users/${userId}/progress/${novelId}`;

  try {
    // Ensure parent novel document exists in Firestore before writing relational progress
    let novelSnap = await getDoc(doc(db, 'novels', novelId));
    if (!novelSnap.exists() && novelObj) {
      await syncNovelAndChapterToFirestore(novelObj, novelObj.chapters?.[0]);
      novelSnap = await getDoc(doc(db, 'novels', novelId));
    }
    if (!novelSnap.exists()) return;

    const existingProgressSnap = await getDoc(doc(db, 'users', userId, 'progress', novelId));
    if (!existingProgressSnap.exists()) {
      await setDoc(doc(db, 'users', userId, 'progress', novelId), {
        novelId,
        userId,
        chapterNumber: Math.max(1, Math.min(100000, chapterNumber)),
        isBookmarked: Boolean(isBookmarked),
        updatedAt: serverTimestamp()
      });
    } else {
      const existingData = existingProgressSnap.data();
      await setDoc(doc(db, 'users', userId, 'progress', novelId), {
        ...existingData,
        chapterNumber: Math.max(1, Math.min(100000, chapterNumber)),
        isBookmarked: Boolean(isBookmarked),
        updatedAt: serverTimestamp()
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, progressPath);
  }
}
