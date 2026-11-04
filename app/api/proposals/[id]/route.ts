import { NextRequest, NextResponse } from 'next/server';
import {
  createApiSupabaseClient,
  getUserFromRequest,
  getUserProfileFromRequest,
} from '@/lib/supabase-server';
import { checkPermissionHybrid } from '@/lib/permission-checker';
import { Permission } from '@/lib/permissions';
import { updateProposalSchema } from '@/lib/validation-schemas';
import { getProposalById, updateProposal } from '@/lib/proposal-service';
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

    const proposal = await getProposalById(supabase as any, id);
    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
    }

    // Permission check
    const hasAccess = await checkPermissionHybrid(
      userProfile,
      Permission.VIEW_PROPOSALS,
      { accountId: proposal.account_id },
      supabase,
    );

    if (!hasAccess && !userProfile.is_superadmin) {
      return NextResponse.json({ error: 'Forbidden: Insufficient permissions' }, { status: 403 });
    }

    return NextResponse.json({ success: true, proposal });
  } catch (error: any) {
    logger.error('Error in GET /api/proposals/[id]', {}, error);
    return NextResponse.json(
      { error: error?.message || 'Internal server error' },
      { status: 500 },
    );
  }
}

export async function PATCH(
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

    const currentProposal = await getProposalById(supabase as any, id);
    if (!currentProposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
    }

    const hasAccess = await checkPermissionHybrid(
      userProfile,
      Permission.MANAGE_PROPOSALS,
      { accountId: currentProposal.account_id },
      supabase,
    );

    if (!hasAccess && !userProfile.is_superadmin) {
      return NextResponse.json(
        { error: 'Forbidden: Cannot edit this proposal' },
        { status: 403 },
      );
    }

    const body = await request.json();
    const validation = updateProposalSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.format() },
        { status: 400 },
      );
    }

    const updated = await updateProposal(supabase as any, id, validation.data);

    return NextResponse.json({ success: true, proposal: updated });
  } catch (error: any) {
    logger.error('Error in PATCH /api/proposals/[id]', {}, error);
    return NextResponse.json(
      { error: error?.message || 'Internal server error' },
      { status: 500 },
    );
  }
}

