'use client';

import React, { useState, useEffect, useCallback, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ProposalStatusBadge } from '@/components/proposals/proposal-status-badge';
import { ProposalTimeline } from '@/components/proposals/proposal-timeline';
import { ProposalFormDialog } from '@/components/proposals/proposal-form-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  ArrowLeft,
  Send,
  FileEdit,
  RotateCcw,
  CheckCircle,
  XCircle,
  Archive,
  RefreshCw,
  Clock,
  ShieldAlert,
  Loader2,
  DollarSign,
  Calendar,
  Layers,
  AlertCircle,
} from 'lucide-react';
import type { Proposal } from '@/lib/supabase';
import type { DeliverableItemInput } from '@/lib/validation-schemas';

interface PageProps {
  params: Promise<{
    accountId: string;
    proposalId: string;
  }>;
}

export default function ProposalDetailPage({ params }: PageProps) {
  const { accountId, proposalId } = use(params);
  const router = useRouter();

  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [timeline, setTimeline] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  const fetchProposalData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [propRes, timeRes] = await Promise.all([
        fetch(`/api/proposals/${proposalId}`),
        fetch(`/api/proposals/${proposalId}/timeline`),
      ]);

      const propData = await propRes.json();
      if (!propRes.ok) throw new Error(propData.error || 'Failed to load proposal');
      setProposal(propData.proposal);

      const timeData = await timeRes.json();
      if (timeRes.ok && timeData.timeline) {
        setTimeline(timeData.timeline);
      }
    } catch (err: any) {
      setError(err?.message || 'Error loading proposal details');
    } finally {
      setLoading(false);
    }
  }, [proposalId]);

  useEffect(() => {
    fetchProposalData();
  }, [fetchProposalData]);

  const handleTransition = async (action: string, reason?: string) => {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/proposals/${proposalId}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Transition "${action}" failed`);
      fetchProposalData();
    } catch (err: any) {
      alert(err?.message || 'Transition failed');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6 min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-cyan-500" />
      </div>
    );
  }

  if (error || !proposal) {
    return (
      <div className="container mx-auto p-6 max-w-4xl space-y-4">
        <Link
          href={`/accounts/${accountId}`}
          className="text-sm text-zinc-400 hover:text-zinc-200 flex items-center gap-1.5"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Account
        </Link>
        <div className="p-6 rounded-lg bg-rose-950/40 border border-rose-900 text-rose-300 flex items-center gap-3">
          <AlertCircle className="w-6 h-6 shrink-0" />
          <div>
            <h3 className="font-semibold">Unable to load proposal</h3>
            <p className="text-sm text-rose-400/80">{error || 'Proposal not found'}</p>
          </div>
        </div>
      </div>
    );
  }

  const isArchived = Boolean(proposal.archived_at);
  const deliverables = (Array.isArray(proposal.deliverables)
    ? proposal.deliverables
    : []) as DeliverableItemInput[];

  const validUntilDate = new Date(proposal.valid_until).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="container mx-auto p-6 max-w-6xl space-y-6">
      {/* Top Breadcrumb Navigation */}
      <div className="flex items-center justify-between">
        <Link
          href={`/accounts/${accountId}`}
          className="text-sm text-zinc-400 hover:text-zinc-200 flex items-center gap-1.5 transition"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Account Overview
        </Link>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500 font-mono">ID: {proposal.id.slice(0, 8)}...</span>
        </div>
      </div>

      {/* Header Banner */}
      <div className="p-6 rounded-xl bg-zinc-900/70 border border-zinc-800 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-zinc-100">{proposal.title}</h1>
              <ProposalStatusBadge status={proposal.status} isArchived={isArchived} />
            </div>
            <p className="text-xs text-zinc-400">
              Contract Version <span className="text-zinc-200 font-semibold">v{proposal.version}</span> •
              Created on {new Date(proposal.created_at).toLocaleDateString()}
            </p>
          </div>

          {/* Action Toolbar */}
          <div className="flex items-center gap-2 flex-wrap">
            {proposal.status === 'draft' && !isArchived && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditDialogOpen(true)}
                  className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                >
                  <FileEdit className="w-3.5 h-3.5 mr-1.5" />
                  Edit Draft
                </Button>
                <Button
                  size="sm"
                  disabled={actionLoading}
                  onClick={() => handleTransition('send')}
                  className="bg-blue-600 hover:bg-blue-500 text-white"
                >
                  {actionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Send className="w-3.5 h-3.5 mr-1.5" />}
                  Send to Client
                </Button>
              </>
            )}

            {proposal.status === 'sent' && !isArchived && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={actionLoading}
                  onClick={() => handleTransition('draft')}
                  className="border-zinc-700 text-amber-400 hover:bg-zinc-800"
                >
                  <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                  Revert to Draft
                </Button>
                <Button
                  size="sm"
                  disabled={actionLoading}
                  onClick={() => handleTransition('accept')}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white"
                >
                  <CheckCircle className="w-3.5 h-3.5 mr-1.5" />
                  Mark Accepted
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={actionLoading}
                  onClick={() => {
                    const reason = prompt('Enter client rejection reason:');
                    if (reason && reason.trim()) {
                      handleTransition('reject', reason.trim());
                    }
                  }}
                  className="border-rose-900/60 text-rose-400 hover:bg-rose-950/30"
                >
                  <XCircle className="w-3.5 h-3.5 mr-1.5" />
                  Mark Rejected
                </Button>
              </>
            )}

            {(proposal.status === 'rejected' || proposal.status === 'expired') && !isArchived && (
              <Button
                size="sm"
                disabled={actionLoading}
                onClick={() => handleTransition('draft')}
                className="bg-cyan-600 hover:bg-cyan-500 text-white"
              >
                <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                Reopen as Draft
              </Button>
            )}

            {/* Archive / Restore Button */}
            <Button
              variant="ghost"
              size="sm"
              disabled={actionLoading}
              onClick={() => handleTransition(isArchived ? 'restore' : 'archive')}
              className="text-zinc-400 hover:text-zinc-200"
            >
              {isArchived ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Restore
                </>
              ) : (
                <>
                  <Archive className="w-3.5 h-3.5 mr-1.5" /> Archive
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Deliverables & Financial Summary (2 Cols) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Financial Breakdown Card */}
          <Card className="bg-zinc-900/60 border-zinc-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-base text-zinc-100 flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-emerald-400" />
                Commercial Terms & Validity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 rounded-lg bg-zinc-950/60 border border-zinc-800">
                <div>
                  <span className="text-xs text-zinc-400 block mb-1">Total Valuation</span>
                  <span className="text-xl font-bold text-zinc-100 font-mono">
                    {Number(proposal.total_amount).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                    })}{' '}
                    <span className="text-sm font-sans text-emerald-400">{proposal.currency}</span>
                  </span>
                </div>
                <div>
                  <span className="text-xs text-zinc-400 block mb-1">Validity Period</span>
                  <span className="text-sm font-medium text-zinc-200 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-zinc-400" />
                    {validUntilDate}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-zinc-400 block mb-1">Lifecycle Status</span>
                  <ProposalStatusBadge status={proposal.status} isArchived={isArchived} />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Deliverables & Milestones */}
          <Card className="bg-zinc-900/60 border-zinc-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-base text-zinc-100 flex items-center gap-2">
                <Layers className="w-4 h-4 text-cyan-400" />
                Deliverables & Scope Breakdown ({deliverables.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {deliverables.length === 0 ? (
                <div className="text-center py-6 text-sm text-zinc-500">
                  No deliverables specified for this proposal.
                </div>
              ) : (
                deliverables.map((item, idx) => (
                  <div
                    key={item.id || idx}
                    className="p-4 rounded-lg bg-zinc-950/50 border border-zinc-800/80 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-zinc-200">
                        {idx + 1}. {item.title}
                      </span>
                      {item.amount !== undefined && item.amount !== null && (
                        <span className="text-xs font-mono font-medium text-emerald-400">
                          {Number(item.amount).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                          })}{' '}
                          {proposal.currency}
                        </span>
                      )}
                    </div>
                    {item.description && (
                      <p className="text-xs text-zinc-400 whitespace-pre-line">
                        {item.description}
                      </p>
                    )}
                    {item.estimated_hours ? (
                      <p className="text-[11px] text-zinc-500 font-mono">
                        Estimated effort: {item.estimated_hours} hrs
                      </p>
                    ) : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* Confidential Staff Notes */}
          <Card className="bg-zinc-900/60 border-zinc-800">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm text-zinc-200 flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-amber-400" />
                  Staff Internal Notes & Estimation
                </CardTitle>
                <span className="text-[10px] uppercase font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded">
                  Confidential
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="p-3.5 rounded bg-zinc-950 border border-amber-500/20 text-xs text-zinc-300">
                {proposal.internal_notes ? (
                  <p className="whitespace-pre-line">{proposal.internal_notes}</p>
                ) : (
                  <p className="text-zinc-500 italic">No internal estimation notes recorded.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Audit Timeline & History Stream (1 Col) */}
        <div className="space-y-6">
          <Card className="bg-zinc-900/60 border-zinc-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-base text-zinc-100 flex items-center gap-2">
                <Clock className="w-4 h-4 text-blue-400" />
                Audit Trail & History
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ProposalTimeline timeline={timeline} />
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Edit Dialog */}
      <ProposalFormDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        accountId={accountId}
        initialData={{
          id: proposal.id,
          title: proposal.title,
          total_amount: Number(proposal.total_amount),
          currency: proposal.currency,
          valid_until: proposal.valid_until,
          deliverables: deliverables,
          internal_notes: proposal.internal_notes,
        }}
        onSuccess={fetchProposalData}
      />
    </div>
  );
}

