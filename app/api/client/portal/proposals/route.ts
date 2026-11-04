import { NextRequest, NextResponse } from 'next/server';
import {
  createApiSupabaseClient,
  getUserFromRequest,
  getUserProfileFromRequest,
} from '@/lib/supabase-server';
import { getClientProposals } from '@/lib/proposal-service';
import { logger } from '@/lib/debug-logger';

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createApiSupabaseClient(request);
    if (!supabase) {
      return NextResponse.json({ error: 'Database connection failed' }, { status: 500 });
    }

    const userProfile = await getUserProfileFromRequest(supabase);
    if (!userProfile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 });
    }

    if (!userProfile.is_client) {
      return NextResponse.json(
        { error: 'Access denied: Client portal is reserved for client users' },
        { status: 403 },
      );
    }

    if (!userProfile.client_account_id) {
      return NextResponse.json(
        { error: 'Client user is not associated with an account' },
        { status: 400 },
      );
    }

    const proposals = await getClientProposals(supabase as any, userProfile.client_account_id);

    return NextResponse.json({ success: true, proposals });
  } catch (error: any) {
    logger.error('Error in GET /api/client/portal/proposals', {}, error);
    return NextResponse.json(
      { error: error?.message || 'Internal server error' },
      { status: 500 },
    );
  }
}

