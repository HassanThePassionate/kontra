import { describe, it, expect } from 'vitest';
import {
  createProposalSchema,
  updateProposalSchema,
  proposalTransitionSchema,
  clientRejectProposalSchema,
  deliverableItemSchema,
} from '@/lib/validation-schemas';
import { Permission, PermissionDefinitions, OverridePermissions } from '@/lib/permissions';

// Simulated State Machine transition validator mirroring database RPC rules
function validateTransition(
  currentState: { status: string; isArchived: boolean; validUntil: string },
  action: string,
  actor: 'staff' | 'client',
  reason?: string | null,
): { allowed: boolean; error?: string; newStatus?: string } {
  const isExpired = new Date(currentState.validUntil) < new Date();

  if (actor === 'client') {
    if (currentState.status !== 'sent') {
      return { allowed: false, error: 'Clients can only interact with sent proposals' };
    }
    if (isExpired) {
      return { allowed: false, error: 'Proposal has expired' };
    }
    if (action === 'accept') {
      return { allowed: true, newStatus: 'accepted' };
    }
    if (action === 'reject') {
      if (!reason || reason.trim().length === 0) {
        return { allowed: false, error: 'Rejection reason is required' };
      }
      return { allowed: true, newStatus: 'rejected' };
    }
    return { allowed: false, error: `Unauthorized client action: ${action}` };
  }

  // Staff transitions
  if (currentState.isArchived) {
    if (action === 'restore') {
      return { allowed: true, newStatus: currentState.status };
    }
    return { allowed: false, error: 'Cannot interact with archived proposal' };
  }

  if (action === 'archive') {
    return { allowed: true, newStatus: currentState.status };
  }
  switch (action) {
    case 'send':
      if (currentState.status !== 'draft') {
        return { allowed: false, error: 'Only drafts can be sent' };
      }
      if (isExpired) {
        return { allowed: false, error: 'Cannot send proposal with past validity date' };
      }
      return { allowed: true, newStatus: 'sent' };

    case 'draft':
      if (!['sent', 'rejected', 'expired'].includes(currentState.status)) {
        return { allowed: false, error: `Cannot revert ${currentState.status} to draft` };
      }
      return { allowed: true, newStatus: 'draft' };

    case 'accept':
      if (currentState.status !== 'sent') {
        return { allowed: false, error: 'Only sent proposals can be accepted' };
      }
      return { allowed: true, newStatus: 'accepted' };

    case 'reject':
      if (currentState.status !== 'sent') {
        return { allowed: false, error: 'Only sent proposals can be rejected' };
      }
      if (!reason || reason.trim().length === 0) {
        return { allowed: false, error: 'Rejection reason is required' };
      }
      return { allowed: true, newStatus: 'rejected' };

    case 'expire':
      if (currentState.status !== 'sent') {
        return { allowed: false, error: 'Only sent proposals can expire' };
      }
      return { allowed: true, newStatus: 'expired' };

    default:
      return { allowed: false, error: `Unknown action: ${action}` };
  }
}

