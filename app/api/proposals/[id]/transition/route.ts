import { NextRequest, NextResponse } from 'next/server';
import {
  createApiSupabaseClient,
  getUserFromRequest,
  getUserProfileFromRequest,
} from '@/lib/supabase-server';
import { proposalTransitionSchema } from '@/lib/validation-schemas';
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

    const body = await request.json();
    const validation = proposalTransitionSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.format() },
        { status: 400 },
      );
    }

    // execute_proposal_transition RPC handles both staff and client role enforcement,
    // state checks, concurrency locking, and audit snapshotting atomically.
    const proposal = await transitionProposal(supabase as any, id, validation.data);

    return NextResponse.json({
      success: true,
      proposal,
      message: `Proposal transition "${validation.data.action}" completed successfully`,
    });
  } catch (error: any) {
    logger.error('Error in POST /api/proposals/[id]/transition', {}, error);
    const message = error?.message || 'Internal server error';
    const status = message.includes('Permission denied') || message.includes('Access denied') ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

