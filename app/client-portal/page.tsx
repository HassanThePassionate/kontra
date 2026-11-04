'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ProposalStatusBadge } from '@/components/proposals/proposal-status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  FileText,
  DollarSign,
  Calendar,
  CheckCircle,
  XCircle,
  Clock,
  ArrowRight,
  Loader2,
  AlertCircle,
  PackageCheck,
} from 'lucide-react';

export default function ClientPortalPage() {
  const router = useRouter();
  const [proposals, setProposals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadClientData() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/client/portal/proposals');
        if (res.status === 401) {
          router.replace('/login');
          return;
        }
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load client proposals');
        setProposals(data.proposals || []);
      } catch (err: any) {
        setError(err?.message || 'Error loading proposals');
      } finally {
        setLoading(false);
      }
    }
    loadClientData();
  }, [router]);

  return (
    <div className="min-h-screen bg-[#080B0F] text-zinc-100 p-6 md:p-10">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Portal Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-zinc-800">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-100">Client Portal</h1>
            <p className="text-sm text-zinc-400 mt-1">
              Review and act on commercial proposals and project milestones.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs bg-cyan-950/60 text-cyan-400 border border-cyan-800/60 px-3 py-1 rounded-full font-medium">
              Verified Client Session
            </span>
          </div>
        </div>

        {error && (
          <div className="p-4 rounded-lg bg-rose-950/40 border border-rose-900 text-sm text-rose-300 flex items-center gap-2.5">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Proposals Section */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-zinc-200 flex items-center gap-2">
              <FileText className="w-5 h-5 text-cyan-400" />
              Your Proposals & Contracts
            </h2>
            <span className="text-xs text-zinc-400">
              {proposals.length} {proposals.length === 1 ? 'proposal' : 'proposals'}
            </span>
          </div>

          {loading ? (
            <div className="py-16 flex justify-center items-center">
              <Loader2 className="w-8 h-8 animate-spin text-cyan-500" />
            </div>
          ) : proposals.length === 0 ? (
            <Card className="bg-zinc-900/40 border-zinc-800 text-center py-12">
              <CardContent className="space-y-2">
                <FileText className="w-10 h-10 text-zinc-600 mx-auto" />
                <h3 className="text-base font-semibold text-zinc-300">No Proposals Available</h3>
                <p className="text-xs text-zinc-500 max-w-sm mx-auto">
                  There are currently no proposals awaiting your review. New proposals will appear here once sent by the team.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {proposals.map((proposal) => {
                const deliverablesCount = Array.isArray(proposal.deliverables)
                  ? proposal.deliverables.length
                  : 0;
                const validUntilDate = new Date(proposal.valid_until).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                });
                const isSent = proposal.status === 'sent';

                return (
                  <Card
                    key={proposal.id}
                    className="bg-zinc-900/60 border-zinc-800 hover:border-zinc-700 transition"
                  >
                    <CardContent className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="space-y-1.5 flex-1">
                        <div className="flex items-center gap-3 flex-wrap">
                          <Link
                            href={`/client-portal/proposals/${proposal.id}`}
                            className="text-lg font-bold text-zinc-100 hover:text-cyan-400 transition"
                          >
                            {proposal.title}
                          </Link>
                          <ProposalStatusBadge status={proposal.status} />
                        </div>

                        <div className="flex items-center gap-4 text-xs text-zinc-400 flex-wrap">
                          <span className="flex items-center gap-1 font-mono text-zinc-300">
                            <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
                            {Number(proposal.total_amount).toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                            })}{' '}
                            {proposal.currency}
                          </span>
                          <span>•</span>
                          <span className="flex items-center gap-1">
                            <PackageCheck className="w-3.5 h-3.5 text-zinc-500" />
                            {deliverablesCount} Deliverables
                          </span>
                          <span>•</span>
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5 text-zinc-500" />
                            Valid until: {validUntilDate}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Link href={`/client-portal/proposals/${proposal.id}`}>
                          <Button
                            variant={isSent ? 'default' : 'outline'}
                            size="sm"
                            className={
                              isSent
                                ? 'bg-cyan-600 hover:bg-cyan-500 text-white flex items-center gap-1.5'
                                : 'border-zinc-700 text-zinc-300 hover:bg-zinc-800 flex items-center gap-1.5'
                            }
                          >
                            <span>{isSent ? 'Review & Sign' : 'View Proposal'}</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </Button>
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

