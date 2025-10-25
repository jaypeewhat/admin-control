import * as SecureStore from 'expo-secure-store';
import { User, createUserWithEmailAndPassword, signOut as firebaseSignOut, onAuthStateChanged, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, updatePassword } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { auth, db } from '../constants/firebase';

type AuthContextType = {
  user: User | null;
  userType: 'driver' | 'student' | 'admin' | null;
  userName: string | null;
  isLoading: boolean;
  isBlocked: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, userData: any) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  sendVerificationEmail: () => Promise<void>;
  isEmailVerified: boolean;
  updateUserPassword: (newPassword: string) => Promise<void>;
  rememberLogin: boolean;
  setRememberLogin: (remember: boolean) => void;
  saveEmail: (email: string, remember: boolean) => Promise<void>;
  loadSavedEmail: () => Promise<string | null>;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  userType: null,
  userName: null,
  isLoading: true,
  isBlocked: false,
  signIn: async () => {},
  signUp: async () => {},
  signOut: async () => {},
  resetPassword: async () => {},
  updateUserPassword: async () => {},
  sendVerificationEmail: async () => {},
  isEmailVerified: false,
  rememberLogin: false,
  setRememberLogin: () => {},
  saveEmail: async () => {},
  loadSavedEmail: async () => null,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userType, setUserType] = useState<'driver' | 'student' | 'admin' | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [rememberLogin, setRememberLogin] = useState(false);
  const [isEmailVerified, setIsEmailVerified] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false); // Flag to prevent navigation during registration
  const [isBlocked, setIsBlocked] = useState<boolean>(false);

  // Constants for secure storage
  const EMAIL_KEY = 'saved_email';
  const REMEMBER_KEY = 'remember_login';

  // Save email only (no password, no auto-login)
  const saveEmail = async (email: string, remember: boolean) => {
    try {
      if (remember) {
        console.log('🔍 FIREBASE AUTH: Saving email for future use...');
        await SecureStore.setItemAsync(EMAIL_KEY, email);
        await SecureStore.setItemAsync(REMEMBER_KEY, 'true');
      } else {
        console.log('🔍 FIREBASE AUTH: Clearing saved email...');
        await SecureStore.deleteItemAsync(EMAIL_KEY);
        await SecureStore.deleteItemAsync(REMEMBER_KEY);
      }
      setRememberLogin(remember);
    } catch (error) {
      console.error('🔍 FIREBASE AUTH: Error saving email:', error);
    }
  };

  // Load saved email (no auto-login)
  const loadSavedEmail = async (): Promise<string | null> => {
    try {
      const rememberedLogin = await SecureStore.getItemAsync(REMEMBER_KEY);
      if (rememberedLogin === 'true') {
        const savedEmail = await SecureStore.getItemAsync(EMAIL_KEY);
        if (savedEmail) {
          console.log('🔍 FIREBASE AUTH: Found saved email:', savedEmail);
          setRememberLogin(true);
          return savedEmail;
        }
      }
      return null;
    } catch (error) {
      console.error('🔍 FIREBASE AUTH: Error loading saved email:', error);
      return null;
    }
  };

  // Fetch user profile from Firestore
  const fetchUserProfile = async (userId: string) => {
    try {
      const userDoc = await getDoc(doc(db, 'user_profiles', userId));
      if (userDoc.exists()) {
        const profile = userDoc.data();
        console.log('🔍 FIREBASE AUTH: Profile found, user type:', profile.user_type, 'name:', profile.display_name);
        setUserType(profile.user_type as 'driver' | 'student' | 'admin' | null);
        setUserName(profile.display_name || null);

        // Check if user is blocked
        const blocked = profile.status === 'blocked' || profile.blocked === true;
        const deleted = profile.deleted === true;
        setIsBlocked(!!blocked);
        if (deleted) {
          console.warn('🚫 FIREBASE AUTH: Account is deleted, signing out');
          await firebaseSignOut(auth);
        }
      } else {
        console.log('🔍 FIREBASE AUTH: No profile found for user');
        setUserType(null);
        setUserName(null);
        setIsBlocked(false);
      }
    } catch (error) {
      console.error('🔍 FIREBASE AUTH: Error fetching user profile:', error);
    }
  };

  // Sign in with email and password
  const signIn = async (email: string, password: string) => {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // Check if email is verified
      if (!user.emailVerified) {
        // Sign out the user if email is not verified
        await firebaseSignOut(auth);
        throw new Error('Please verify your email before logging in. Check your inbox for a verification link.');
      }

      // Immediate guard: fetch profile and block login if deleted (allow login when blocked)
      try {
        const userDoc = await getDoc(doc(db, 'user_profiles', user.uid));
        if (userDoc.exists()) {
          const profile = userDoc.data() as any;
          const deleted = profile.deleted === true;
          if (deleted) {
            console.warn('🚫 FIREBASE AUTH: Immediate guard caught deleted account at sign-in, signing out');
            await firebaseSignOut(auth);
            throw new Error('This account has been deleted.');
          }
        }
      } catch (profileErr) {
        // If profile fetch fails, fall back to onAuthStateChanged flow
        console.warn('🔍 FIREBASE AUTH: Profile check after login failed, will rely on auth listener:', profileErr);
      }

      console.log('🔍 FIREBASE AUTH: Login successful, email verified');
    } catch (error: any) {
      console.error('🔍 FIREBASE AUTH: Sign in error:', error);
      throw error;
    }
  };

  // Sign up with email and password
  const signUp = async (email: string, password: string, userData: any) => {
    try {
      console.log('🔍 FIREBASE AUTH: SignUp called with userData:', userData);
      setIsRegistering(true); // Set registration flag to prevent navigation
      
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // Create user profile in Firestore with only provided fields
      const profileData: any = {
        id: user.uid,
        email: user.email,
        display_name: userData.name,
        user_type: userData.user_type,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // Only add optional fields if they are provided
      console.log('🔍 FIREBASE AUTH: Checking optional fields - age:', userData.age, 'vehicle_type:', userData.vehicle_type, 'plate_number:', userData.plate_number);
      
      if (userData.age !== undefined) {
        console.log('🔍 FIREBASE AUTH: Adding age to profile');
        profileData.age = userData.age;
      }
      if (userData.vehicle_type !== undefined) {
        console.log('🔍 FIREBASE AUTH: Adding vehicle_type to profile');
        profileData.vehicle_type = userData.vehicle_type;
      }
      if (userData.plate_number !== undefined) {
        console.log('🔍 FIREBASE AUTH: Adding plate_number to profile');
        profileData.plate_number = userData.plate_number;
      }

      console.log('🔍 FIREBASE AUTH: Final profileData to save:', profileData);
      await setDoc(doc(db, 'user_profiles', user.uid), profileData);

      // Send email verification before signing out
      console.log('🔍 FIREBASE AUTH: Sending email verification...');
      await sendEmailVerification(user);
      
      // Sign out the user immediately after signup so they need to manually log in
      await firebaseSignOut(auth);
      console.log('🔍 FIREBASE AUTH: User signed up, profile created, verification email sent, and automatically signed out');
    } catch (error: any) {
      console.error('🔍 FIREBASE AUTH: Sign up error:', error);
      throw error;
    } finally {
      setIsRegistering(false); // Reset registration flag
    }
  };

  // Sign out
  const signOut = async () => {
    try {
      await firebaseSignOut(auth);
      // Keep saved email for "Remember me" functionality - only clear user state
      console.log('🔍 FIREBASE AUTH: User signed out - email saved for Remember me');
    } catch (error: any) {
      console.error('🔍 FIREBASE AUTH: Sign out error:', error);
      throw error;
    }
  };

  // Reset password
  const resetPassword = async (email: string) => {
    try {
      await sendPasswordResetEmail(auth, email);
      console.log('🔍 FIREBASE AUTH: Password reset email sent');
    } catch (error: any) {
      console.error('🔍 FIREBASE AUTH: Password reset error:', error);
      throw error;
    }
  };

  // Send email verification
  const sendVerificationEmail = async () => {
    try {
      if (auth.currentUser) {
        await sendEmailVerification(auth.currentUser);
        console.log('🔍 FIREBASE AUTH: Email verification sent');
      } else {
        throw new Error('No user is currently signed in');
      }
    } catch (error: any) {
      console.error('🔍 FIREBASE AUTH: Email verification error:', error);
      throw error;
    }
  };

  // Update password
  const updateUserPassword = async (newPassword: string) => {
    try {
      if (auth.currentUser) {
        await updatePassword(auth.currentUser, newPassword);
        console.log('🔍 FIREBASE AUTH: Password updated successfully');
      } else {
        throw new Error('No authenticated user');
      }
    } catch (error: any) {
      console.error('🔍 FIREBASE AUTH: Password update error:', error);
      throw error;
    }
  };

  useEffect(() => {
    console.log('🔍 FIREBASE AUTH: Setting up auth listener...');
    
    const initializeAuth = async () => {
      try {
        // Set a timeout to ensure we don't hang indefinitely
        const authTimeout = setTimeout(() => {
          console.log('🔍 FIREBASE AUTH: Auth initialization timeout, setting loading to false');
          setIsLoading(false);
        }, 2000); // 2 second maximum wait time

        // Check if there's already a user
        if (auth.currentUser) {
          console.log('🔍 FIREBASE AUTH: Current user found, fetching profile before finishing init');
          setUser(auth.currentUser);
          // Fetch the user profile first to honor blocked/deleted immediately
          await fetchUserProfile(auth.currentUser.uid);
          setIsLoading(false);
          clearTimeout(authTimeout);
        } else {
          // No current user, no auto-login - just load saved email preference
          console.log('🔍 FIREBASE AUTH: No current user, loading saved email preference...');
          await loadSavedEmail(); // This will set the rememberLogin state
          setIsLoading(false);
          clearTimeout(authTimeout);
        }
      } catch (error) {
        console.error('🔍 FIREBASE AUTH: Error during auth initialization:', error);
        setIsLoading(false);
      }
    };

    initializeAuth();

    // Listen for auth state changes
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      console.log('🔍 FIREBASE AUTH: Auth state change:', !!user, 'isRegistering:', isRegistering);
      
      if (user && !isRegistering) {
        console.log('🔍 FIREBASE AUTH: User signed in, fetching profile...');
        console.log('🔍 FIREBASE AUTH: Email verified:', user.emailVerified);
        setUser(user);
        setIsEmailVerified(user.emailVerified);
        await fetchUserProfile(user.uid);
        setIsLoading(false);
      } else if (!user) {
        console.log('🔍 FIREBASE AUTH: User signed out');
        setUser(null);
        setUserType(null);
        setUserName(null);
        setIsEmailVerified(false);
        setIsBlocked(false);
        setIsLoading(false);
      } else if (isRegistering) {
        console.log('🔍 FIREBASE AUTH: User signed in during registration, skipping profile fetch');
        // Don't update auth state during registration to prevent navigation
      }
    });

    return () => {
      console.log('🔍 FIREBASE AUTH: Cleaning up auth listener');
      unsubscribe();
    };
  }, [isRegistering]);

  return (
    <AuthContext.Provider value={{ 
      user, 
      userType, 
      userName,
      isLoading, 
  isBlocked,
      signIn,
      signUp,
      signOut, 
      resetPassword,
      updateUserPassword,
      sendVerificationEmail,
      isEmailVerified,
      rememberLogin, 
      setRememberLogin,
      saveEmail,
      loadSavedEmail
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
