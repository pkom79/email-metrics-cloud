import { NextResponse } from 'next/server';
import { getServerUser } from '../../../lib/supabase/auth';
import { createServiceClient } from '../../../lib/supabase/server';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';

// Debug endpoint to check current state of uploads, accounts, and cookies
export async function GET() {
  try {
    console.log('=== DEBUG STATE CHECK ===');
    const user = await getServerUser();
    console.log('Current user:', user ? { id: user.id, email: user.email } : 'Not authenticated');

    const cookieStore = cookies();
    const pendingCookie = cookieStore.get('pending-upload-ids')?.value;
    console.log('Pending uploads cookie:', pendingCookie);

    const supabase = createServiceClient();

    // Check recent uploads
    const { data: uploads } = await supabase
      .from('uploads')
      .select('id, status, account_id, created_at, expires_at')
      .order('created_at', { ascending: false })
      .limit(10);
    
    console.log('Recent uploads:', uploads);

    // Check accounts
    const { data: accounts } = await supabase
      .from('accounts')
      .select('id, owner_user_id, name, created_at')
      .order('created_at', { ascending: false })
      .limit(5);
    
    console.log('Recent accounts:', accounts);

    // Check snapshots
    const { data: snapshots } = await supabase
      .from('snapshots')
      .select('id, account_id, upload_id, created_at')
      .order('created_at', { ascending: false })
      .limit(5);
    
    console.log('Recent snapshots:', snapshots);

    // If user is authenticated, check their specific data
    let userAccount = null;
    let userUploads = null;
    let userSnapshots = null;
    
    if (user) {
      const { data: acct } = await supabase
        .from('accounts')
        .select('*')
        .eq('owner_user_id', user.id)
        .maybeSingle();
      userAccount = acct;
      
      if (acct) {
        const { data: userUps } = await supabase
          .from('uploads')
          .select('*')
          .eq('account_id', acct.id);
        userUploads = userUps;
        
        const { data: userSnaps } = await supabase
          .from('snapshots')
          .select('*')
          .eq('account_id', acct.id);
        userSnapshots = userSnaps;
      }
    }

    return NextResponse.json({
      user: user ? { id: user.id, email: user.email } : null,
      pendingCookie,
      userAccount,
      userUploads,
      userSnapshots,
      allUploads: uploads,
      allAccounts: accounts,
      allSnapshots: snapshots,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error('Debug state check error:', error);
    return NextResponse.json({ 
      error: error.message || 'Debug check failed',
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}
