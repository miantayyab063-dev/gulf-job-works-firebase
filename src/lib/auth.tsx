import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { GoogleAuthProvider, createUserWithEmailAndPassword, onAuthStateChanged, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup, signOut, type User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from './firebase';
import type { Role, UserProfile } from '../types';

interface AuthValue {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  roles: Role[];
  register(email: string, password: string): Promise<User>;
  login(email: string, password: string): Promise<void>;
  googleLogin(): Promise<User>;
  logout(): Promise<void>;
  resetPassword(email: string): Promise<void>;
  resendVerification(): Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => onAuthStateChanged(auth, (next) => { setUser(next); setLoading(false); }), []);
  useEffect(() => {
    if (!user) { setProfile(null); return; }
    return onSnapshot(doc(db, 'users', user.uid), (snap) => setProfile(snap.exists() ? snap.data() as UserProfile : null));
  }, [user]);

  const value = useMemo<AuthValue>(() => ({
    user,
    profile,
    loading,
    roles: profile?.roles || [],
    async register(email, password) { const credential = await createUserWithEmailAndPassword(auth, email, password); await sendEmailVerification(credential.user); return credential.user; },
    async login(email, password) { await signInWithEmailAndPassword(auth, email, password); },
    async googleLogin() { return (await signInWithPopup(auth, new GoogleAuthProvider())).user; },
    async logout() { await signOut(auth); },
    async resetPassword(email) { await sendPasswordResetEmail(auth, email); },
    async resendVerification() { if (auth.currentUser) await sendEmailVerification(auth.currentUser); },
  }), [user, profile, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
