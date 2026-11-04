'use client';

import React from 'react';
import { ProposalStatusBadge } from './proposal-status-badge';
import {
  FilePlus,
  Send,
  CheckCircle,
  XCircle,
  Clock,
  RotateCcw,
  Archive,
  RefreshCw,
} from 'lucide-react';

export interface TimelineItem {
  id: string;
  from_status: string | null;
  to_status: string;
  action: string;
  rejection_reason?: string | null;
  actor_email?: string | null;
  actor_type: 'staff' | 'client' | 'system';
  created_at: string;
}

interface ProposalTimelineProps {
  timeline: TimelineItem[];
  className?: string;
}

function getActionIcon(action: string) {
  switch (action) {
    case 'create':
      return <FilePlus className="w-4 h-4 text-emerald-400" />;
    case 'send':
      return <Send className="w-4 h-4 text-blue-400" />;
    case 'accept':
      return <CheckCircle className="w-4 h-4 text-emerald-400" />;
    case 'reject':
      return <XCircle className="w-4 h-4 text-rose-400" />;
    case 'draft':
      return <RotateCcw className="w-4 h-4 text-amber-400" />;
    case 'expire':
      return <Clock className="w-4 h-4 text-zinc-400" />;
    case 'archive':
      return <Archive className="w-4 h-4 text-zinc-400" />;
    case 'restore':
      return <RefreshCw className="w-4 h-4 text-cyan-400" />;
    default:
      return <Clock className="w-4 h-4 text-zinc-400" />;
  }
}

function getActionTitle(action: string, actorType: string) {
  const actorPrefix = actorType === 'client' ? 'Client' : 'Staff';
  switch (action) {
    case 'create':
      return 'Proposal Draft Created';
    case 'update':
      return 'Proposal Draft Updated';
    case 'send':
      return 'Proposal Sent to Client';
    case 'accept':
      return `${actorPrefix} Accepted Proposal`;
    case 'reject':
      return `${actorPrefix} Rejected Proposal`;
    case 'draft':
      return 'Proposal Reverted to Draft';
    case 'expire':
      return 'Proposal Expired';
    case 'archive':
      return 'Proposal Archived';
    case 'restore':
      return 'Proposal Restored';
    default:
      return `Action: ${action}`;
  }
}

export function ProposalTimeline({ timeline, className = '' }: ProposalTimelineProps) {
  if (!timeline || timeline.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-zinc-400 bg-zinc-900/40 rounded-lg border border-zinc-800">
        No lifecycle events recorded yet.
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-zinc-800">
        {timeline.map((item, index) => {
          const date = new Date(item.created_at);
          const formattedDate = date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          });

          return (
            <div key={item.id || index} className="relative group">
              {/* Dot Icon */}
              <div className="absolute -left-6 top-0.5 w-5 h-5 rounded-full bg-zinc-900 border border-zinc-700 flex items-center justify-center">
                {getActionIcon(item.action)}
              </div>

              {/* Event Content */}
              <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 hover:border-zinc-700 transition">
                <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-zinc-200">
                      {getActionTitle(item.action, item.actor_type)}
                    </span>
                    <ProposalStatusBadge status={item.to_status} className="text-xs" />
                  </div>
                  <span className="text-xs text-zinc-500">{formattedDate}</span>
                </div>

                {item.actor_email && (
                  <p className="text-xs text-zinc-400 mb-1">
                    By: <span className="text-zinc-300 font-mono">{item.actor_email}</span> ({item.actor_type})
                  </p>
                )}

                {item.rejection_reason && (
                  <div className="mt-2 p-2.5 rounded bg-rose-950/30 border border-rose-900/40 text-xs text-rose-300">
                    <span className="font-semibold block mb-0.5">Feedback / Rejection Reason:</span>
                    {item.rejection_reason}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

