import { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCurrentUserProfileServer } from '@/lib/auth-server';
import { accountService } from '@/lib/account-service';
import { hasPermission } from '@/lib/rbac';
import { Permission } from '@/lib/permissions';
import { createServerSupabase, createAdminSupabaseClient } from '@/lib/supabase-server';
import { AccountProposalsSection } from '@/components/proposals/account-proposals-section';
import { ArrowLeft } from 'lucide-react';

interface PageProps {
  params: Promise<{
    accountId: string;
  }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { accountId } = await params;
  const supabase = await createServerSupabase();
  if (!supabase) return { title: 'Account Proposals' };

  const { data: account } = await supabase
    .from('accounts')
    .select('name')
    .eq('id', accountId)
    .single();

  return {
    title: `${account?.name || 'Account'} — Proposals`,
  };
}

export default async function AccountProposalsPage({ params }: PageProps) {
  const { accountId } = await params;

  const userProfile = await getCurrentUserProfileServer();
  if (!userProfile) {
    return (
      <div className="container mx-auto p-6 text-center">
        <h1 className="text-xl font-bold text-zinc-100">Access Denied</h1>
        <p className="text-sm text-zinc-400 mt-2">Please log in to view proposals.</p>
      </div>
    );
  }

  const supabase = await createServerSupabase();
  if (!supabase) {
    return (
      <div className="container mx-auto p-6 text-center">
        <h1 className="text-xl font-bold text-zinc-100">Database Connection Error</h1>
      </div>
    );
  }

  // Permission check
  const [canViewProposals, canManageProposals, hasAllAccounts] = await Promise.all([
    hasPermission(userProfile, Permission.VIEW_PROPOSALS, { accountId }),
    hasPermission(userProfile, Permission.MANAGE_PROPOSALS, { accountId }),
    hasPermission(userProfile, Permission.VIEW_ALL_ACCOUNTS),
  ]);

  if (!canViewProposals && !hasAllAccounts && !(userProfile as any).is_superadmin) {
    return (
      <div className="container mx-auto p-6 text-center">
        <h1 className="text-xl font-bold text-zinc-100">Access Denied</h1>
        <p className="text-sm text-zinc-400 mt-2">
          You do not have permission to view proposals for this account.
        </p>
      </div>
    );
  }

  const adminClient = createAdminSupabaseClient();
  const queryClient = adminClient || supabase;
  const account = await accountService.getAccountById(accountId, undefined, queryClient as any);
  if (!account) notFound();

  return (
    <div className="container mx-auto p-6 max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href={`/accounts/${accountId}`}
          className="text-sm text-zinc-400 hover:text-zinc-200 flex items-center gap-1.5 transition"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to {account.name} Overview
        </Link>
      </div>

      <AccountProposalsSection accountId={accountId} canManage={canManageProposals} />
    </div>
  );
}

