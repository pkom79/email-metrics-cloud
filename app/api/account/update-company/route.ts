import { NextResponse } from 'next/server';
import { getServerUser } from '../../../../../lib/supabase/auth';
import { createServiceClient } from '../../../../../lib/supabase/server';

export const runtime = 'nodejs';

function normalizeStoreUrl(input: unknown) {
  if (typeof input !== 'string') return '';
  let v = input.trim();
  if (!v) return '';
  v = v.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
  return v.toLowerCase();
}

export async function POST(req: Request) {
  try {
    const user = await getServerUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const payload = await req.json().catch(() => ({}));
    const businessName = typeof payload?.businessName === 'string' ? payload.businessName.trim() : '';
    const storeUrl = normalizeStoreUrl(payload?.storeUrl);
    const accountIdRaw = typeof payload?.accountId === 'string' ? payload.accountId.trim() : '';

    const isAdmin = (user.app_metadata as any)?.role === 'admin' || (user.app_metadata as any)?.app_role === 'admin';

    const supabase = createServiceClient();

    let targetAccountId = accountIdRaw;
    if (!targetAccountId) {
      const { data, error } = await supabase
        .from('accounts')
        .select('id')
        .eq('owner_user_id', user.id);
      if (error) throw error;
      if (!data?.length) {
        return NextResponse.json({ error: 'Account not found' }, { status: 404 });
      }
      if (data.length > 1) {
        return NextResponse.json({ error: 'Multiple accounts found. Specify accountId.' }, { status: 400 });
      }
      targetAccountId = data[0].id;
    }

    const { data: account, error: fetchErr } = await supabase
      .from('accounts')
      .select('id, owner_user_id')
      .eq('id', targetAccountId)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }
    if (!isAdmin && account.owner_user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const updates: Record<string, string | null> = {
      company: businessName ? businessName : null,
      store_url: storeUrl ? storeUrl : null,
    };

    const { error: updateErr } = await supabase
      .from('accounts')
      .update(updates)
      .eq('id', account.id);
    if (updateErr) throw updateErr;

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    const message = error?.message || 'Failed to update account';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
