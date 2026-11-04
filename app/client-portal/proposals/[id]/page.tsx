'use client';

import React, { useState, useEffect, useCallback, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ProposalStatusBadge } from '@/components/proposals/proposal-status-badge';
import { ProposalTimeline } from '@/components/proposals/proposal-timeline';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Calendar,
  DollarSign,
  PackageCheck,
  Clock,
  Loader2,
  AlertCircle,
  FileCheck,
} from 'lucide-react';
import type { DeliverableItemInput } from '@/lib/validation-schemas';

interface PageProps {
  params: Promise<{
    id: string;
  }>;
}

export default function ClientProposalReviewPage({ params }: PageProps) {
  const { id } = use(params);
  const router = useRouter();

  const [proposal, setProposal] = useState<any>(null);
  const [timeline, setTimeline] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reject modal state
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [rejectError, setRejectError] = useState<string | null>(null);

  const fetchProposalData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [propRes, timeRes] = await Promise.all([
        fetch(`/api/client/portal/proposals/${id}`),
        fetch(`/api/proposals/${id}/timeline`),
      ]);

      if (propRes.status === 401) {
        router.replace('/login');
        return;
      }

      const propData = await propRes.json();
      if (!propRes.ok) throw new Error(propData.error || 'Failed to load proposal');
      setProposal(propData.proposal);

      const timeData = await timeRes.json();
      if (timeRes.ok && timeData.timeline) {
        setTimeline(timeData.timeline);
      }
    } catch (err: any) {
      setError(err?.message || 'Error loading proposal');
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    fetchProposalData();
  }, [fetchProposalData]);

  const handleAccept = async () => {
    if (!confirm('Are you sure you want to accept and approve this proposal?')) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/client/portal/proposals/${id}/accept`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to accept proposal');
      fetchProposalData();
    } catch (err: any) {
      alert(err?.message || 'Failed to accept proposal');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRejectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRejectError(null);

    if (!rejectionReason.trim()) {
      setRejectError('Please provide a reason or feedback for rejection.');
      return;
    }

    setActionLoading(true);
    try {
      const res = await fetch(`/api/client/portal/proposals/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: rejectionReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit rejection');
      setRejectModalOpen(false);
      fetchProposalData();
    } catch (err: any) {
      setRejectError(err?.message || 'Failed to submit rejection');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#080B0F] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-cyan-500" />
      </div>
    );
  }

  if (error || !proposal) {
    return (
      <div className="min-h-screen bg-[#080B0F] text-zinc-100 p-6 md:p-10">
        <div className="max-w-4xl mx-auto space-y-4">
          <Link
            href="/client-portal"
            className="text-sm text-zinc-400 hover:text-zinc-200 flex items-center gap-1.5"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Client Portal
          </Link>
          <div className="p-6 rounded-lg bg-rose-950/40 border border-rose-900 text-rose-300 flex items-center gap-3">
            <AlertCircle className="w-6 h-6 shrink-0" />
            <div>
              <h3 className="font-semibold">Unable to display proposal</h3>
              <p className="text-sm text-rose-400/80">{error || 'Proposal not found'}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isSent = proposal.status === 'sent';
  const isAccepted = proposal.status === 'accepted';
  const isRejected = proposal.status === 'rejected';
  const deliverables = (Array.isArray(proposal.deliverables)
    ? proposal.deliverables
    : []) as DeliverableItemInput[];

  const validUntilDate = new Date(proposal.valid_until).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="min-h-screen bg-[#080B0F] text-zinc-100 p-6 md:p-10">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Navigation */}
        <div className="flex items-center justify-between">
          <Link
            href="/client-portal"
            className="text-sm text-zinc-400 hover:text-zinc-200 flex items-center gap-1.5 transition"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Client Portal
          </Link>
          <ProposalStatusBadge status={proposal.status} />
        </div>

        {/* Status Callout Banner */}
        {isAccepted && (
          <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-900/50 flex items-center gap-3 text-emerald-300">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <div>
              <p className="font-semibold text-sm">Proposal Accepted</p>
              <p className="text-xs text-emerald-400/80">
                This commercial proposal was accepted on {new Date(proposal.accepted_at).toLocaleString()}.
              </p>
            </div>
          </div>
        )}

        {isRejected && (
          <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-900/50 flex items-start gap-3 text-rose-300">
            <XCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold text-sm">Proposal Declined</p>
              <p className="text-xs text-rose-300/90">
                Reason provided: {proposal.rejection_reason}
              </p>
            </div>
          </div>
        )}

        {/* Main Proposal Card */}
        <Card className="bg-zinc-900/60 border-zinc-800">
          <CardHeader className="pb-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <FileCheck className="w-5 h-5 text-cyan-400" />
                <span className="text-xs uppercase tracking-wider text-cyan-400 font-bold">
                  Commercial Proposal
                </span>
              </div>
              <h1 className="text-2xl font-bold text-zinc-100">{proposal.title}</h1>
              <div className="flex items-center gap-3 text-xs text-zinc-400 flex-wrap pt-1">
                <span className="flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-zinc-500" />
                  Valid until: <strong className="text-zinc-300">{validUntilDate}</strong>
                </span>
                <span>•</span>
                <span>Version: v{proposal.version}</span>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* Financial Summary */}
            <div className="p-4 rounded-lg bg-zinc-950/70 border border-zinc-800 flex items-center justify-between">
              <div>
                <span className="text-xs text-zinc-400 block mb-0.5">Total Valuation</span>
                <span className="text-2xl font-bold font-mono text-zinc-100">
                  {Number(proposal.total_amount).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                  })}{' '}
                  <span className="text-sm font-sans text-emerald-400">{proposal.currency}</span>
                </span>
              </div>
              <div className="text-right">
                <span className="text-xs text-zinc-400 block mb-0.5">Line Items</span>
                <span className="text-sm font-semibold text-zinc-200">
                  {deliverables.length} Deliverables
                </span>
              </div>
            </div>

            {/* Scope / Deliverables */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                <PackageCheck className="w-4 h-4 text-cyan-400" />
                Scope of Work & Deliverables
              </h3>

              <div className="space-y-2.5">
                {deliverables.map((item, index) => (
                  <div
                    key={item.id || index}
                    className="p-4 rounded-lg bg-zinc-950/50 border border-zinc-800/80 space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-zinc-200">
                        {index + 1}. {item.title}
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
                      <p className="text-xs text-zinc-400 whitespace-pre-line pt-1">
                        {item.description}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Client Action Buttons (When Sent & Active) */}
            {isSent && (
              <div className="pt-4 border-t border-zinc-800 flex flex-col sm:flex-row items-center justify-end gap-3">
                <Button
                  variant="outline"
                  disabled={actionLoading}
                  onClick={() => setRejectModalOpen(true)}
                  className="w-full sm:w-auto border-rose-900/60 text-rose-400 hover:bg-rose-950/30 flex items-center justify-center gap-1.5"
                >
                  <XCircle className="w-4 h-4" />
                  Decline Proposal
                </Button>
                <Button
                  disabled={actionLoading}
                  onClick={handleAccept}
                  className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center gap-1.5 shadow-sm"
                >
                  {actionLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  Accept & Approve Proposal
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Milestone Timeline */}
        <Card className="bg-zinc-900/60 border-zinc-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-zinc-100 flex items-center gap-2">
              <Clock className="w-4 h-4 text-blue-400" />
              Milestone Timeline
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ProposalTimeline timeline={timeline} />
          </CardContent>
        </Card>
      </div>

      {/* Reject Modal */}
      <Dialog open={rejectModalOpen} onOpenChange={setRejectModalOpen}>
        <DialogContent className="max-w-md bg-zinc-950 border-zinc-800 text-zinc-100">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-rose-400 flex items-center gap-2">
              <XCircle className="w-5 h-5" />
              Decline Proposal
            </DialogTitle>
            <DialogDescription className="text-zinc-400">
              Please let the team know why this proposal does not meet your requirements. Your feedback will help refine the terms.
            </DialogDescription>
          </DialogHeader>

          {rejectError && (
            <div className="p-3 rounded bg-rose-950/40 border border-rose-900 text-xs text-rose-300">
              {rejectError}
            </div>
          )}

          <form onSubmit={handleRejectSubmit} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <label className="text-xs text-zinc-300 font-medium">Feedback / Reason *</label>
              <Textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="e.g. Budget exceeds allocation, or deliverables require timeline adjustment..."
                className="bg-zinc-900 border-zinc-800 text-xs min-h-[100px]"
                rows={4}
                required
              />
            </div>

            <DialogFooter className="pt-2 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setRejectModalOpen(false)}
                className="border-zinc-800 text-zinc-400 hover:bg-zinc-900"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={actionLoading}
                className="bg-rose-600 hover:bg-rose-500 text-white flex items-center gap-1.5"
              >
                {actionLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Submit Rejection
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

