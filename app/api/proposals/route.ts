import { NextRequest, NextResponse } from 'next/server';
import {
  createApiSupabaseClient,
  getUserFromRequest,
  getUserProfileFromRequest,
} from '@/lib/supabase-server';
import { checkPermissionHybrid } from '@/lib/permission-checker';
import { Permission } from '@/lib/permissions';
import { createProposalSchema } from '@/lib/validation-schemas';
import { getProposals, createProposal } from '@/lib/proposal-service';
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

    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get('accountId') || undefined;
    const status = searchParams.get('status') || undefined;
    const includeArchived = searchParams.get('includeArchived') === 'true';

    // Check permission
    const hasAccess = await checkPermissionHybrid(
      userProfile,
      Permission.VIEW_PROPOSALS,
      accountId ? { accountId } : undefined,
      supabase,
    );

    if (!hasAccess && !userProfile.is_superadmin) {
      return NextResponse.json({ error: 'Forbidden: Insufficient permissions' }, { status: 403 });
    }

    const proposals = await getProposals(supabase as any, {
      accountId,
      status,
      includeArchived,
    });

    return NextResponse.json({ success: true, proposals });
  } catch (error: any) {
    logger.error('Error in GET /api/proposals', {}, error);
    return NextResponse.json(
      { error: error?.message || 'Internal server error' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const validation = createProposalSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.format() },
        { status: 400 },
      );
    }

    const hasAccess = await checkPermissionHybrid(
      userProfile,
      Permission.MANAGE_PROPOSALS,
      { accountId: validation.data.account_id },
      supabase,
    );

    if (!hasAccess && !userProfile.is_superadmin) {
      return NextResponse.json(
        { error: 'Forbidden: Cannot create proposals for this account' },
        { status: 403 },
      );
    }

    const proposal = await createProposal(supabase as any, validation.data);

    return NextResponse.json({ success: true, proposal }, { status: 201 });
  } catch (error: any) {
    logger.error('Error in POST /api/proposals', {}, error);
    return NextResponse.json(
      { error: error?.message || 'Internal server error' },
      { status: 500 },
    );
  }
}

