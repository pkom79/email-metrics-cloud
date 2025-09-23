import { getServerUser } from '../../../lib/supabase/auth';
import { redirect } from 'next/navigation';

export const metadata = { title: 'Agencies (retired)' };

export default async function AgenciesPage() {
  const user = await getServerUser();
  if (!user) redirect('/signup?mode=signin');
  // Agencies feature retired — redirect to account
  if (user) redirect('/account');
  return null;
}
