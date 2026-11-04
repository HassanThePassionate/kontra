import { NextRequest, NextResponse } from 'next/server';
import {
  createApiSupabaseClient,
  getUserFromRequest,
  getUserProfileFromRequest,
} from '@/lib/supabase-server';
import { clientRejectProposalSchema } from '@/lib/validation-schemas';
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
        { error: 'Access denied: Only client users can reject proposals' },
        { status: 403 },
      );
    }

    const body = await request.json();
    const validation = clientRejectProposalSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'A rejection reason is required', details: validation.error.format() },
        { status: 400 },
      );
    }

    // Call RPC transition with 'reject' and mandatory reason
    const proposal = await transitionProposal(supabase as any, id, {
      action: 'reject',
      reason: validation.data.reason,
      metadata: { source: 'client_portal_reject' },
    });

    return NextResponse.json({
      success: true,
      proposal,
      message: 'Proposal has been rejected with feedback',
    });
  } catch (error: any) {
    logger.error('Error in POST /api/client/portal/proposals/[id]/reject', {}, error);
    const message = error?.message || 'Failed to reject proposal';
    const status = message.includes('Access denied') || message.includes('Unauthorized') ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

