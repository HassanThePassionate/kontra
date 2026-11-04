'use client';

import React from 'react';
import { Badge } from '@/components/ui/badge';
import {
  FileEdit,
  Send,
  CheckCircle2,
  XCircle,
  Clock,
  Archive,
} from 'lucide-react';

interface ProposalStatusBadgeProps {
  status: string;
  isArchived?: boolean;
  className?: string;
}

export function ProposalStatusBadge({
  status,
  isArchived = false,
  className = '',
}: ProposalStatusBadgeProps) {
  if (isArchived) {
    return (
      <Badge
        variant="outline"
        className={`bg-zinc-800/60 text-zinc-400 border-zinc-700 flex items-center gap-1.5 px-2.5 py-0.5 ${className}`}
      >
        <Archive className="w-3.5 h-3.5" />
        <span>Archived</span>
      </Badge>
    );
  }

  switch (status) {
    case 'draft':
      return (
        <Badge
          variant="outline"
          className={`bg-amber-500/10 text-amber-400 border-amber-500/30 flex items-center gap-1.5 px-2.5 py-0.5 ${className}`}
        >
          <FileEdit className="w-3.5 h-3.5" />
          <span>Draft</span>
        </Badge>
      );
    case 'sent':
      return (
        <Badge
          variant="outline"
          className={`bg-blue-500/10 text-blue-400 border-blue-500/30 flex items-center gap-1.5 px-2.5 py-0.5 ${className}`}
        >
          <Send className="w-3.5 h-3.5" />
          <span>Sent / Pending</span>
        </Badge>
      );
    case 'accepted':
      return (
        <Badge
          variant="outline"
          className={`bg-emerald-500/10 text-emerald-400 border-emerald-500/30 flex items-center gap-1.5 px-2.5 py-0.5 ${className}`}
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>Accepted</span>
        </Badge>
      );
    case 'rejected':
      return (
        <Badge
          variant="outline"
          className={`bg-rose-500/10 text-rose-400 border-rose-500/30 flex items-center gap-1.5 px-2.5 py-0.5 ${className}`}
        >
          <XCircle className="w-3.5 h-3.5" />
          <span>Rejected</span>
        </Badge>
      );
    case 'expired':
      return (
        <Badge
          variant="outline"
          className={`bg-zinc-600/20 text-zinc-400 border-zinc-600/40 flex items-center gap-1.5 px-2.5 py-0.5 ${className}`}
        >
          <Clock className="w-3.5 h-3.5" />
          <span>Expired</span>
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className={className}>
          {status}
        </Badge>
      );
  }
}