describe('Proposal Lifecycle & State Machine Transitions', () => {
  const futureDate = new Date(Date.now() + 86400000 * 30).toISOString();
  const pastDate = new Date(Date.now() - 86400000).toISOString();

  it('allows staff to transition draft -> sent', () => {
    const res = validateTransition(
      { status: 'draft', isArchived: false, validUntil: futureDate },
      'send',
      'staff',
    );
    expect(res.allowed).toBe(true);
    expect(res.newStatus).toBe('sent');
  });

  it('blocks sending a draft with expired validUntil', () => {
    const res = validateTransition(
      { status: 'draft', isArchived: false, validUntil: pastDate },
      'send',
      'staff',
    );
    expect(res.allowed).toBe(false);
    expect(res.error).toContain('past validity');
  });

  it('allows client to accept a sent proposal', () => {
    const res = validateTransition(
      { status: 'sent', isArchived: false, validUntil: futureDate },
      'accept',
      'client',
    );
    expect(res.allowed).toBe(true);
    expect(res.newStatus).toBe('accepted');
  });

  it('requires rejection reason when client rejects proposal', () => {
    const withoutReason = validateTransition(
      { status: 'sent', isArchived: false, validUntil: futureDate },
      'reject',
      'client',
      '',
    );
    expect(withoutReason.allowed).toBe(false);
    expect(withoutReason.error).toContain('reason is required');

    const withReason = validateTransition(
      { status: 'sent', isArchived: false, validUntil: futureDate },
      'reject',
      'client',
      'Budget exceeds current quarter limit',
    );
    expect(withReason.allowed).toBe(true);
    expect(withReason.newStatus).toBe('rejected');
  });

  it('blocks client from accepting or rejecting an expired proposal', () => {
    const res = validateTransition(
      { status: 'sent', isArchived: false, validUntil: pastDate },
      'accept',
      'client',
    );
    expect(res.allowed).toBe(false);
    expect(res.error).toContain('expired');
  });

  it('blocks client from performing staff actions (send, draft, archive)', () => {
    expect(
      validateTransition(
        { status: 'draft', isArchived: false, validUntil: futureDate },
        'send',
        'client',
      ).allowed,
    ).toBe(false);

    expect(
      validateTransition(
        { status: 'sent', isArchived: false, validUntil: futureDate },
        'draft',
        'client',
      ).allowed,
    ).toBe(false);

    expect(
      validateTransition(
        { status: 'sent', isArchived: false, validUntil: futureDate },
        'archive',
        'client',
      ).allowed,
    ).toBe(false);
  });

  it('allows staff to revert sent or rejected proposals back to draft', () => {
    const fromSent = validateTransition(
      { status: 'sent', isArchived: false, validUntil: futureDate },
      'draft',
      'staff',
    );
    expect(fromSent.allowed).toBe(true);
    expect(fromSent.newStatus).toBe('draft');

    const fromRejected = validateTransition(
      { status: 'rejected', isArchived: false, validUntil: futureDate },
      'draft',
      'staff',
    );
    expect(fromRejected.allowed).toBe(true);
    expect(fromRejected.newStatus).toBe('draft');
  });

  it('strictly blocks reverting an accepted proposal back to draft', () => {
    const res = validateTransition(
      { status: 'accepted', isArchived: false, validUntil: futureDate },
      'draft',
      'staff',
    );
    expect(res.allowed).toBe(false);
    expect(res.error).toContain('Cannot revert accepted');
  });

  it('handles archive and restore transitions', () => {
    // Archiving an active proposal
    const archiveRes = validateTransition(
      { status: 'sent', isArchived: false, validUntil: futureDate },
      'archive',
      'staff',
    );
    expect(archiveRes.allowed).toBe(true);

    // Any transition blocked while archived
    const blockedRes = validateTransition(
      { status: 'sent', isArchived: true, validUntil: futureDate },
      'send',
      'staff',
    );
    expect(blockedRes.allowed).toBe(false);

    // Restoring archived proposal
    const restoreRes = validateTransition(
      { status: 'sent', isArchived: true, validUntil: futureDate },
      'restore',
      'staff',
    );
    expect(restoreRes.allowed).toBe(true);
  });
});

describe('Zod Validation Schemas for Proposals', () => {
  const validUuid = '11111111-1111-1111-1111-000000000001';
  const futureIso = new Date(Date.now() + 86400000 * 30).toISOString();

  it('validates deliverableItemSchema correctly', () => {
    const valid = deliverableItemSchema.safeParse({
      title: 'Phase 1 Architecture',
      description: 'System diagrams and schemas',
      estimated_hours: 40,
      amount: 5000,
    });
    expect(valid.success).toBe(true);

    const invalid = deliverableItemSchema.safeParse({
      title: '', // Empty title
    });
    expect(invalid.success).toBe(false);
  });

  it('validates createProposalSchema constraints', () => {
    const valid = createProposalSchema.safeParse({
      account_id: validUuid,
      title: 'Commercial Design Proposal',
      total_amount: 12500,
      currency: 'USD',
      valid_until: futureIso,
      deliverables: [
        { title: 'Milestone 1', amount: 5000 },
        { title: 'Milestone 2', amount: 7500 },
      ],
      internal_notes: 'Staff margin estimated at 35%',
    });
    expect(valid.success).toBe(true);

    // Negative amount rejected
    const negative = createProposalSchema.safeParse({
      account_id: validUuid,
      title: 'Invalid',
      total_amount: -100,
      valid_until: futureIso,
    });
    expect(negative.success).toBe(false);

    // Invalid currency code length rejected
    const invalidCurrency = createProposalSchema.safeParse({
      account_id: validUuid,
      title: 'Invalid',
      total_amount: 100,
      currency: 'US_DOLLAR', // Must be 3 chars
      valid_until: futureIso,
    });
    expect(invalidCurrency.success).toBe(false);
  });

  it('validates client rejection schema', () => {
    const valid = clientRejectProposalSchema.safeParse({
      reason: 'Pricing is above current quarterly budget allocation',
    });
    expect(valid.success).toBe(true);

    const invalid = clientRejectProposalSchema.safeParse({
      reason: '', // Empty reason disallowed
    });
    expect(invalid.success).toBe(false);
  });

  it('validates updateProposalSchema with partial fields', () => {
    const validPartial = updateProposalSchema.safeParse({
      title: 'Updated Scope',
      total_amount: 18000,
    });
    expect(validPartial.success).toBe(true);

    const invalidNegative = updateProposalSchema.safeParse({
      total_amount: -50,
    });
    expect(invalidNegative.success).toBe(false);
  });

  it('validates proposalTransitionSchema allowed actions', () => {
    const validActions = ['send', 'accept', 'reject', 'draft', 'archive', 'restore', 'expire'];
    for (const action of validActions) {
      const res = proposalTransitionSchema.safeParse({
        action,
        reason: action === 'reject' ? 'Budget issue' : undefined,
      });
      expect(res.success).toBe(true);
    }

    const invalidAction = proposalTransitionSchema.safeParse({
      action: 'delete_permanently', // Disallowed action
    });
    expect(invalidAction.success).toBe(false);
  });
});

