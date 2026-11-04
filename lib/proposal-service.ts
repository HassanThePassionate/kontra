/**
 * Proposal Service Layer
 *
 * Provides type-safe access to proposals, lifecycle transitions,
 * audit history, and client portal views. All write operations invoke
 * the audited database RPCs to enforce immutability and concurrency controls.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Proposal, ProposalHistory } from './supabase';
import type {
  CreateProposalInput,
  UpdateProposalInput,
  ProposalTransitionInput,
} from './validation-schemas';
import { logger } from './debug-logger';

export interface ProposalFilterOptions {
  accountId?: string;
  status?: string;
  includeArchived?: boolean;
}

export interface ClientTimelineEntry {
  id: string;
  proposal_id: string;
  from_status: string | null;
  to_status: string;
  action: string;
  rejection_reason: string | null;
  actor_type: 'staff' | 'client' | 'system';
  created_at: string;
}

/**
 * List proposals accessible to caller (filtered by account or status)
 */
export async function getProposals(
  supabase: SupabaseClient<Database>,
  options: ProposalFilterOptions = {},
): Promise<Proposal[]> {
  try {
    let query = supabase
      .from('proposals')
      .select('*, accounts(id, name)')
      .order('created_at', { ascending: false });

    if (options.accountId) {
      query = query.eq('account_id', options.accountId);
    }

    if (options.status) {
      query = query.eq('status', options.status);
    }

    if (!options.includeArchived) {
      query = query.is('archived_at', null);
    }

    const { data, error } = await query;
    if (error) {
      logger.error('Error fetching proposals', { options }, error);
      throw error;
    }

    return (data as unknown as Proposal[]) || [];
  } catch (err) {
    logger.error('getProposals failed', { options }, err);
    throw err;
  }
}

/**
 * Get a single proposal by ID with related account info
 */
export async function getProposalById(
  supabase: SupabaseClient<Database>,
  proposalId: string,
): Promise<Proposal | null> {
  try {
    const { data, error } = await supabase
      .from('proposals')
      .select('*, accounts(id, name)')
      .eq('id', proposalId)
      .maybeSingle();

    if (error) {
      logger.error('Error fetching proposal by ID', { proposalId }, error);
      throw error;
    }

    return (data as unknown as Proposal) || null;
  } catch (err) {
    logger.error('getProposalById failed', { proposalId }, err);
    throw err;
  }
}

/**
 * Create a new draft proposal via audited RPC
 */
export async function createProposal(
  supabase: SupabaseClient<Database>,
  input: CreateProposalInput,
): Promise<Proposal> {
  try {
    const { data, error } = await (supabase as any).rpc('create_draft_proposal', {
      p_account_id: input.account_id,
      p_title: input.title,
      p_total_amount: input.total_amount,
      p_currency: input.currency || 'USD',
      p_valid_until: input.valid_until,
      p_deliverables: input.deliverables || [],
      p_internal_notes: input.internal_notes || null,
    });

    if (error) {
      logger.error('create_draft_proposal RPC error', { input }, error);
      throw error;
    }

    return data as unknown as Proposal;
  } catch (err) {
    logger.error('createProposal failed', { input }, err);
    throw err;
  }
}

/**
 * Update a draft proposal via audited RPC
 */
export async function updateProposal(
  supabase: SupabaseClient<Database>,
  proposalId: string,
  input: UpdateProposalInput,
): Promise<Proposal> {
  try {
    const { data, error } = await (supabase as any).rpc('update_draft_proposal', {
      p_proposal_id: proposalId,
      p_title: input.title || null,
      p_total_amount: input.total_amount !== undefined ? input.total_amount : null,
      p_currency: input.currency || null,
      p_valid_until: input.valid_until || null,
      p_deliverables: input.deliverables || null,
      p_internal_notes: input.internal_notes || null,
    });

    if (error) {
      logger.error('update_draft_proposal RPC error', { proposalId, input }, error);
      throw error;
    }

    return data as unknown as Proposal;
  } catch (err) {
    logger.error('updateProposal failed', { proposalId, input }, err);
    throw err;
  }
}

/**
 * Execute proposal lifecycle state transition via audited RPC
 */
export async function transitionProposal(
  supabase: SupabaseClient<Database>,
  proposalId: string,
  input: ProposalTransitionInput,
): Promise<Proposal> {
  try {
    const { data, error } = await (supabase as any).rpc('execute_proposal_transition', {
      p_proposal_id: proposalId,
      p_action: input.action,
      p_reason: input.reason || null,
      p_metadata: input.metadata || {},
    });

    if (error) {
      logger.error('execute_proposal_transition RPC error', { proposalId, input }, error);
      throw error;
    }

    return data as unknown as Proposal;
  } catch (err) {
    logger.error('transitionProposal failed', { proposalId, input }, err);
    throw err;
  }
}

/**
 * Get client-sanitized proposal timeline (safe for client portal)
 */
export async function getClientProposalTimeline(
  supabase: SupabaseClient<Database>,
  proposalId: string,
): Promise<ClientTimelineEntry[]> {
  try {
    const { data, error } = await (supabase as any).rpc('get_client_proposal_timeline', {
      p_proposal_id: proposalId,
    });

    if (error) {
      logger.error('get_client_proposal_timeline RPC error', { proposalId }, error);
      throw error;
    }

    return (data as unknown as ClientTimelineEntry[]) || [];
  } catch (err) {
    logger.error('getClientProposalTimeline failed', { proposalId }, err);
    throw err;
  }
}

/**
 * Get full staff proposal audit history
 */
export async function getStaffProposalAuditHistory(
  supabase: SupabaseClient<Database>,
  proposalId: string,
): Promise<ProposalHistory[]> {
  try {
    const { data, error } = await (supabase as any).rpc('get_staff_proposal_audit_history', {
      p_proposal_id: proposalId,
    });

    if (error) {
      logger.error('get_staff_proposal_audit_history RPC error', { proposalId }, error);
      throw error;
    }

    return (data as unknown as ProposalHistory[]) || [];
  } catch (err) {
    logger.error('getStaffProposalAuditHistory failed', { proposalId }, err);
    throw err;
  }
}

/**
 * Get client proposals from client-safe view
 */
export async function getClientProposals(
  supabase: SupabaseClient<Database>,
  accountId: string,
): Promise<Omit<Proposal, 'internal_notes' | 'archived_at' | 'archived_by'>[]> {
  try {
    const { data, error } = await (supabase as any)
      .from('client_proposals')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Error fetching client proposals from view', { accountId }, error);
      throw error;
    }

    return data || [];
  } catch (err) {
    logger.error('getClientProposals failed', { accountId }, err);
    throw err;
  }
}
