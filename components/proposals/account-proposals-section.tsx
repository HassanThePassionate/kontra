'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ProposalStatusBadge } from './proposal-status-badge';
import { ProposalFormDialog } from './proposal-form-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Plus,
  Send,
  Eye,
  FileEdit,
  Archive,
  RefreshCw,
  Loader2,
  Calendar,
  DollarSign,
  PackageCheck,
  AlertCircle,
} from 'lucide-react';
import type { Proposal } from '@/lib/supabase';

interface AccountProposalsSectionProps {
  accountId: string;
  canManage: boolean;
}

export function AccountProposalsSection({
  accountId,
  canManage,
}: AccountProposalsSectionProps) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const fetchProposals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let url = `/api/proposals?accountId=${accountId}&includeArchived=true`;
      if (statusFilter !== 'all') {
        url += `&status=${statusFilter}`;
      }
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch proposals');
      setProposals(data.proposals || []);
    } catch (err: any) {
      setError(err?.message || 'Error fetching proposals');
    } finally {
      setLoading(false);
    }
  }, [accountId, statusFilter]);

  useEffect(() => {
    fetchProposals();
  }, [fetchProposals]);

  const handleSendProposal = async (proposalId: string) => {
    if (!confirm('Are you sure you want to send this proposal to the client?')) return;
    setActionLoadingId(proposalId);
    try {
      const res = await fetch(`/api/proposals/${proposalId}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send proposal');
      fetchProposals();
    } catch (err: any) {
      alert(err?.message || 'Failed to send proposal');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleArchiveToggle = async (proposal: Proposal) => {
    const isArchived = Boolean(proposal.archived_at);
    const action = isArchived ? 'restore' : 'archive';
    if (!confirm(`Are you sure you want to ${action} this proposal?`)) return;

    setActionLoadingId(proposal.id);
    try {
      const res = await fetch(`/api/proposals/${proposal.id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed to ${action} proposal`);
      fetchProposals();
    } catch (err: any) {
      alert(err?.message || `Failed to ${action} proposal`);
    } finally {
      setActionLoadingId(null);
    }
  };

  const filterTabs = [
    { key: 'all', label: 'All' },
    { key: 'draft', label: 'Drafts' },
    { key: 'sent', label: 'Sent' },
    { key: 'accepted', label: 'Accepted' },
    { key: 'rejected', label: 'Rejected' },
    { key: 'expired', label: 'Expired' },
  ];

  return (
    <div className="space-y-4">
      {/* Top Header & Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-zinc-100">Commercial Proposals</h3>
          <p className="text-xs text-zinc-400">
            Create, track, and manage commercial proposals and contract deliverables.
          </p>
        </div>

        {canManage && (
          <Button
            size="sm"
            onClick={() => {
              setSelectedProposal(null);
              setDialogOpen(true);
            }}
            className="bg-cyan-600 hover:bg-cyan-500 text-white flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            New Proposal
          </Button>
        )}
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-zinc-800">
        {filterTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setStatusFilter(tab.key)}
            className={`px-3 py-1 text-xs font-medium rounded-md transition ${
              statusFilter === tab.key
                ? 'bg-zinc-800 text-cyan-400 border border-zinc-700'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-900 text-sm text-rose-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Proposals List */}
      {loading ? (
        <div className="py-12 flex justify-center items-center">
          <Loader2 className="w-6 h-6 animate-spin text-cyan-500" />
        </div>
      ) : proposals.length === 0 ? (
        <div className="py-12 text-center rounded-lg border border-zinc-800 bg-zinc-950/40 p-6">
          <p className="text-zinc-400 text-sm">No proposals found for this account.</p>
          {canManage && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSelectedProposal(null);
                setDialogOpen(true);
              }}
              className="mt-3 border-zinc-700 text-zinc-300"
            >
              Create the first proposal
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {proposals.map((proposal) => {
            const isArchived = Boolean(proposal.archived_at);
            const deliverablesCount = Array.isArray(proposal.deliverables)
              ? proposal.deliverables.length
              : 0;
            const validUntilDate = new Date(proposal.valid_until).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            });

            return (
              <Card
                key={proposal.id}
                className="bg-zinc-900/60 border-zinc-800 hover:border-zinc-700 transition"
              >
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <Link
                        href={`/accounts/${accountId}/proposals/${proposal.id}`}
                        className="text-base font-semibold text-zinc-100 hover:text-cyan-400 transition"
                      >
                        {proposal.title}
                      </Link>
                      <div className="flex items-center gap-2 text-xs text-zinc-400">
                        <span>v{proposal.version}</span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-zinc-500" />
                          Valid: {validUntilDate}
                        </span>
                      </div>
                    </div>
                    <ProposalStatusBadge status={proposal.status} isArchived={isArchived} />
                  </div>

                  {/* Financial & Deliverables Summary */}
                  <div className="flex items-center justify-between text-xs py-2 px-3 rounded bg-zinc-950/60 border border-zinc-800/80">
                    <div className="flex items-center gap-1.5 font-semibold text-zinc-200">
                      <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
                      <span>
                        {Number(proposal.total_amount).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                        })}{' '}
                        {proposal.currency}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-zinc-400">
                      <PackageCheck className="w-3.5 h-3.5 text-zinc-500" />
                      <span>{deliverablesCount} Deliverables</span>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center justify-between pt-2 border-t border-zinc-800/60 text-xs">
                    <Link
                      href={`/accounts/${accountId}/proposals/${proposal.id}`}
                      className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-medium"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      View Details
                    </Link>

                    <div className="flex items-center gap-1.5">
                      {canManage && proposal.status === 'draft' && !isArchived && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedProposal(proposal);
                              setDialogOpen(true);
                            }}
                            className="h-7 text-xs text-zinc-300 hover:text-white"
                          >
                            <FileEdit className="w-3 h-3 mr-1" />
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            disabled={actionLoadingId === proposal.id}
                            onClick={() => handleSendProposal(proposal.id)}
                            className="h-7 text-xs bg-blue-600 hover:bg-blue-500 text-white"
                          >
                            {actionLoadingId === proposal.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Send className="w-3 h-3 mr-1" />
                            )}
                            Send
                          </Button>
                        </>
                      )}

                      {canManage && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={actionLoadingId === proposal.id}
                          onClick={() => handleArchiveToggle(proposal)}
                          className="h-7 text-xs text-zinc-400 hover:text-zinc-200"
                        >
                          {isArchived ? (
                            <>
                              <RefreshCw className="w-3 h-3 mr-1" /> Restore
                            </>
                          ) : (
                            <>
                              <Archive className="w-3 h-3 mr-1" /> Archive
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <ProposalFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        accountId={accountId}
        initialData={
          selectedProposal
            ? {
                id: selectedProposal.id,
                title: selectedProposal.title,
                total_amount: Number(selectedProposal.total_amount),
                currency: selectedProposal.currency,
                valid_until: selectedProposal.valid_until,
                deliverables: selectedProposal.deliverables as any,
                internal_notes: selectedProposal.internal_notes,
              }
            : null
        }
        onSuccess={fetchProposals}
      />
    </div>
  );
}