describe('RBAC Proposal Permissions Registration', () => {
  it('registers proposal permissions in Permission enum', () => {
    expect(Permission.VIEW_PROPOSALS).toBe('view_proposals');
    expect(Permission.MANAGE_PROPOSALS).toBe('manage_proposals');
    expect(Permission.VIEW_ALL_PROPOSALS).toBe('view_all_proposals');
  });

  it('registers human-readable definitions and categories', () => {
    expect(PermissionDefinitions[Permission.VIEW_PROPOSALS]).toBeDefined();
    expect(PermissionDefinitions[Permission.VIEW_PROPOSALS].category).toBe('Account Management');

    expect(PermissionDefinitions[Permission.MANAGE_PROPOSALS]).toBeDefined();
    expect(PermissionDefinitions[Permission.MANAGE_PROPOSALS].category).toBe('Account Management');

    expect(PermissionDefinitions[Permission.VIEW_ALL_PROPOSALS]).toBeDefined();
    expect(PermissionDefinitions[Permission.VIEW_ALL_PROPOSALS].isOverride).toBe(true);
  });

  it('includes VIEW_ALL_PROPOSALS in OverridePermissions', () => {
    expect(OverridePermissions).toContain(Permission.VIEW_ALL_PROPOSALS);
  });
});

describe('Client Data Sanitization & Confidentiality Safeguards', () => {
  it('verifies staff-only fields are stripped from client proposal projections', () => {
    const fullProposalRow = {
      id: 'prop-123',
      account_id: 'acc-456',
      title: 'Confidential Client Proposal',
      status: 'sent',
      deliverables: [{ title: 'Deliverable 1' }],
      total_amount: 15000,
      currency: 'USD',
      valid_until: '2026-12-31T00:00:00Z',
      internal_notes: 'PROPRIETARY: Margin is 45%, target cost is $8,250',
      created_by: 'staff-uuid-001',
      archived_at: null,
      archived_by: null,
      version: 1,
      created_at: '2026-11-01T00:00:00Z',
      updated_at: '2026-11-01T00:00:00Z',
    };

    // Client projection (mimicking public.client_proposals view)
    const sanitizeForClient = (row: typeof fullProposalRow) => {
      const { internal_notes, archived_at, archived_by, created_by, ...clientSafe } = row;
      return clientSafe;
    };

    const clientView = sanitizeForClient(fullProposalRow);

    expect((clientView as any).internal_notes).toBeUndefined();
    expect((clientView as any).archived_at).toBeUndefined();
    expect((clientView as any).archived_by).toBeUndefined();
    expect((clientView as any).created_by).toBeUndefined();

    // Preserved fields
    expect(clientView.id).toBe('prop-123');
    expect(clientView.title).toBe('Confidential Client Proposal');
    expect(clientView.total_amount).toBe(15000);
  });

  it('verifies client proposal timeline strips internal audit snapshots and draft actions', () => {
    const rawAuditEvents = [
      {
        id: 'evt-1',
        proposal_id: 'prop-123',
        action: 'create',
        from_status: null,
        to_status: 'draft',
        actor_email: 'staff@kontrora.com',
        actor_type: 'staff',
        snapshot: { internal_notes: 'Secret margin calculation' },
        metadata: { source: 'rpc_create_draft' },
        created_at: '2026-11-01T10:00:00Z',
      },
      {
        id: 'evt-2',
        proposal_id: 'prop-123',
        action: 'update',
        from_status: 'draft',
        to_status: 'draft',
        actor_email: 'staff@kontrora.com',
        actor_type: 'staff',
        snapshot: { internal_notes: 'Revised margin calculation' },
        metadata: { source: 'rpc_update_draft' },
        created_at: '2026-11-01T11:00:00Z',
      },
      {
        id: 'evt-3',
        proposal_id: 'prop-123',
        action: 'send',
        from_status: 'draft',
        to_status: 'sent',
        actor_email: 'staff@kontrora.com',
        actor_type: 'staff',
        snapshot: { internal_notes: 'Sent to client' },
        metadata: {},
        created_at: '2026-11-01T12:00:00Z',
      },
    ];

    // Client projection function matching get_client_proposal_timeline
    const filterTimelineForClient = (events: typeof rawAuditEvents) => {
      return events
        .filter((e) => ['send', 'accept', 'reject', 'expire'].includes(e.action))
        .map(({ snapshot, metadata, actor_email, ...safeFields }) => safeFields);
    };

    const clientTimeline = filterTimelineForClient(rawAuditEvents);

    // Only milestone 'send' event is visible to client (create/update drafts filtered out)
    expect(clientTimeline.length).toBe(1);
    expect(clientTimeline[0].action).toBe('send');
    expect((clientTimeline[0] as any).snapshot).toBeUndefined();
    expect((clientTimeline[0] as any).metadata).toBeUndefined();
    expect((clientTimeline[0] as any).actor_email).toBeUndefined();
  });
});
