import { createClient } from '@supabase/supabase-js';
import type { Session } from '@supabase/supabase-js';

// Global auth state manager - singleton pattern
class AuthManager {
  private static instance: AuthManager;
  private client: any;
  private session: Session | null = null;
  private sessionPromise: Promise<Session | null> | null = null;
  private lastFetch = 0;
  private readonly CACHE_TTL = 30000; // 30 seconds cache
  private readonly MIN_REQUEST_INTERVAL = 5000; // Minimum 5 seconds between requests

  private constructor() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !anon) {
      const err = new Error('Supabase env not set');
      this.client = new Proxy({}, { get() { throw err; } });
      return;
    }

    // Create client with auth features suitable for account management flows
    this.client = createClient(url, anon, {
      storage: { useNewHostname: true },
      auth: {
        debug: false,
        persistSession: true,
        // Enable refresh so sensitive operations (update email/password) work reliably
        autoRefreshToken: true,
        // We explicitly handle OTP flows via verifyOtp, so leave URL detection off
        detectSessionInUrl: false
      }
    } as any);
  }

  public static getInstance(): AuthManager {
    if (!AuthManager.instance) {
      AuthManager.instance = new AuthManager();
    }
    return AuthManager.instance;
  }

  public async getSession(): Promise<Session | null> {
    const now = Date.now();
    
    // Return cached session if recent
    if (this.session && (now - this.lastFetch) < this.CACHE_TTL) {
      return this.session;
    }

    // If another request is in flight, wait for it
    if (this.sessionPromise) {
      return this.sessionPromise;
    }

    // Rate limit: don't make requests too frequently
    if ((now - this.lastFetch) < this.MIN_REQUEST_INTERVAL) {
      console.log('Rate limiting auth request');
      return this.session;
    }

    // Create new request
    this.sessionPromise = this.fetchSession();
    const result = await this.sessionPromise;
    this.sessionPromise = null;
    
    return result;
  }

  private async fetchSession(): Promise<Session | null> {
    try {
      this.lastFetch = Date.now();
      console.log('Fetching session from Supabase');
      
      const { data: { session }, error } = await this.client.auth.getSession();
      
      if (error) {
        console.error('Session fetch error:', error);
        return null;
      }

      this.session = session;
      return session;
    } catch (error) {
      console.error('Session fetch failed:', error);
      return null;
    }
  }

  public getClient() {
    return this.client;
  }

  public clearSession() {
    this.session = null;
    this.lastFetch = 0;
  }
}

// Export singleton instance
const authManager = AuthManager.getInstance();
export const supabase = authManager.getClient();
export const getCachedSession = () => authManager.getSession();
export const clearAuthSession = () => authManager.clearSession();
