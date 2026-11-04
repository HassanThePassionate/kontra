'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Trash2, AlertCircle, Loader2 } from 'lucide-react';
import type { DeliverableItemInput } from '@/lib/validation-schemas';

interface ProposalFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  initialData?: {
    id?: string;
    title: string;
    total_amount: number;
    currency: string;
    valid_until: string;
    deliverables: DeliverableItemInput[];
    internal_notes?: string | null;
  } | null;
  onSuccess: () => void;
}

export function ProposalFormDialog({
  open,
  onOpenChange,
  accountId,
  initialData,
  onSuccess,
}: ProposalFormDialogProps) {
  const isEditing = Boolean(initialData?.id);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form State
  const [title, setTitle] = useState('');
  const [totalAmount, setTotalAmount] = useState<number>(0);
  const [currency, setCurrency] = useState('USD');
  const [validUntil, setValidUntil] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [deliverables, setDeliverables] = useState<DeliverableItemInput[]>([]);

  useEffect(() => {
    if (initialData) {
      setTitle(initialData.title || '');
      setTotalAmount(initialData.total_amount || 0);
      setCurrency(initialData.currency || 'USD');
      // Format valid_until to datetime-local format (YYYY-MM-DDTHH:mm)
      if (initialData.valid_until) {
        const d = new Date(initialData.valid_until);
        setValidUntil(d.toISOString().slice(0, 16));
      } else {
        const defaultDate = new Date();
        defaultDate.setDate(defaultDate.getDate() + 30);
        setValidUntil(defaultDate.toISOString().slice(0, 16));
      }
      setInternalNotes(initialData.internal_notes || '');
      setDeliverables(initialData.deliverables || []);
    } else {
      setTitle('');
      setTotalAmount(0);
      setCurrency('USD');
      const defaultDate = new Date();
      defaultDate.setDate(defaultDate.getDate() + 30);
      setValidUntil(defaultDate.toISOString().slice(0, 16));
      setInternalNotes('');
      setDeliverables([
        {
          id: '1',
          title: 'Initial Deliverable / Milestone',
          description: '',
          estimated_hours: 0,
          amount: 0,
        },
      ]);
    }
    setError(null);
  }, [initialData, open]);

  const handleAddDeliverable = () => {
    setDeliverables([
      ...deliverables,
      {
        id: String(Date.now()),
        title: '',
        description: '',
        estimated_hours: 0,
        amount: 0,
      },
    ]);
  };

  const handleRemoveDeliverable = (index: number) => {
    setDeliverables(deliverables.filter((_, i) => i !== index));
  };

  const handleUpdateDeliverable = (
    index: number,
    field: keyof DeliverableItemInput,
    value: any,
  ) => {
    const updated = [...deliverables];
    updated[index] = { ...updated[index], [field]: value };
    setDeliverables(updated);

    // Auto-calculate total amount if deliverables have individual amounts
    if (field === 'amount') {
      const sum = updated.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
      if (sum > 0) {
        setTotalAmount(sum);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError('Title is required');
      return;
    }

    if (totalAmount < 0) {
      setError('Total amount cannot be negative');
      return;
    }

    if (!validUntil) {
      setError('Valid until date is required');
      return;
    }

    const isoValidUntil = new Date(validUntil).toISOString();
    if (new Date(isoValidUntil) <= new Date()) {
      setError('Validity period must be set to a future date');
      return;
    }

    setLoading(true);
    try {
      if (isEditing && initialData?.id) {
        const res = await fetch(`/api/proposals/${initialData.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title.trim(),
            total_amount: Number(totalAmount),
            currency,
            valid_until: isoValidUntil,
            deliverables,
            internal_notes: internalNotes.trim() || null,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update proposal');
      } else {
        const res = await fetch('/api/proposals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            account_id: accountId,
            title: title.trim(),
            total_amount: Number(totalAmount),
            currency,
            valid_until: isoValidUntil,
            deliverables,
            internal_notes: internalNotes.trim() || null,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create proposal');
      }

      onSuccess();
      onOpenChange(false);
    } catch (err: any) {
      setError(err?.message || 'Operation failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-zinc-950 border-zinc-800 text-zinc-100">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">
            {isEditing ? 'Edit Draft Proposal' : 'Create New Proposal'}
          </DialogTitle>
          <DialogDescription className="text-zinc-400">
            {isEditing
              ? 'Update commercial proposal details. Only draft proposals can be modified.'
              : 'Create a new draft proposal for this client account.'}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="p-3 rounded bg-rose-950/40 border border-rose-900 text-sm text-rose-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="title" className="text-xs text-zinc-300">
              Proposal Title *
            </Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Q1 Marketing Campaign & Platform Redesign"
              className="bg-zinc-900 border-zinc-800 focus:border-cyan-500"
              required
            />
          </div>

          {/* Amount, Currency & Valid Until */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="totalAmount" className="text-xs text-zinc-300">
                Total Amount *
              </Label>
              <Input
                id="totalAmount"
                type="number"
                min="0"
                step="0.01"
                value={totalAmount}
                onChange={(e) => setTotalAmount(Number(e.target.value))}
                className="bg-zinc-900 border-zinc-800"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="currency" className="text-xs text-zinc-300">
                Currency
              </Label>
              <Input
                id="currency"
                maxLength={3}
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                className="bg-zinc-900 border-zinc-800 uppercase"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="validUntil" className="text-xs text-zinc-300">
                Valid Until *
              </Label>
              <Input
                id="validUntil"
                type="datetime-local"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                className="bg-zinc-900 border-zinc-800 text-xs"
                required
              />
            </div>
          </div>

          {/* Deliverables Section */}
          <div className="space-y-2 pt-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold text-zinc-300">
                Deliverables & Milestones
              </Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddDeliverable}
                className="h-7 text-xs border-zinc-700 bg-zinc-900 hover:bg-zinc-800 flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Item
              </Button>
            </div>

            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {deliverables.map((item, index) => (
                <div
                  key={item.id || index}
                  className="p-3 rounded-lg bg-zinc-900/70 border border-zinc-800 space-y-2 relative group"
                >
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="Deliverable Title *"
                      value={item.title}
                      onChange={(e) =>
                        handleUpdateDeliverable(index, 'title', e.target.value)
                      }
                      className="bg-zinc-950 border-zinc-800 h-8 text-xs flex-1"
                      required
                    />
                    <Input
                      type="number"
                      placeholder="Amount"
                      value={item.amount || ''}
                      onChange={(e) =>
                        handleUpdateDeliverable(
                          index,
                          'amount',
                          Number(e.target.value),
                        )
                      }
                      className="bg-zinc-950 border-zinc-800 h-8 text-xs w-28"
                    />
                    {deliverables.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveDeliverable(index)}
                        className="h-8 w-8 p-0 text-zinc-500 hover:text-rose-400 hover:bg-rose-950/20"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                  <Textarea
                    placeholder="Deliverable description and scope..."
                    value={item.description || ''}
                    onChange={(e) =>
                      handleUpdateDeliverable(index, 'description', e.target.value)
                    }
                    className="bg-zinc-950 border-zinc-800 text-xs min-h-[50px]"
                    rows={2}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Internal Staff Notes */}
          <div className="space-y-1.5 pt-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="internalNotes" className="text-xs text-zinc-300">
                Staff Internal Notes (Confidential)
              </Label>
              <span className="text-[10px] text-amber-400 font-mono">
                Never visible to client
              </span>
            </div>
            <Textarea
              id="internalNotes"
              value={internalNotes}
              onChange={(e) => setInternalNotes(e.target.value)}
              placeholder="Internal cost estimates, risk factors, or margin targets..."
              className="bg-zinc-900 border-zinc-800 text-xs min-h-[60px]"
              rows={3}
            />
          </div>

          <DialogFooter className="pt-3 border-t border-zinc-800 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-zinc-800 text-zinc-300 hover:bg-zinc-900"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading}
              className="bg-cyan-600 hover:bg-cyan-500 text-white flex items-center gap-1.5"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {isEditing ? 'Save Changes' : 'Create Proposal'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

