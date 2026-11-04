import { NextRequest, NextResponse } from 'next/server';
import {
  createApiSupabaseClient,
  getUserFromRequest,
  getUserProfileFromRequest,
} from '@/lib/supabase-server';
import { transitionProposal } from '@/lib/proposal-service';
import { logger } from '@/lib/debug-logger';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
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
        { error: 'Access denied: Only client users can accept proposals' },
        { status: 403 },
      );
    }

    // Call RPC transition with 'accept'
    const proposal = await transitionProposal(supabase as any, id, {
      action: 'accept',
      metadata: { source: 'client_portal_accept' },
    });

    return NextResponse.json({
      success: true,
      proposal,
      message: 'Proposal accepted successfully',
    });
  } catch (error: any) {
    logger.error('Error in POST /api/client/portal/proposals/[id]/accept', {}, error);
    const message = error?.message || 'Failed to accept proposal';
    const status = message.includes('Access denied') || message.includes('Unauthorized') ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

