import { NextRequest, NextResponse } from 'next/server';
import {
  createApiSupabaseClient,
  getUserFromRequest,
  getUserProfileFromRequest,
} from '@/lib/supabase-server';
import {
  getClientProposalTimeline,
  getStaffProposalAuditHistory,
} from '@/lib/proposal-service';
import { logger } from '@/lib/debug-logger';

export async function GET(
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

    if (userProfile.is_client) {
      const timeline = await getClientProposalTimeline(supabase as any, id);
      return NextResponse.json({ success: true, timeline, isClient: true });
    } else {
      const history = await getStaffProposalAuditHistory(supabase as any, id);
      return NextResponse.json({ success: true, timeline: history, isClient: false });
    }
  } catch (error: any) {
    logger.error('Error in GET /api/proposals/[id]/timeline', {}, error);
    const message = error?.message || 'Internal server error';
    const status = message.includes('Access denied') ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

